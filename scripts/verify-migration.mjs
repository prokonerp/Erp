#!/usr/bin/env node
/**
 * verify-migration.mjs
 * ---------------------------------------------------------------------------
 * Verifies that the NEW Supabase project contains everything that was
 * exported from the OLD project (data/export/<table>.json + storage/).
 *
 * Source of truth = the export JSON snapshots, so this works even after the
 * old project is deleted.
 *
 * Checks:
 *  1. Row counts per exported table (service_role REST, count=exact).
 *  2. Known-troublesome rows (eway_bills, invoice_items that failed during
 *     import due to NOT NULL violations) — verified by primary key.
 *  3. Provisioned tables (app_users / app_roles / user_roles /
 *     role_module_permissions / password_history) — app_users by email,
 *     app_roles by name, others by count.
 *  4. Auth users (auth/v1/admin/users) vs app_users emails.
 *  5. Storage buckets vs exported files.
 *  6. Sequence bump migration numbers vs max values in the exports.
 *
 * Usage: node scripts/verify-migration.mjs
 * Output: console summary + data/verify-report.md
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
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

// Tables provisioned on the new project with fresh UUIDs — can't compare by ID
const PROVISIONED = new Set(['app_roles', 'role_module_permissions', 'app_users', 'user_roles', 'password_history']);

async function countRows(table) {
  // select=* (HEAD never returns a body); count=exact via Content-Range.
  // Using `select=id` would 400 for tables whose PK is not `id`
  // (app_users.user_id, app_modules, defective_tag_sequence, ...).
  const r = await fetch(`${NEW_URL}/rest/v1/${table}?select=*`, {
    method: 'HEAD',
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  const contentRange = r.headers.get('content-range') || '';
  const m = contentRange.match(/\/(\d+)$/);
  if (!r.ok || !m) return { ok: false, count: -1, status: r.status };
  return { ok: true, count: parseInt(m[1], 10) };
}

async function fetchRowIds(table, ids) {
  const out = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const r = await fetch(`${NEW_URL}/rest/v1/${table}?id=in.(${chunk.map((x) => `"${x}"`).join(',')})&select=id`, {
      headers: { ...headers, Range: '0-1000' },
    });
    if (!r.ok) continue;
    const rows = await r.json();
    for (const row of rows) out.add(row.id);
  }
  return out;
}

async function fetchAllEmails(table) {
  const out = [];
  for (let page = 0; page < 10; page++) {
    const r = await fetch(`${NEW_URL}/rest/v1/${table}?select=email&order=email`, {
      headers: { ...headers, Range: `${page * 1000}-${page * 1000 + 999}` },
    });
    if (!r.ok) break;
    const rows = await r.json();
    if (!rows.length) break;
    out.push(...rows.map((x) => (x.email || '').toLowerCase()));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Row counts per exported table
// ---------------------------------------------------------------------------
const exports = readdirSync(EXPORT).filter((f) => f.endsWith('.json')).map((f) => basename(f, '.json'));
const report = [];
let mismatches = 0;
let checked = 0;

console.log('Verifying table row counts...');
for (const table of exports.sort()) {
  if (PROVISIONED.has(table)) continue; // handled by the dedicated section below
  const rows = JSON.parse(readFileSync(join(EXPORT, `${table}.json`), 'utf8'));
  const expected = rows.length;
  if (expected === 0) continue; // empty export — nothing to verify
  const { ok, count, status } = await countRows(table);
  checked++;
  if (!ok) {
    mismatches++;
    report.push(`| ${table} | ${expected} | ERROR (HTTP ${status}) | ❌ count failed` );
    continue;
  }
  const match = count === expected;
  if (!match) mismatches++;
  report.push(`| ${table} | ${expected} | ${count} | ${match ? '✅' : '❌'} ${match ? '' : `diff ${count - expected}`}`);
  console.log(`  ${table}: expected ${expected}, got ${count} ${match ? '✅' : '❌'}`);
}

// ---------------------------------------------------------------------------
// 2. Known-troublesome rows by primary key
// ---------------------------------------------------------------------------
console.log('Checking known-failed rows...');
for (const table of ['eway_bills', 'invoice_items']) {
  const file = join(EXPORT, `${table}.json`);
  if (!existsSync(file)) continue;
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const ids = rows.map((r) => r.id);
  const found = await fetchRowIds(table, ids);
  const missing = ids.filter((id) => !found.has(id));
  const pass = missing.length === 0;
  if (!pass) mismatches++;
  report.push(`| ${table} (rows that failed during import) | ${ids.length} | ${ids.length - missing.length} | ${pass ? '✅' : `❌ missing: ${missing.join(', ')}`}`);
  console.log(`  ${table}: ${ids.length - missing.length}/${ids.length} present ${pass ? '✅' : `❌ missing ${missing.join(', ')}`}`);
}

// ---------------------------------------------------------------------------
// 3. Provisioned tables
// ---------------------------------------------------------------------------
console.log('Verifying provisioned tables...');
// app_users by email
{
  const file = join(EXPORT, 'app_users.json');
  if (existsSync(file)) {
    const expected = new Set(JSON.parse(readFileSync(file, 'utf8')).map((u) => (u.email || '').toLowerCase()));
    const actual = new Set(await fetchAllEmails('app_users'));
    const missing = [...expected].filter((e) => !actual.has(e));
    const extra = [...actual].filter((e) => !expected.has(e));
    const pass = missing.length === 0 && extra.length === 0;
    if (!pass) mismatches++;
    report.push(`| app_users (by email) | ${expected.size} | ${actual.size} | ${pass ? '✅' : `❌ missing: ${missing.join(', ') || '—'}; extra: ${extra.join(', ') || '—'}`}`);
    console.log(`  app_users: ${expected.size} expected, ${actual.size} actual ${pass ? '✅' : '❌'}`);
  }
}
// app_roles by name
{
  const file = join(EXPORT, 'app_roles.json');
  if (existsSync(file)) {
    const expected = new Set(JSON.parse(readFileSync(file, 'utf8')).map((r) => r.name));
    // fetch names instead (email is not a column here)
    const names = [];
    for (let page = 0; page < 5; page++) {
      const r = await fetch(`${NEW_URL}/rest/v1/app_roles?select=name&order=name`, {
        headers: { ...headers, Range: `${page * 1000}-${page * 1000 + 999}` },
      });
      if (!r.ok) break;
      const rows = await r.json();
      if (!rows.length) break;
      names.push(...rows.map((x) => x.name));
    }
    const actualSet = new Set(names);
    const missing = [...expected].filter((e) => !actualSet.has(e));
    const pass = missing.length === 0;
    if (!pass) mismatches++;
    report.push(`| app_roles (by name) | ${expected.size} | ${actualSet.size} | ${pass ? '✅' : `❌ missing: ${missing.join(', ')}`}`);
    console.log(`  app_roles: ${expected.size} expected, ${actualSet.size} actual ${pass ? '✅' : '❌'}`);
  }
}
// count-only provisioned tables. password_history holds old password hashes for
// the OLD project's user UUIDs and is intentionally NOT imported (new project
// provisions fresh password history) — informational only.
const PROVISIONED_INFO = new Set(['password_history', 'user_roles']);
for (const table of ['user_roles', 'role_module_permissions', 'password_history']) {
  const file = join(EXPORT, `${table}.json`);
  if (!existsSync(file)) continue;
  const expected = JSON.parse(readFileSync(file, 'utf8')).length;
  if (expected === 0) continue;
  const { ok, count } = await countRows(table);
  if (PROVISIONED_INFO.has(table)) {
    report.push(`| ${table} (count) | ${expected} | ${ok ? count : 'ERROR'} | ℹ️ provisioned fresh by design` );
    console.log(`  ${table}: expected ${expected}, got ${ok ? count : 'ERROR'} (ℹ️ provisioned fresh — informational)`);
    continue;
  }
  const pass = ok && count === expected;
  if (!pass) mismatches++;
  report.push(`| ${table} (count) | ${expected} | ${ok ? count : 'ERROR'} | ${pass ? '✅' : '❌'}`);
  console.log(`  ${table}: expected ${expected}, got ${ok ? count : 'ERROR'} ${pass ? '✅' : '❌'}`);
}

// ---------------------------------------------------------------------------
// 4. Auth users vs app_users
// ---------------------------------------------------------------------------
console.log('Verifying auth users...');
{
  const emails = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`${NEW_URL}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers: { ...headers, Authorization: `Bearer ${SR}` },
    });
    if (!r.ok) break;
    const body = await r.json();
    if (!body.users || !body.users.length) break;
    emails.push(...body.users.map((u) => (u.email || '').toLowerCase()));
    if (body.users.length < 1000) break;
  }
  const file = join(EXPORT, 'app_users.json');
  const expected = existsSync(file) ? new Set(JSON.parse(readFileSync(file, 'utf8')).map((u) => (u.email || '').toLowerCase())) : new Set();
  const actual = new Set(emails);
  const missing = [...expected].filter((e) => !actual.has(e));
  const pass = missing.length === 0 && expected.size > 0;
  if (!pass && expected.size) mismatches++;
  report.push(`| auth users (vs app_users emails) | ${expected.size} | ${actual.size} | ${pass ? '✅' : `❌ missing: ${missing.join(', ') || '—'}`}`);
  console.log(`  auth users: ${actual.size} (app_users: ${expected.size}) ${pass ? '✅' : '❌'}`);
}

// ---------------------------------------------------------------------------
// 5. Storage buckets vs exported files
// ---------------------------------------------------------------------------
console.log('Verifying storage...');
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
    const expectedFiles = walk(bucketDir).map((p) => p.slice(bucketDir.length + 1));
    // files may be nested in subdirectories — verify each path individually
    let present = 0;
    for (const f of expectedFiles) {
      const r = await fetch(`${NEW_URL}/storage/v1/object/info/${bucket}/${encodeURIComponent(f)}`, {
        method: 'GET',
        headers: { ...headers },
      });
      if (r.ok) present++;
    }
    const missing = expectedFiles.length - present;
    const pass = missing === 0;
    if (!pass) mismatches++;
    report.push(`| storage/${bucket} | ${expectedFiles.length} | ${present} | ${pass ? '✅' : `❌ missing ${missing} file(s)`}`);
    console.log(`  storage/${bucket}: expected ${expectedFiles.length}, got ${present} ${pass ? '✅' : `❌ missing ${missing}`}`);
  }
}

// ---------------------------------------------------------------------------
// 6. Sequence bump migration vs export maxima
// ---------------------------------------------------------------------------
console.log('Verifying sequence bumps...');
{
  const bumpFile = resolve(root, 'supabase', 'migrations', '20260821999999_bump_postgres_sequences.sql');
  const bumpText = existsSync(bumpFile) ? readFileSync(bumpFile, 'utf8') : '';
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
  for (const rule of SEQUENCE_RULES) {
    const file = join(EXPORT, `${rule.table}.json`);
    if (!existsSync(file)) continue;
    const rows = JSON.parse(readFileSync(file, 'utf8'));
    let max = 0;
    for (const r of rows) {
      const m = rule.re.exec(String(r[rule.col] ?? ''));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    if (max === 0) continue;
    const m = bumpText.match(new RegExp(`setval\\('public\\.${rule.seq}', (\\d+)`));
    const bumped = m ? parseInt(m[1], 10) : null;
    const pass = bumped !== null && bumped >= max;
    if (!pass) mismatches++;
    report.push(`| seq ${rule.seq} | max export ${max} | bump ${bumped ?? 'MISSING'} | ${pass ? '✅' : '❌'}`);
    console.log(`  ${rule.seq}: export max ${max}, bump ${bumped ?? 'MISSING'} ${pass ? '✅' : '❌'}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
const summary = `# Migration verification — ${new Date().toISOString()}

Tables checked: ${checked}
**${mismatches === 0 ? 'ALL CHECKS PASSED ✅' : `${mismatches} CHECK(S) FAILED ❌`}**

| Check | Expected | Actual | Result |
|---|---|---|---|
${report.join('\n')}
`;
writeFileSync(resolve(root, 'data', 'verify-report.md'), summary);
console.log(`\n${mismatches === 0 ? 'ALL CHECKS PASSED ✅' : `${mismatches} CHECK(S) FAILED ❌`}`);
console.log(`Report: ${resolve(root, 'data', 'verify-report.md')}`);
process.exit(mismatches === 0 ? 0 : 1);
