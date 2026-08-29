#!/usr/bin/env node
/**
 * sync-updated-rows.mjs
 * Syncs UPDATED existing rows (not just inserts) from OLD -> NEW where updated_at > cutoff
 * and content differs. Uses authenticated OLD token + NEW service_role.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv(){
  try{
    const txt=readFileSync(resolve(root,'.env'),'utf8');
    for(const l of txt.split('\n')){
      const m=l.match(/^([A-Z0-9_]+)="?([^"\n]*)"?$/);
      if(m && !(m[1] in process.env)) process.env[m[1]]=m[2];
    }
  }catch{}
}
loadEnv();
const NEW_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const NEW_SR=process.env.SUPABASE_SERVICE_ROLE_KEY;
const OLD_URL=(process.env.OLD_SUPABASE_URL||'').replace(/\/$/,'');
const OLD_ANON=process.env.OLD_SUPABASE_ANON_KEY;
const CUTOFF=process.argv.find(a=>a.includes('2026')) || '2026-08-21T00:00:00Z';
const cutoffArg=process.argv.find(a=>a.startsWith('--cutoff'));
let cutoff='2026-08-21T00:00:00Z';
if(cutoffArg){
  const eq=cutoffArg.indexOf('=');
  if(eq!==-1) cutoff=cutoffArg.slice(eq+1);
  else cutoff=process.argv[process.argv.indexOf('--cutoff')+1]||cutoff;
}
console.log(`Cutoff: ${cutoff}`);
const EMAIL=process.env.OLD_APP_EMAIL;
const PASS=process.env.OLD_APP_PASSWORD;
if(!EMAIL||!PASS){ console.error('Missing OLD_APP_EMAIL/PASS'); process.exit(1);}
const newHeaders={apikey: NEW_SR, Authorization: `Bearer ${NEW_SR}`, 'Content-Type':'application/json'};
let oldHeaders;
{
  const r=await fetch(`${OLD_URL}/auth/v1/token?grant_type=password`, {method:'POST', headers:{apikey:OLD_ANON,'Content-Type':'application/json'}, body:JSON.stringify({email:EMAIL,password:PASS})});
  if(!r.ok){ console.error('OLD login failed', await r.text()); process.exit(1);}
  const {access_token}=await r.json();
  oldHeaders={apikey: OLD_ANON, Authorization: `Bearer ${access_token}`};
}
const specRes=await fetch(`${NEW_URL}/rest/v1/`, {headers:newHeaders});
const tables=Object.keys((await specRes.json()).definitions||{}).sort();
console.log(`Tables: ${tables.length}`);

let totalChecked=0, totalDiff=0, totalPatched=0;
for(const table of tables){
  // Check if table has updated_at via probing
  const probe=await fetch(`${OLD_URL}/rest/v1/${table}?updated_at=gt.${encodeURIComponent(cutoff)}&select=id&limit=1`, {headers:oldHeaders});
  if(!probe.ok){
    const t=await probe.text();
    if(t.includes('does not exist')||t.includes('column')) continue; // no updated_at
    // skip tables without permission
    if(probe.status===403||probe.status===401) continue;
  }
  // Fetch OLD updated rows where updated_at > cutoff AND created_at <= cutoff (to avoid already-handled inserts)
  process.stdout.write(`Checking ${table} updated > ${cutoff}... `);
  let offset=0;
  let oldRows=[];
  for(;;){
    const filter=`updated_at=gt.${encodeURIComponent(cutoff)}&select=*`;
    const r=await fetch(`${OLD_URL}/rest/v1/${table}?${filter}&limit=1000&offset=${offset}`, {headers:oldHeaders});
    if(!r.ok){ console.log(`ERR ${r.status}`); break; }
    const batch=await r.json();
    oldRows.push(...batch);
    if(batch.length<1000) break;
    offset+=1000;
  }
  // Filter to only rows where created_at <= cutoff (updates to old rows)
  oldRows=oldRows.filter(r=> r.created_at && r.created_at <= cutoff);
  if(!oldRows.length){ console.log('0 updates'); continue; }
  console.log(`${oldRows.length} updated rows (created <= cutoff, updated > cutoff)`);
  // For each, fetch NEW row by id and compare
  for(const oldRow of oldRows){
    totalChecked++;
    const r=await fetch(`${NEW_URL}/rest/v1/${table}?id=eq.${oldRow.id}&select=*`, {headers:newHeaders});
    if(!r.ok) continue;
    const newRows=await r.json();
    if(!newRows.length) continue; // missing is handled by insert script
    const newRow=newRows[0];
    // Simple deep compare (stringify)
    const oldStr=JSON.stringify(oldRow, Object.keys(oldRow).sort());
    const newStr=JSON.stringify(newRow, Object.keys(newRow).sort());
    if(oldStr===newStr) continue;
    totalDiff++;
    // PATCH
    const patch=await fetch(`${NEW_URL}/rest/v1/${table}?id=eq.${oldRow.id}`, {
      method:'PATCH',
      headers:{...newHeaders, Prefer:'return=representation'},
      body: JSON.stringify(oldRow)
    });
    if(patch.ok){ totalPatched++; console.log(`  patched ${table} ${oldRow.id}`); }
    else {
      const t=await patch.text();
      console.log(`  failed patch ${table} ${oldRow.id}: ${t.slice(0,150)}`);
      // Try without id/created_at ?
    }
  }
}
console.log(`\nDone. Checked ${totalChecked} updated rows, ${totalDiff} differed, ${totalPatched} patched.`);

// Also verify counts after
console.log('\nIf patches applied, verify with detect script again.');
