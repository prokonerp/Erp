#!/usr/bin/env node
/**
 * backup-supabase.mjs — Fast full backup of all Supabase tables into a single JSON file.
 * Uses service_role key to bypass RLS and paginates with parallel fetching.
 *
 * Usage: node scripts/backup-supabase.mjs
 * Output: backups/supabase-backup-<timestamp>.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  for (const fname of ['.env', '.env.local']) {
    try {
      const txt = readFileSync(resolve(root, fname), 'utf8');
      for (const line of txt.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
        if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
      }
    } catch {}
  }
}
loadEnv();

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

console.log(`→ Backing up: ${SUPABASE_URL}`);
console.log(`→ Using service_role key: ${SERVICE_KEY.slice(0, 12)}...`);

// 1. Discover tables via OpenAPI spec
console.log('→ Discovering tables...');
const specRes = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: HEADERS });
if (!specRes.ok) {
  console.error(`Failed to fetch OpenAPI spec: ${specRes.status} ${await specRes.text()}`);
  process.exit(1);
}
const spec = await specRes.json();
const tables = Object.keys(spec.definitions || {}).sort();
console.log(`  Found ${tables.length} tables: ${tables.join(', ')}`);

if (tables.length === 0) {
  console.error('No tables found in definitions. Check service_role key / project.');
  process.exit(1);
}

// 2. Fetch each table with pagination + concurrency
async function fetchAll(table) {
  const rows = [];
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?select=*&limit=${PAGE}&offset=${offset}`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`${r.status} ${body.slice(0, 400)}`);
    }
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
    // optional: show progress for large tables
    if (rows.length % 5000 === 0) console.log(`    ${table}: ${rows.length} rows...`);
  }
  return rows;
}

// Parallel pool
const CONCURRENCY = 12;
const results = {};
const errors = {};
let done = 0;
let totalRows = 0;
const started = Date.now();

async function runPool() {
  let idx = 0;
  async function worker() {
    while (idx < tables.length) {
      const i = idx++;
      const table = tables[i];
      const t0 = Date.now();
      try {
        const rows = await fetchAll(table);
        results[table] = rows;
        totalRows += rows.length;
        const ms = Date.now() - t0;
        console.log(`  [${++done}/${tables.length}] ${table}: ${rows.length} rows (${ms}ms)`);
      } catch (e) {
        errors[table] = e.message;
        results[table] = [];
        console.log(`  [${++done}/${tables.length}] ${table}: ERROR — ${e.message.slice(0, 150)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tables.length) }, () => worker()));
}

await runPool();

// 3. Build single JSON
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(root, 'backups');
mkdirSync(outDir, { recursive: true });
const outFile = resolve(outDir, `supabase-backup-${timestamp}.json`);
const latestFile = resolve(outDir, `supabase-backup-latest.json`);

const payload = {
  _meta: {
    project_id: process.env.SUPABASE_PROJECT_ID || process.env.VITE_SUPABASE_PROJECT_ID || null,
    supabase_url: SUPABASE_URL,
    backed_up_at: new Date().toISOString(),
    tables_count: tables.length,
    total_rows: totalRows,
    duration_ms: Date.now() - started,
    tables: Object.fromEntries(tables.map(t => [t, { rows: (results[t] || []).length, error: errors[t] || null }])),
    errors,
  },
  data: results,
};

writeFileSync(outFile, JSON.stringify(payload, null, 2));
writeFileSync(latestFile, JSON.stringify(payload, null, 2));

const sizeMB = (Buffer.byteLength(JSON.stringify(payload)) / 1024 / 1024).toFixed(2);
const fileSizeMB = (readFileSync(outFile).length / 1024 / 1024).toFixed(2);

console.log(`\n✓ Backup complete in ${((Date.now() - started)/1000).toFixed(1)}s`);
console.log(`  Tables: ${tables.length}  Total rows: ${totalRows}  Size: ~${fileSizeMB} MB (pretty) / ${sizeMB} MB (raw)`);
console.log(`  Saved: ${outFile}`);
console.log(`  Latest: ${latestFile}`);
if (Object.keys(errors).length) {
  console.log(`  Errors on ${Object.keys(errors).length} tables:`);
  for (const [t, e] of Object.entries(errors)) console.log(`    - ${t}: ${e.slice(0,120)}`);
}
