#!/usr/bin/env node
/**
 * detect-old-additions.mjs
 * Finds rows added to OLD Supabase after the migration cutoff that are not yet in NEW.
 * Usage:
 *   OLD_APP_EMAIL=gaurav@prokonhitech.com OLD_APP_PASSWORD='...' \
 *   node scripts/detect-old-additions.mjs [--cutoff 2026-08-21T00:00:00Z]
 *   # or provide OLD_SERVICE_ROLE_KEY in .env to bypass RLS without user login
 *
 * Output: data/old-additions-report.md + data/old-additions.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
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

const NEW_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const NEW_SR=process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLD_URL=(process.env.OLD_SUPABASE_URL||'').replace(/\/$/,'');
const OLD_ANON=process.env.OLD_SUPABASE_ANON_KEY;
const OLD_SR=process.env.OLD_SUPABASE_SERVICE_ROLE_KEY || process.env.OLD_SERVICE_ROLE_KEY || null;

let cutoffArg = process.argv.find(a=>a.startsWith('--cutoff'));
let CUTOFF = '2026-08-21T00:00:00Z';
if(cutoffArg){
  const eq = cutoffArg.indexOf('=');
  if(eq!==-1) CUTOFF=cutoffArg.slice(eq+1);
  else {
    const idx=process.argv.indexOf('--cutoff');
    if(idx!==-1 && process.argv[idx+1]) CUTOFF=process.argv[idx+1];
  }
}
else if(process.argv[2] && !process.argv[2].startsWith('--')) CUTOFF=process.argv[2];

console.log(`Cutoff: ${CUTOFF}`);
console.log(`OLD: ${OLD_URL}`);
console.log(`NEW: ${NEW_URL}`);
if(!NEW_URL||!NEW_SR){ console.error('Missing NEW SUPABASE_URL/SERVICE_ROLE'); process.exit(1);}
if(!OLD_URL){ console.error('Missing OLD_SUPABASE_URL'); process.exit(1);}

const newHeaders={apikey: NEW_SR, Authorization: `Bearer ${NEW_SR}`, 'Content-Type':'application/json'};

// Resolve OLD auth token
let oldHeaders;
if(OLD_SR){
  console.log('Using OLD service_role from env');
  oldHeaders={apikey: OLD_SR, Authorization: `Bearer ${OLD_SR}`};
} else {
  const EMAIL=process.env.OLD_APP_EMAIL;
  const PASSWORD=process.env.OLD_APP_PASSWORD;
  if(!EMAIL||!PASSWORD){
    console.error('\nMissing OLD credentials.');
    console.error('Provide either:');
    console.error('  1) OLD_SUPABASE_SERVICE_ROLE_KEY in .env (Dashboard > Project API keys > service_role for vimkodursmcsaptrrzbl)');
    console.error('  2) OLD_APP_EMAIL + OLD_APP_PASSWORD env vars for a user that can log in on the OLD app');
    console.error('\nExample:');
    console.error("  OLD_APP_EMAIL=gaurav@prokonhitech.com OLD_APP_PASSWORD='...' node scripts/detect-old-additions.mjs --cutoff 2026-08-21");
    process.exit(1);
  }
  if(!OLD_ANON){ console.error('Missing OLD_SUPABASE_ANON_KEY'); process.exit(1);}
  console.log(`Signing in to OLD as ${EMAIL}...`);
  const r=await fetch(`${OLD_URL}/auth/v1/token?grant_type=password`, {
    method:'POST',
    headers:{apikey: OLD_ANON, 'Content-Type':'application/json'},
    body: JSON.stringify({email: EMAIL, password: PASSWORD})
  });
  if(!r.ok){
    const j=await r.json().catch(()=>({}));
    console.error(`OLD login failed ${r.status}: ${j.error_description||j.msg||j.error||await r.text()}`);
    process.exit(1);
  }
  const {access_token, user}=await r.json();
  console.log(`Signed in: ${user.email} (${user.id})`);
  oldHeaders={apikey: OLD_ANON, Authorization: `Bearer ${access_token}`};
}

// Get table list from NEW OpenAPI
const specRes=await fetch(`${NEW_URL}/rest/v1/`, {headers: newHeaders});
if(!specRes.ok){ console.error('Failed to fetch NEW spec', await specRes.text()); process.exit(1);}
const spec=await specRes.json();
const tables=Object.keys(spec.definitions||{}).sort();
console.log(`Tables to check: ${tables.length}`);

async function fetchAllIds(url, headers, table){
  const ids=new Set();
  let offset=0;
  for(;;){
    const r=await fetch(`${url}/rest/v1/${table}?select=id&limit=1000&offset=${offset}`, {headers});
    if(!r.ok){
      if(r.status===400 || r.status===401 || r.status===403){
        const t=await r.text();
        throw new Error(`${r.status} ${t.slice(0,200)}`);
      }
      throw new Error(`${r.status} ${await r.text()}`);
    }
    const rows=await r.json();
    for(const row of rows) if(row.id) ids.add(row.id);
    if(rows.length<1000) break;
    offset+=1000;
  }
  return ids;
}

async function fetchFiltered(url, headers, table, cutoff){
  // Try fetching rows where created_at > cutoff OR updated_at > cutoff
  // Not all tables have created_at; try both, fallback to fetching all and filtering client-side
  const tryFetch = async(col)=>{
    const filter=`${col}=gt.${encodeURIComponent(cutoff)}`;
    let offset=0;
    const out=[];
    for(;;){
      const r=await fetch(`${url}/rest/v1/${table}?${filter}&select=*&limit=1000&offset=${offset}`, {headers});
      if(!r.ok){
        const t=await r.text();
        if(t.includes('column') && t.includes('does not exist')) return null; // column missing
        throw new Error(`${r.status} ${t.slice(0,300)}`);
      }
      const rows=await r.json();
      out.push(...rows);
      if(rows.length<1000) break;
      offset+=1000;
    }
    return out;
  };
  let rows = await tryFetch('created_at');
  if(rows===null) rows = await tryFetch('updated_at');
  if(rows===null){
    // No timestamp columns — fetch all and return (will diff by ID)
    let offset=0;
    rows=[];
    for(;;){
      const r=await fetch(`${url}/rest/v1/${table}?select=*&limit=1000&offset=${offset}`, {headers});
      if(!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      const batch=await r.json();
      rows.push(...batch);
      if(batch.length<1000) break;
      offset+=1000;
    }
    // No timestamp filter possible, return all rows (caller will diff by ID)
    // Mark as unfiltered
    rows._unfiltered=true;
  }
  return rows;
}

async function countRows(url, headers, table, cutoff){
  // HEAD count with filter
  const filter=`created_at=gt.${encodeURIComponent(cutoff)}`;
  const r=await fetch(`${url}/rest/v1/${table}?${filter}&select=*`, {method:'HEAD', headers:{...headers, Prefer:'count=exact', Range:'0-0'}});
  const cr=r.headers.get('content-range');
  const m=cr?.match(/\/(\d+)/);
  return m?parseInt(m[1],10):null;
}

// For each table, collect OLD rows after cutoff and check which IDs are missing in NEW
const report=[];
const jsonOut={cutoff: CUTOFF, oldUrl: OLD_URL, newUrl: NEW_URL, tables:{}};

for(const table of tables){
  process.stdout.write(`Checking ${table}... `);
  try{
    const oldRows=await fetchFiltered(OLD_URL, oldHeaders, table, CUTOFF);
    const isUnfiltered=oldRows._unfiltered;
    delete oldRows._unfiltered;
    let newIds;
    try{ newIds=await fetchAllIds(NEW_URL, newHeaders, table); }catch(e){ newIds=new Set(); }

    let missing;
    let recent;
    if(isUnfiltered){
      // Diff by ID only
      missing=oldRows.filter(r=> !newIds.has(r.id));
      recent=missing; // all missing are considered recent additions (no timestamp)
      console.log(`${oldRows.length} total in OLD, ${missing.length} missing in NEW (no timestamp col, ID diff)`);
    } else {
      // oldRows already filtered by created_at > cutoff
      // Among those, find which are not in NEW
      missing=oldRows.filter(r=> !newIds.has(r.id));
      recent=oldRows;
      console.log(`${recent.length} recent in OLD (>${CUTOFF}), ${missing.length} not in NEW`);
    }

    // Also fetch NEW recent count for context
    const newRecentCount=await countRows(NEW_URL, newHeaders, table, CUTOFF);

    report.push({table, oldRecent: recent.length, oldMissingInNew: missing.length, newRecent: newRecentCount, totalOld: isUnfiltered?oldRows.length:undefined, truncated: isUnfiltered});
    jsonOut.tables[table]={ oldRecent: recent.length, oldMissingInNew: missing.length, newRecent: newRecentCount, sampleMissing: missing.slice(0,5).map(r=> ({id:r.id, created_at:r.created_at, updated_at:r.updated_at, name:r.name||r.company||r.title||r.case_id||r.challan_no||''})) };

    // If there are missing, write detailed json per table for import
    if(missing.length>0){
      mkdirSync(join(root,'data','old-additions'), {recursive:true});
      writeFileSync(join(root,'data','old-additions',`${table}.json`), JSON.stringify(missing, null, 2));
    }
  }catch(e){
    console.log(`SKIPPED (${e.message.slice(0,150)})`);
    report.push({table, error: e.message.slice(0,200)});
    jsonOut.tables[table]={error: e.message.slice(0,200)};
  }
}

// Write report
mkdirSync(join(root,'data'), {recursive:true});
writeFileSync(join(root,'data','old-additions.json'), JSON.stringify(jsonOut, null, 2));

let md=[];
md.push(`# OLD Additions Report — ${new Date().toISOString()}`);
md.push('');
md.push(`**Cutoff:** \`${CUTOFF}\` (rows with \`created_at\` > cutoff, or ID not in NEW if no timestamp)`);
md.push(`**OLD:** \`${OLD_URL}\``);
md.push(`**NEW:** \`${NEW_URL}\``);
md.push('');
md.push('| Table | OLD recent (>cutoff) | OLD missing in NEW | NEW recent (>cutoff) | Action |');
md.push('|---|---|---|---|---|');
for(const r of report){
  if(r.error){
    md.push(`| ${r.table} | ERR | ERR | — | SKIPPED: ${r.error} |`);
  } else {
    const action = r.oldMissingInNew>0 ? `**PUSH ${r.oldMissingInNew}**` : (r.oldRecent>0 ? 'already synced' : '—');
    md.push(`| ${r.table} | ${r.oldRecent} | ${r.oldMissingInNew} | ${r.newRecent ?? '—'} | ${action} |`);
  }
}
md.push('');
md.push('## How to push missing rows to NEW');
md.push('');
md.push('Missing rows have been saved to `data/old-additions/<table>.json` (only tables with missing >0). To import:');
md.push('```bash');
md.push('node scripts/import-data.mjs   # will import data/export — OR');
md.push('# custom import for just the delta:');
md.push('for f in data/old-additions/*.json; do');
md.push('  table=$(basename \"$f\" .json)');
md.push('  echo \"Importing $table...\"');
md.push('  # uses service_role, handles FK order via the script\'s topological sort');
md.push('  curl -X POST \"$SUPABASE_URL/rest/v1/$table\" \\');
md.push('    -H \"apikey: $SUPABASE_SERVICE_ROLE_KEY\" \\');
md.push('    -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\');
md.push('    -H \"Prefer: resolution=ignore-duplicates\" \\');
md.push('    -d \"@$f\"');
md.push('done');
md.push('```');
md.push('');
md.push('Alternatively re-run the full export+import pipeline:');
md.push('```bash');
md.push('OLD_APP_EMAIL=... OLD_APP_PASSWORD=... node scripts/extract-old-data.mjs');
md.push('node scripts/import-data.mjs');
md.push('node scripts/verify-migration.mjs');
md.push('```');
md.push('');
md.push('## Notes');
md.push('- Tables with no `created_at` column (e.g., sequences, lookups) are diffed by ID only.');
md.push('- If OLD has 0 recent, employees may be updating existing rows (check `updated_at` > cutoff — the script also checks `updated_at` if `created_at` missing). For updates, the diff will show as missing IDs only if it is a new row; updates to existing rows need row-level merge (not just ID diff).');
md.push('- To detect **updates** to existing rows, compare `updated_at` timestamps or hash the row content.');
md.push('');

writeFileSync(join(root,'data','old-additions-report.md'), md.join('\n'));
console.log('\nDone. Reports: data/old-additions-report.md, data/old-additions.json');
console.log('Per-table delta files (if any): data/old-additions/*.json');
