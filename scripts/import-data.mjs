#!/usr/bin/env node
/**
 * import-data.mjs
 * ---------------------------------------------------------------------------
 * Imports the exported data (data/export/<table>.json + data/export/storage/)
 * into the NEW Supabase project using the service_role key (bypasses RLS).
 *
 * - Skips app_roles / role_module_permissions / app_users / user_roles /
 *   password_history — already provisioned on the new project (role UUIDs
 *   differ there, so importing them would break the Admin/User mapping).
 * - Inserts in FK-safe order (topological sort from src/integrations/supabase/types.ts).
 * - Skips rows whose primary key already exists (resolution=ignore-duplicates),
 *   so re-runs are safe.
 * - Uploads storage files preserving bucket paths.
 * - Generates supabase/migrations/20260821999999_bump_postgres_sequences.sql
 *   so next document numbers continue where the old DB left off.
 *
 * Usage: node scripts/import-data.mjs
 * After it finishes: supabase db push --linked --yes  (applies the bump)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPORT = resolve(root, 'data', 'export');

function loadEnv() {
  try {
    const txt = readFileSync(resolve(root, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch { /* optional */ }
}
loadEnv();

const NEW_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!NEW_URL || !SR) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const headers = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };

// Tables already provisioned with new role mapping — never import these
const SKIP = new Set(['app_roles', 'role_module_permissions', 'app_users', 'user_roles', 'password_history']);

// ---------------------------------------------------------------------------
// 1. FK-safe ordering from types.ts Relationships
//    (parse the FULL table block — Relationships live after the Row block)
// ---------------------------------------------------------------------------
const types = readFileSync(resolve(root, 'src/integrations/supabase/types.ts'), 'utf8');
const tableCols = new Map();
const blocks = new Map();
{
  // split types.ts into per-table sections at the top level (6-space indent)
  const re = /^\s{6}([a-z_0-9]+): \{/gm;
  let m, prev = null;
  const starts = [];
  while ((m = re.exec(types)) !== null) starts.push([m[1], m.index]);
  for (let i = 0; i < starts.length; i++) {
    const [name, start] = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1][1] : types.length;
    blocks.set(name, types.slice(start, end));
    const rowM = types.slice(start, end).match(/\n\s{8}Row: \{([\s\S]*?)\n\s{8}\}/);
    tableCols.set(name, rowM ? [...rowM[1].matchAll(/^\s{10}([a-z_0-9]+):/gm)].map((x) => x[1]) : []);
  }
}
const deps = new Map(); // table -> Set(referenced tables)
const depEdges = new Map(); // table -> [{ref, col}] (column names for cycle-breaking)
for (const [table, block] of blocks) {
  const refs = new Set();
  const edges = [];
  for (const m of block.matchAll(/referencedRelation: "([a-z_0-9]+)"/g)) {
    if (blocks.has(m[1]) && m[1] !== table) refs.add(m[1]); // skip self-refs
  }
  // capture column names per FK edge (columns:[...] appears before referencedRelation)
  const edgeRe = /foreignKeyName: "[^"]+"[\s\S]*?columns: \[([^\]]*)\][\s\S]*?referencedRelation: "([a-z_0-9]+)"/g;
  for (const em of block.matchAll(edgeRe)) {
    const cols = [...em[1].matchAll(/"([a-z_0-9_]+)"/g)].map((x) => x[1]);
    if (em[2] !== table && cols.length && blocks.has(em[2])) {
      edges.push({ ref: em[2], col: cols[0] });
    }
  }
  deps.set(table, refs);
  depEdges.set(table, edges);
}
// Kahn topological sort with cycle-breaking: when stuck, force the first
// remaining node through, nulling its FK columns that point back into the
// still-pending set (they get backfilled after all inserts).
const dynamicCycleNull = {}; // table -> Set(column)
const order = [];
const remaining = new Set([...blocks.keys()].sort());
while (remaining.size) {
  const ready = [...remaining].filter((t) => ![...deps.get(t)].some((d) => remaining.has(d))).sort();
  if (ready.length) {
    order.push(...ready);
    ready.forEach((t) => remaining.delete(t));
    continue;
  }
  // cycle — force the first remaining node; null FKs that point into remaining
  const forced = [...remaining].sort()[0];
  order.push(forced);
  remaining.delete(forced);
  for (const e of depEdges.get(forced) || []) {
    if (remaining.has(e.ref)) {
      (dynamicCycleNull[forced] ||= new Set()).add(e.col);
    }
  }
}
console.log('Import order (FK-safe):');
console.log(order.join(', '));
console.log('Cyclic FK columns nulled during insert:', JSON.stringify(Object.fromEntries(Object.entries(dynamicCycleNull).map(([k, v]) => [k, [...v]]))));

// Columns that are GENERATED on the new DB — values must be stripped on insert
const GENERATED_STRIP = {
  indents: ['oracle_number'], // GENERATED ALWAYS AS ((oracles_data -> 0 ->> 'oracle_no')) STORED
};

// Cyclic FK pairs — insert with these columns NULLed, backfill afterwards
const CYCLE_NULL = {
  quotations: ['converted_to_so_id'],            // -> sales_orders
  sales_orders: ['linked_quote_id'],             // -> quotations
  invoices: ['source_general_dc_id'],            // -> general_delivery_challans
  general_delivery_challans: ['converted_invoice_id'], // -> invoices
};
// merge detected cycles into the manual list
for (const [t, cols] of Object.entries(dynamicCycleNull)) {
  CYCLE_NULL[t] = [...new Set([...(CYCLE_NULL[t] || []), ...cols])];
}
// rows saved for the backfill pass: table -> [{id, col, value}]
const backfill = {};

// ---------------------------------------------------------------------------
// 2. Import tables
// ---------------------------------------------------------------------------
const exports = readdirSync(EXPORT).filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json'));
const report = [];
let grandTotal = 0;

for (const table of order) {
  if (!exports.includes(table)) continue;
  if (SKIP.has(table)) { report.push(`| ${table} | SKIPPED (already provisioned) |`); continue; }
  const rows = JSON.parse(readFileSync(join(EXPORT, `${table}.json`), 'utf8'));
  if (!rows.length) { report.push(`| ${table} | 0 |`); continue; }
  // strip generated columns (values are computed server-side)
  const strip = GENERATED_STRIP[table];
  const cycleCols = CYCLE_NULL[table];
  const clean = rows.map((r) => {
    const c = { ...r };
    for (const k of (strip || [])) delete c[k];
    for (const k of (cycleCols || [])) {
      if (c[k] != null) {
        (backfill[table] ||= []).push({ id: r.id, col: k, value: c[k] });
        c[k] = null; // insert without the cyclic reference, backfill later
      }
    }
    return c;
  });

  let ok = 0, failed = 0, firstErr = '';
  for (let i = 0; i < clean.length; i += 100) {
    const chunk = clean.slice(i, i + 100);
    // try bulk first, fall back to per-row on any error (reliable dup handling)
    const r = await fetch(`${NEW_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(chunk),
    });
    if (r.ok) {
      ok += chunk.length;
      continue;
    }
    const errBody = await r.text();
    if (chunk.length === 1) {
      // single row failed: 23505 = duplicate -> skip; anything else = real failure
      if (errBody.includes('23505')) ok++;
      else { failed++; if (!firstErr) firstErr = errBody.slice(0, 200); }
      continue;
    }
    // bulk failed — fall back per row
    for (const row of chunk) {
      const rr = await fetch(`${NEW_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify(row),
      });
      if (rr.ok) { ok++; continue; }
      const body = await rr.text();
      if (body.includes('23505')) ok++; // duplicate — already present, fine
      else { failed++; if (!firstErr) firstErr = `${body.slice(0, 200)} (row ${row.id || '?'})`; }
    }
  }
  grandTotal += ok;
  report.push(`| ${table} | ${ok} imported${failed ? `, ${failed} FAILED` : ''}${firstErr ? ` — ${firstErr}` : ''} |`);
  console.log(`  ${table}: ${ok} imported${failed ? `, ${failed} failed` : ''}`);
}

// ---------------------------------------------------------------------------
// 2b. Backfill cyclic FK columns
// ---------------------------------------------------------------------------
for (const [table, entries] of Object.entries(backfill)) {
  let ok = 0, failed = 0;
  for (const e of entries) {
    const r = await fetch(`${NEW_URL}/rest/v1/${table}?id=eq.${e.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ [e.col]: e.value }),
    });
    if (r.ok) ok++; else failed++;
  }
  report.push(`| ${table} (fk-backfill ${entries[0].col}) | ${ok} updated${failed ? `, ${failed} FAILED` : ''} |`);
  console.log(`  ${table} fk-backfill ${entries[0].col}: ${ok} updated${failed ? `, ${failed} failed` : ''}`);
}

// ---------------------------------------------------------------------------
// 3. Storage files
// ---------------------------------------------------------------------------
const storageDir = join(EXPORT, 'storage');
if (existsSync(storageDir)) {
  for (const bucket of readdirSync(storageDir)) {
    const bucketDir = join(storageDir, bucket);
    const walk = (dir) => {
      let files = [];
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) files = files.concat(walk(p));
        else files.push(p);
      }
      return files;
    };
    const files = walk(bucketDir);
    let ok = 0, failed = 0;
    for (const f of files) {
      const path = f.slice(bucketDir.length + 1);
      const buf = readFileSync(f);
      const r = await fetch(`${NEW_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
        body: buf,
      });
      if (r.ok) ok++; else failed++;
    }
    report.push(`| storage/${bucket} | ${ok} uploaded${failed ? `, ${failed} FAILED` : ''} |`);
    console.log(`  storage/${bucket}: ${ok} uploaded${failed ? `, ${failed} failed` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Sequence bump migration (next document numbers continue correctly)
// ---------------------------------------------------------------------------
const SEQUENCE_RULES = [
  { seq: 'challan_seq',        table: 'gatepasses',            col: 'challan_no', re: /PHT\/\d{4}\/(\d+)/ },
  { seq: 'dc_customer_seq',    table: 'delivery_challans',     col: 'challan_no', re: /DC-CUST\/\d{4}\/(\d+)/ },
  { seq: 'dc_oem_seq',         table: 'delivery_challans',     col: 'challan_no', re: /DC-OEM\/\d{4}\/(\d+)/ },
  { seq: 'grn_customer_seq',   table: 'grns',                  col: 'grn_no',     re: /GRN-CUST\/\d{4}\/(\d+)/ },
  { seq: 'grn_oem_seq',        table: 'grns',                  col: 'grn_no',     re: /GRN-OEM\/\d{4}\/(\d+)/ },
  { seq: 'grn_general_seq',    table: 'grns',                  col: 'grn_no',     re: /GRN-GEN\/\d{4}\/(\d+)/ },
  { seq: 'payment_no_seq',     table: 'payments_received',     col: 'payment_no', re: /PHS\/RCPT\/\d{4}\/(\d+)/ },
  { seq: 'gdc_seq',            table: 'general_delivery_challans', col: 'dc_no',  re: /GDC\/\d{4}\/(\d+)/ },
];
const bumpLines = [
  '-- Bump Postgres sequences so new document numbers continue where the old DB left off.',
  '-- Generated automatically by scripts/import-data.mjs from the exported data.',
];
let bumpable = 0;
for (const rule of SEQUENCE_RULES) {
  const file = join(EXPORT, `${rule.table}.json`);
  if (!existsSync(file)) continue;
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  let max = 0;
  for (const r of rows) {
    const m = rule.re.exec(String(r[rule.col] ?? ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  if (max > 0) {
    bumpLines.push(`SELECT setval('public.${rule.seq}', ${max}, true);  -- ${rule.table}.${rule.col} max=${max}`);
    bumpable++;
  }
}
if (bumpable) {
  const bumpFile = resolve(root, 'supabase', 'migrations', '20260821999999_bump_postgres_sequences.sql');
  writeFileSync(bumpFile, bumpLines.join('\n') + '\n');
  console.log(`\nGenerated ${bumpFile} (${bumpable} sequences)`);
  console.log('Run: supabase db push --linked --yes   (to apply the bump)');
}

// ---------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------
writeFileSync(join(EXPORT, 'IMPORT-REPORT.md'), [
  `# Import report — ${new Date().toISOString()}`,
  '',
  `Total rows imported: ${grandTotal}`,
  '',
  '| Object | Result |',
  '|---|---|',
  ...report,
].join('\n'));
console.log(`\nDone. ${grandTotal} rows imported. Report: ${join(EXPORT, 'IMPORT-REPORT.md')}`);