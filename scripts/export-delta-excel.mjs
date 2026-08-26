#!/usr/bin/env node
/**
 * export-delta-excel.mjs
 * Generates Excel workbook from OLD missing deltas (data/old-additions/*.json)
 * Each table becomes one sheet; Summary sheet lists counts.
 * Output: data/old-additions.xlsx
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const deltaDir = join(root, 'data', 'old-additions');
const outFile = join(root, 'data', 'old-additions.xlsx');

if(!existsSync(deltaDir)){
  console.error(`No delta dir: ${deltaDir} — run detect-old-additions first`);
  process.exit(1);
}
const files = readdirSync(deltaDir).filter(f=>f.endsWith('.json')).sort();
if(!files.length){
  console.error('No delta JSON files found');
  process.exit(1);
}

const wb = XLSX.utils.book_new();

// Summary sheet first
let summary = [];
let totalRows = 0;
for(const f of files){
  const table = basename(f,'.json');
  const rows = JSON.parse(readFileSync(join(deltaDir,f),'utf8'));
  summary.push({Table: table, Rows: rows.length, File: f});
  totalRows += rows.length;
}
summary.unshift({Table: 'TOTAL DELTA (>2026-08-21 missing in NEW)', Rows: totalRows, File: ''});
summary.push({Table: 'Cutoff', Rows: '2026-08-21T00:00:00Z', File: 'created_at > cutoff and ID not in NEW'});
summary.push({Table: 'OLD', Rows: 'https://vimkodursmcsaptrrzbl.supabase.co', File: ''});
summary.push({Table: 'NEW', Rows: 'https://cqjmcfwsrljxhixzfgpk.supabase.co', File: ''});
summary.push({Table: 'Generated', Rows: new Date().toISOString(), File: ''});

const wsSummary = XLSX.utils.json_to_sheet(summary);
wsSummary['!cols'] = [{wch:28},{wch:12},{wch:40}];
XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

// Per-table sheets
for(const f of files){
  const table = basename(f,'.json');
  const rows = JSON.parse(readFileSync(join(deltaDir,f),'utf8'));
  // Normalize: stringify JSON/object columns, format dates as strings
  const normalized = rows.map(r=>{
    const o={};
    for(const [k,v] of Object.entries(r)){
      if(v===null || v===undefined) o[k]='';
      else if(typeof v==='object') o[k]=JSON.stringify(v);
      else o[k]=v;
    }
    return o;
  });
  // Determine header order: put id, created_at first
  let headers = [];
  if(normalized.length){
    const allKeys = new Set();
    normalized.forEach(r=> Object.keys(r).forEach(k=> allKeys.add(k)));
    const preferred = ['id','case_id','company','name','customer_name','phone','email','status','created_at','updated_at'];
    headers = [
      ...preferred.filter(k=> allKeys.has(k)),
      ...[...allKeys].filter(k=> !preferred.includes(k)).sort()
    ];
  }
  const ws = XLSX.utils.json_to_sheet(normalized, {header: headers});
  // Auto width
  const cols = headers.map(h=>{
    const max = Math.max(h.length, ...normalized.map(r=> String(r[h]||'').length).slice(0,100));
    return {wch: Math.min(40, Math.max(12, max+2))};
  });
  ws['!cols'] = cols;
  // Freeze header
  ws['!freeze'] = {xSplit:0, ySplit:1, topLeftCell:'A2', activePane:'bottomLeft'};
  // Sheet name max 31 chars, sanitize
  let sheetName = table.slice(0,31);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  console.log(`  ${table}: ${rows.length} rows -> sheet "${sheetName}" cols ${headers.length}`);
}

XLSX.writeFile(wb, outFile);
console.log(`\nExcel written: ${outFile} (${files.length} sheets + Summary, ${totalRows} total rows)`);

// Also write CSVs per table for convenience
import { mkdirSync, writeFileSync } from 'node:fs';
const csvDir = join(root, 'data', 'old-additions-csv');
mkdirSync(csvDir, {recursive:true});
for(const f of files){
  const table=basename(f,'.json');
  const rows=JSON.parse(readFileSync(join(deltaDir,f),'utf8'));
  if(!rows.length) continue;
  const wb2=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(rows.map(r=>{
    const o={};
    for(const [k,v] of Object.entries(r)) o[k]= (v===null? '': typeof v==='object'? JSON.stringify(v): v);
    return o;
  }));
  const csv=XLSX.utils.sheet_to_csv(ws);
  writeFileSync(join(csvDir, `${table}.csv`), csv);
}
console.log(`CSVs also written to: ${csvDir}/`);
