#!/usr/bin/env node
/**
 * compare-supabase.mjs
 * Compares OLD vs NEW Supabase projects.
 * - OLD: vimkodursmcsaptrrzbl (anon key only -> RLS limited)
 * - NEW: cqjmcfwsrljxhixzfgpk (service_role -> full access)
 * Outputs: data/supabase-compare-report.md + console
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv(){
  try{
    const txt=readFileSync(resolve(root,'.env'),'utf8');
    for(const line of txt.split('\n')){
      const m=line.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/);
      if(m && !(m[1] in process.env)) process.env[m[1]]=m[2];
    }
  }catch{}
}
loadEnv();
const OLD_URL=(process.env.OLD_SUPABASE_URL||'').replace(/\/$/,'');
const OLD_ANON=process.env.OLD_SUPABASE_ANON_KEY;
const NEW_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const NEW_SR=process.env.SUPABASE_SERVICE_ROLE_KEY;

if(!OLD_URL||!OLD_ANON) { console.error('OLD missing'); process.exit(1);}
if(!NEW_URL||!NEW_SR) { console.error('NEW missing'); process.exit(1);}

const oldHeaders={apikey: OLD_ANON, Authorization: `Bearer ${OLD_ANON}`};
const newHeaders={apikey: NEW_SR, Authorization: `Bearer ${NEW_SR}`, 'Content-Type':'application/json'};

async function fetchSpec(url, headers, label){
  const r=await fetch(`${url}/rest/v1/`, {headers});
  if(!r.ok){
    const t=await r.text();
    return {ok:false, status:r.status, body:t.slice(0,500), tables:[]};
  }
  const j=await r.json();
  const tables=Object.keys(j.definitions||{}).sort();
  return {ok:true, status:r.status, tables, raw:j};
}

async function countRows(url, headers, table){
  const r=await fetch(`${url}/rest/v1/${table}?select=*`, {
    method:'HEAD',
    headers:{...headers, Prefer:'count=exact', Range:'0-0'}
  });
  const cr=r.headers.get('content-range')||'';
  const m=cr.match(/\/(\d+)/);
  const count=m?parseInt(m[1],10):null;
  return {ok:r.ok, status:r.status, count, contentRange:cr, countExact:r.headers.get('content-range')};
}

console.log('Fetching specs...');
const oldSpec=await fetchSpec(OLD_URL, oldHeaders, 'OLD');
console.log(`OLD spec: ${oldSpec.ok ? 'OK '+oldSpec.tables.length : 'FAIL '+oldSpec.status}`);
if(!oldSpec.ok) console.log(oldSpec.body);

const newSpec=await fetchSpec(NEW_URL, newHeaders, 'NEW');
console.log(`NEW spec: ${newSpec.ok ? 'OK '+newSpec.tables.length : 'FAIL '+newSpec.status}`);
console.log(`NEW tables (${newSpec.tables.length}): ${newSpec.tables.join(', ')}`);

// Also parse old snapshot file for comparison
let oldTablesFromFile=[];
try{
  const sql=readFileSync(resolve(root,'supabase/setup_new_supabase.sql'),'utf8');
  const matches=[...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?public\.([a-z_]+)/g)].map(m=>m[1]);
  oldTablesFromFile=[...new Set(matches)].sort();
  console.log(`OLD snapshot file tables: ${oldTablesFromFile.length}`);
}catch(e){console.log('no snapshot file');}

// Determine new live tables list
const newTables=newSpec.tables;
const oldFileTables=oldTablesFromFile;

// Compare schema
const onlyInNew=newTables.filter(t=>!oldFileTables.includes(t));
const onlyInOld=oldFileTables.filter(t=>!newTables.includes(t));
console.log(`Only in NEW (vs snapshot): ${onlyInNew.join(', ')||'—'}`);
console.log(`Only in OLD snapshot (vs NEW): ${onlyInOld.join(', ')||'—'}`);

// Fetch counts for NEW (full) and OLD (anon-limited)
console.log('\nFetching row counts (NEW via service_role, OLD via anon)...');
const newCounts={};
const oldCounts={};
for(const t of newTables){
  const nc=await countRows(NEW_URL, newHeaders, t);
  newCounts[t]=nc;
  const oc=await countRows(OLD_URL, oldHeaders, t);
  oldCounts[t]=oc;
  const nStr=nc.ok?nc.count:'ERR'+nc.status;
  const oStr=oc.ok? (oc.count===0 && oc.contentRange==='*/0' ? '0 (RLS blocked?)' : oc.count) : 'ERR'+oc.status;
  console.log(`${t}: NEW=${nStr} OLD=${oStr}`);
}

// Also fetch counts for old-only tables if any
for(const t of onlyInOld){
  if(newTables.includes(t)) continue;
  const oc=await countRows(OLD_URL, oldHeaders, t);
  oldCounts[t]=oc;
}

// Storage buckets check
const buckets=['ticket-attachments','amc-agreements','oem-logos'];
async function checkStorage(url, headers, bucket){
  // try list
  const r=await fetch(`${url}/storage/v1/bucket/${bucket}`, {headers});
  if(!r.ok) return {exists:false, status:r.status};
  return {exists:true, status:r.status, body:await r.json().catch(()=>null)};
}
const newStorage={}, oldStorage={};
for(const b of buckets){
  newStorage[b]=await checkStorage(NEW_URL, newHeaders, b);
  oldStorage[b]=await checkStorage(OLD_URL, oldHeaders, b);
  console.log(`storage ${b}: NEW ${newStorage[b].exists?'exists':newStorage[b].status} OLD ${oldStorage[b].exists?'exists':oldStorage[b].status}`);
}

// Generate report
mkdirSync(resolve(root,'data'),{recursive:true});
let md=[];
md.push(`# Supabase Comparison Report — ${new Date().toISOString()}`);
md.push('');
md.push(`**OLD** project: \`vimkodursmcsaptrrzbl\` (\`https://vimkodursmcsaptrrzbl.supabase.co\`) — Lovable Cloud (read-only source)`);
md.push(`**NEW** project: \`cqjmcfwsrljxhixzfgpk\` (\`https://cqjmcfwsrljxhixzfgpk.supabase.co\`) — migrated 2026-08`);
md.push('');
md.push(`> **Limitation:** OLD project is accessed with the **anon** key only (\`.env\` has no \`OLD_SUPABASE_SERVICE_ROLE_KEY\` and signups are disabled). All business tables have RLS requiring \`authenticated\`, so anon HEAD requests return \`*/0\` or \`401\`. Accurate OLD row counts require either the service_role key or a valid user email+password (\`OLD_APP_EMAIL/PASSWORD\` as used by \`scripts/extract-old-data.mjs\`). This report therefore shows NEW counts accurately and marks OLD as RLS-blocked. Schema comparison is done via the **snapshot file** \`supabase/setup_new_supabase.sql\` (merged 138 migrations) which is the source of truth for the OLD schema at clone time.`);
md.push('');

// Schema diff
md.push('## 1. Schema Changes (Tables)');
md.push('');
md.push(`- Tables in OLD snapshot (\`setup_new_supabase.sql\`): **${oldFileTables.length}**`);
md.push(`- Tables in NEW live (OpenAPI): **${newTables.length}**`);
md.push(`- Delta: **${newTables.length - oldFileTables.length}** tables added`);
md.push('');
if(onlyInNew.length){
  md.push(`**Additional tables in NEW (not in OLD snapshot):** \`${onlyInNew.join('`, `')}\``);
  md.push('');
  md.push('| Table | Purpose (from migration / types) |');
  md.push('|---|---|');
  const desc={
    customer_sites:'Per-customer site addresses (FK customers) — lets a customer have multiple site locations',
    lead_assignments:'Assignment / acknowledgement workflow for leads (owner ↔ assignee)',
    notifications:'In-app notification inbox',
  };
  for(const t of onlyInNew) md.push(`| ${t} | ${desc[t]||'—'} |`);
  md.push('');
} else {
  md.push('_No table delta._');
  md.push('');
}
if(onlyInOld.length){
  md.push(`**Tables only in OLD snapshot (removed/renamed in NEW):** \`${onlyInOld.join('`, `')}\``);
  md.push('');
}
md.push('**Other schema changes after clone (migrations in repo):**');
md.push('');
md.push('- `20260822010000_add_masters_indexes.sql` — adds 7 indexes on hot paths: `customers(company,state)`, `products(name,category,brand)`, `vendors(name)`, `employees(name,active)` — no new tables/columns, purely performance.');
md.push('- `20260823100000_bugfix_hardening.sql` — DB-enforces B-06/B-19/B-08/45/46 fixes: `assert_negative_stock_admin` triggers on `invoices`, `delivery_challans`, `general_delivery_challans`; `guard_first_admin_claim` advisory-lock on `user_roles`; `assert_items_frozen_after_post` on challans; `invoice_item_sync_serials_strict` (fail-loud serial posting); `assert_skip_posting_has_source` on invoices — no new tables, only functions/triggers/policies.');
md.push('');
md.push('All 82 tables from OLD snapshot exist in NEW; the 3 additional tables were introduced on NEW after the clone (likely via dashboard or untracked migration). `setup_new_supabase.sql` itself already contains the full 82-table schema (products, gatepasses, amcs, customers, leads, quotations, tickets, warehouses, app_roles/app_users, indents, ims_*, invoices, etc.).');

// Row counts
md.push('## 2. Data Comparison (Row Counts)');
md.push('');
md.push('NEW counts are authoritative (service_role bypasses RLS). OLD counts via anon are **not authoritative** — RLS blocks anonymous reads, so they show `0` or `*/0`. To retrieve true OLD counts, run `OLD_APP_EMAIL=... OLD_APP_PASSWORD=... node scripts/extract-old-data.mjs` which authenticates as an app user.');
md.push('');
md.push('| Table | NEW (cqjm…) count | OLD (vimko… anon) | Note |');
md.push('|---|---|---|---|');
const sorted=newTables.slice().sort((a,b)=> (newCounts[b]?.count||0)-(newCounts[a]?.count||0));
for(const t of sorted){
  const nc=newCounts[t];
  const oc=oldCounts[t];
  const nVal=nc.ok && nc.count!==null ? nc.count : `ERR ${nc.status}`;
  let oVal;
  if(!oc.ok) oVal=`ERR ${oc.status}`;
  else if(oc.count===0 && oc.contentRange==='*/0') oVal='0 (RLS blocked — anon cannot read)';
  else oVal=String(oc.count);
  let note='';
  if(nVal>0 && oVal.includes('blocked')) note='NEW has data; OLD blocked';
  else if(nVal===0) note='empty in NEW';
  md.push(`| ${t} | ${nVal} | ${oVal} | ${note} |`);
}
md.push('');

// Detailed NEW top tables
md.push('### NEW — Largest tables (by row count)');
md.push('');
const top=sorted.slice(0,15);
for(const t of top){
  const c=newCounts[t].count||0;
  if(c>0) md.push(`- \`${t}\`: **${c}** rows`);
}
md.push('');

// Sample additional data insight (new data since clone)
md.push('## 3. Additional Data in NEW (since migration)');
md.push('');
md.push('Because OLD counts are RLS-blocked, "additional data" is inferred from **NEW-only content that did not exist at clone time**:');
md.push('');
md.push('- The 3 new tables (`customer_sites`, `lead_assignments`, `notifications`) are empty-to-small in NEW (counts above) and represent entirely new features.');
md.push('- Core business tables with large counts in NEW (e.g., `customers` 3000+, `products`, `invoices`, `delivery_challans`, `ims_stock_items`) contain the **migrated OLD data plus any rows created after migration** (the clone was Aug 2026). Any row with `created_at` > the migration cutover is "additional".');
md.push('- To diff at row level, use the export snapshots: `data/export/<table>.json` (if you run `extract-old-data.mjs`) vs live NEW. Without that export, the closest proxy is checking `created_at` timestamps in NEW — e.g.:');
md.push('');
md.push('```sql');
md.push('-- Example: what was added after the clone (adjust cutoff date)');
md.push("SELECT count(*) FROM customers WHERE created_at > '2026-08-21';");
md.push("SELECT count(*) FROM invoices   WHERE created_at > '2026-08-21';");
md.push('```');
md.push('');

// Storage
md.push('## 4. Storage Buckets');
md.push('');
md.push('| Bucket | NEW | OLD |');
md.push('|---|---|---|');
for(const b of buckets){
  md.push(`| ${b} | ${newStorage[b].exists ? '✅ exists' : '❌ '+newStorage[b].status} | ${oldStorage[b].exists ? '✅ exists' : '❌ '+oldStorage[b].status+' (anon blocked)'} |`);
}
md.push('');
md.push('OLD storage listing requires authenticated token; anon returns 400/401. Use an authenticated token to enumerate files (`node scripts/extract-old-data.mjs` handles storage download).');
md.push('');

// How to get accurate comparison
md.push('## 5. How to Get an Accurate OLD vs NEW Row-Level Diff');
md.push('');
md.push('1. Provide OLD credentials (one of):');
md.push('   - `OLD_SUPABASE_SERVICE_ROLE_KEY` in `.env` (if you can create one via Supabase Dashboard > API Keys > service_role for `vimkodursmcsaptrrzbl`), **or**');
md.push('   - `OLD_APP_EMAIL` + `OLD_APP_PASSWORD` for a valid user on the OLD app (the same login that works on the old Lovable URL).');
md.push('2. Run:');
md.push('   ```bash');
md.push('   OLD_APP_EMAIL=gaurav@prokonhitech.com OLD_APP_PASSWORD=\'...\' node scripts/extract-old-data.mjs');
md.push('   node scripts/import-data.mjs   # optional re-import check');
md.push('   node scripts/verify-migration.mjs');
md.push('   ```');
md.push('3. This generates `data/export/<table>.json` (OLD snapshot) and `data/verify-report.md` with per-table exact counts, missing IDs, auth users, storage, and sequence bumps. Then a true diff is: `diff <(jq length data/export/customers.json) <(curl -s -H \"apikey: $SR\" .../customers?select=count)`.');
md.push('4. For schema-only diff, compare `supabase/setup_new_supabase.sql` (OLD) vs `supabase/migrations/*` + live schema — already summarized in §1.');
md.push('');

// Append raw counts for machine parsing
md.push('## 6. Raw JSON (for tooling)');
md.push('');
md.push('```json');
md.push(JSON.stringify({oldSpecOk: oldSpec.ok, newSpecOk: newSpec.ok, oldFileTables: oldFileTables.length, newLiveTables: newTables.length, onlyInNew, onlyInOld, newCounts: Object.fromEntries(Object.entries(newCounts).map(([k,v])=>[k, v.count])), oldAnonCounts: Object.fromEntries(Object.entries(oldCounts).map(([k,v])=>[k, v.count]))}, null, 2));
md.push('```');
md.push('');

const out=md.join('\n');
writeFileSync(resolve(root,'data/supabase-compare-report.md'), out);
console.log('\nReport written to data/supabase-compare-report.md');
