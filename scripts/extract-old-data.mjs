#!/usr/bin/env node
/**
 * extract-old-data.mjs
 * ---------------------------------------------------------------------------
 * Extracts ALL business data from the OLD Lovable Supabase project
 * (vimkodursmcsaptrrzbl) using a normal app login (email + password) — the
 * same access a user has. RLS determines what can be read; tables/policies
 * that block even authenticated reads are reported as SKIPPED.
 *
 * Usage:
 *   OLD_APP_EMAIL=gaurav@prokonhitech.com OLD_APP_PASSWORD='...' \
 *     node scripts/extract-old-data.mjs
 *
 * Output:
 *   data/export/<table>.json              — every row of every readable table
 *   data/export/storage/<bucket>/<path>   — downloadable storage objects
 *   data/export/SUMMARY.md                — per-table row counts + skips
 *
 * Credentials come from .env (OLD_SUPABASE_URL / OLD_SUPABASE_ANON_KEY) and
 * the OLD_APP_EMAIL / OLD_APP_PASSWORD environment variables.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'data', 'export');

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

const OLD_URL = process.env.OLD_SUPABASE_URL?.replace(/\/$/, '');
const OLD_ANON = process.env.OLD_SUPABASE_ANON_KEY;
const EMAIL = process.env.OLD_APP_EMAIL;
const PASSWORD = process.env.OLD_APP_PASSWORD;
if (!OLD_URL || !OLD_ANON) { console.error('Missing OLD_SUPABASE_URL / OLD_SUPABASE_ANON_KEY in .env'); process.exit(1); }
if (!EMAIL || !PASSWORD) { console.error('Set OLD_APP_EMAIL and OLD_APP_PASSWORD (a working login on the OLD app)'); process.exit(1); }

// --- Sign in on the OLD project ---
const res = await fetch(`${OLD_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: OLD_ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!res.ok) {
  const err = await res.json().catch(() => ({}));
  console.error(`LOGIN FAILED (${res.status}): ${err.error_description || err.msg || err.error || res.statusText}`);
  console.error('This must be a login that works on the OLD app (not the new one).');
  process.exit(1);
}
const { access_token: token, user } = await res.json();
console.log(`Signed in as ${user?.email} (${user?.id}) on OLD project`);
const AUTH = { apikey: OLD_ANON, Authorization: `Bearer ${token}` };

// --- Table list: read from the NEW project's OpenAPI (85 tables) ---
const NEW_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const NEW_SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiRes = await fetch(`${NEW_URL}/rest/v1/`, {
  headers: { apikey: NEW_SR, Authorization: `Bearer ${NEW_SR}` },
});
const spec = await apiRes.json();
const tables = Object.keys(spec.definitions || {}).sort();
console.log(`Tables to extract: ${tables.length}`);

mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'storage'), { recursive: true });

const summary = [];
let totalRows = 0;

async function fetchAll(table) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const r = await fetch(`${OLD_URL}/rest/v1/${table}?select=*&limit=1000&offset=${offset}`, { headers: AUTH });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`${r.status} ${body.slice(0, 300)}`);
    }
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < 1000) break;
    offset += batch.length;
  }
  return rows;
}

for (const table of tables) {
  try {
    const rows = await fetchAll(table);
    if (rows.length) writeFileSync(join(OUT, `${table}.json`), JSON.stringify(rows, null, 2));
    totalRows += rows.length;
    summary.push(`| ${table} | ${rows.length} | ok |`);
    console.log(`  ${table}: ${rows.length} rows`);
  } catch (e) {
    summary.push(`| ${table} | 0 | SKIPPED — ${e.message.slice(0, 120)} |`);
    console.log(`  ${table}: SKIPPED — ${e.message.slice(0, 120)}`);
  }
}

// --- Storage: list + download objects in the 3 buckets (recursive) ---
const BUCKETS = ['ticket-attachments', 'amc-agreements', 'oem-logos'];

async function listObjects(bucket, prefix) {
  const r = await fetch(`${OLD_URL}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!r.ok) throw new Error(`${r.status}`);
  const entries = await r.json();
  const files = [];
  for (const e of (Array.isArray(entries) ? entries : [])) {
    if (e.metadata === null || e.name.endsWith('/')) {
      // recurse with the FULL folder prefix (names are relative to the current prefix)
      files.push(...await listObjects(bucket, `${prefix}${e.name}/`));
    } else {
      files.push(prefix + e.name);
    }
  }
  return files;
}

for (const bucket of BUCKETS) {
  let paths = [];
  try {
    paths = await listObjects(bucket, '');
  } catch (e) {
    summary.push(`| storage/${bucket} | — | SKIPPED — ${e.message}`); continue;
  }
  console.log(`  storage/${bucket}: ${paths.length} objects`);
  let ok = 0, failed = 0;
  for (const path of paths) {
    const d = await fetch(`${OLD_URL}/storage/v1/object/${bucket}/${encodeURIComponent(path)}`, { headers: AUTH });
    if (d.ok) {
      const buf = Buffer.from(await d.arrayBuffer());
      const dest = join(OUT, 'storage', bucket, ...path.split('/'));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, buf);
      ok++;
    } else {
      failed++;
      console.log(`    FAILED ${d.status}: ${bucket}/${path}`);
    }
  }
  summary.push(`| storage/${bucket} | ${ok} | downloaded${failed ? `, ${failed} failed` : ''} |`);
}

// --- Summary ---
const lines = [
  `# Old project data extraction — ${new Date().toISOString()}`,
  '',
  `Signed in as: ${user?.email} (${user?.id})`,
  `Total rows extracted: ${totalRows}`,
  '',
  '| Object | Rows/files | Status |',
  '|---|---|---|',
  ...summary,
];
writeFileSync(join(OUT, 'SUMMARY.md'), lines.join('\n'));
console.log(`\nDone. ${totalRows} rows total. See ${join(OUT, 'SUMMARY.md')}`);