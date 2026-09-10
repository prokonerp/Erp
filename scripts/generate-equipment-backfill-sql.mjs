#!/usr/bin/env node
/**
 * generate-equipment-backfill-sql.mjs
 * ------------------------------------
 * Generates an idempotent SQL file to backfill installed_equipment from tickets.
 *
 * Filters (per user request):
 *   - open + closed + valid = status IN ('Closed','New','In Progress','Under Observation','Parts Received')
 *     (excludes 'Cancelled'; excludes is_deleted=true)
 *   - customer_id IS NOT NULL  (customer exists in masters)
 *   - product (model_no) trimmed not empty
 *   - serial_no valid: not in false sentinels (na, null, -, false, #n/a, nil, none), length >=3
 *   - deduped by (customer_id, upper(serial_no)) -> keep earliest ticket by created_at
 *   - skip if already exists in installed_equipment (customer_id, upper(serial_no))
 *
 * Output: backups/backfill_installed_equipment_YYYY-MM-DD.sql  (you run it yourself in Supabase SQL Editor)
 *         Also: backups/backfill_preview.csv  (human review)
 *
 * Safety: Read-only by default. This script NEVER writes to DB. It only reads via service_role
 *         and writes local SQL/CSV files. The generated SQL is idempotent - re-running inserts 0 new rows
 *         because of WHERE NOT EXISTS guard.
 *
 * Usage: node scripts/generate-equipment-backfill-sql.mjs [--out backups/backfill_installed_equipment.sql]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const HEADERS = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

// Helpers
const FALSE_SENTINELS = new Set(['false', 'null', 'nil', '#n/a', 'na', '-', 'n/a', 'none', '']);
function isValidSerial(s) {
  if (!s) return false;
  const t = String(s).trim();
  if (!t) return false;
  if (t.length < 3) return false;
  if (FALSE_SENTINELS.has(t.toLowerCase())) return false;
  // also reject obvious placeholders like "NA" with any casing, "N/A", etc.
  if (t.toLowerCase() === 'na' || t.toLowerCase() === 'n/a') return false;
  return true;
}
function sqlEscape(str) {
  return String(str).replace(/'/g, "''");
}
function toTitleCaseSmart(s) {
  // keep original casing from ticket.product but trim; server will store as-is aside from serial upper
  return String(s).trim();
}

async function fetchAll(table, select='*', pageSize=1000) {
  const rows=[];
  let offset=0;
  for(;;){
    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?select=${encodeURIComponent(select)}&limit=${pageSize}&offset=${offset}`;
    const r = await fetch(url, { headers: HEADERS });
    if(!r.ok){
      const body=await r.text();
      throw new Error(`fetch ${table} failed ${r.status}: ${body.slice(0,400)}`);
    }
    const batch = await r.json();
    rows.push(...batch);
    if(batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

console.log(`→ Connecting to ${SUPABASE_URL}`);
console.log(`→ Discovering data (tickets, installed_equipment, products, customers) ...`);

// 1. Fetch data
const [tickets, installed, products, customers] = await Promise.all([
  fetchAll('tickets', 'id,case_id,customer_id,product,serial_no,status,is_deleted,created_at'),
  fetchAll('installed_equipment', 'id,customer_id,serial_no,model_no,created_at'),
  fetchAll('products', 'id,model,active'),
  fetchAll('customers', 'id,company'),
]);

console.log(`  tickets: ${tickets.length}`);
console.log(`  installed_equipment: ${installed.length}`);
console.log(`  products: ${products.length}`);
console.log(`  customers: ${customers.length}`);

// 2. Build existing set
const existingSet = new Set(
  installed
    .filter(r => r.customer_id && r.serial_no && isValidSerial(r.serial_no))
    .map(r => `${r.customer_id}|${String(r.serial_no).trim().toUpperCase()}`)
);
console.log(`  existing dedup keys (valid serials): ${existingSet.size}`);

// 3. Product lookup (exact trimmed match, case-sensitive and lower fallback)
const byModelExact = new Map(); // trimmed exact -> product id
const byModelLower = new Map(); // lower -> product id
for(const p of products){
  const m = String(p.model||'').trim();
  if(!m) continue;
  if(!byModelExact.has(m)) byModelExact.set(m, p.id);
  const low = m.toLowerCase();
  if(!byModelLower.has(low)) byModelLower.set(low, p.id);
}

// Customer map for preview
const custMap = new Map(customers.map(c=>[c.id, c.company||c.id]));

// 4. Filter tickets per spec
const VALID_STATUSES = new Set(['Closed','New','In Progress','Under Observation','Parts Received']);
// Alternative: also treat 'open' as same as New/In Progress. We include all valid open+closed.
const candidates = tickets.filter(t => {
  if(t.is_deleted) return false;
  if(!VALID_STATUSES.has(t.status)) return false;
  if(!t.customer_id) return false;
  const prod = String(t.product||'').trim();
  if(!prod) return false;
  if(!isValidSerial(t.serial_no)) return false;
  return true;
});

console.log(`\n  candidates (is_deleted=false, status in [${Array.from(VALID_STATUSES).join(', ')}], has customer, product, valid serial): ${candidates.length}`);
const byStatus = {};
candidates.forEach(t=>{ byStatus[t.status]=(byStatus[t.status]||0)+1; });
console.log(`    by status:`, byStatus);

// 5. Deduplicate within tickets by customer|serial, keep earliest created_at
candidates.sort((a,b)=> new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
const seen = new Map(); // key -> ticket
for(const t of candidates){
  const key = `${t.customer_id}|${String(t.serial_no).trim().toUpperCase()}`;
  if(!seen.has(key)) seen.set(key, t);
  // else duplicate within tickets -> skip (keep earliest)
}
console.log(`  distinct candidate keys (customer|serial): ${seen.size}  (deduped ${candidates.length - seen.size} dupes within tickets)`);

// 6. Skip pre-existing
const toInsert = [];
const skippedExisting = [];
for(const [key, t] of seen){
  if(existingSet.has(key)){
    skippedExisting.push(t);
  } else {
    toInsert.push(t);
  }
}
console.log(`  already in installed_equipment: ${skippedExisting.length}`);
console.log(`  => NEW rows to generate: ${toInsert.length}`);

if(toInsert.length===0){
  console.log('\n✓ Nothing to backfill — SQL file will be empty (only header).');
}

// 7. Resolve product_id for each toInsert
let prodExactHit=0, prodLowerHit=0, prodMiss=0;
for(const t of toInsert){
  const m = String(t.product).trim();
  let pid = byModelExact.get(m) || null;
  if(pid) prodExactHit++;
  else {
    const low = m.toLowerCase();
    pid = byModelLower.get(low) || null;
    if(pid) prodLowerHit++;
    else prodMiss++;
  }
  t._productId = pid;
  t._modelNo = m; // keep original trimmed
}
console.log(`  product resolution: exact=${prodExactHit}, case-insensitive=${prodLowerHit}, miss (product_id=null)=${prodMiss}`);

// 8. Generate SQL
const outArg = process.argv.find(a=>a.startsWith('--out='))?.slice(6);
const timestamp = new Date().toISOString().slice(0,10);
const outDir = resolve(root, 'backups');
mkdirSync(outDir, { recursive: true });
const outFile = outArg ? resolve(root, outArg) : resolve(outDir, `backfill_installed_equipment_${timestamp}.sql`);
const previewFile = resolve(outDir, `backfill_preview_${timestamp}.csv`);
const logFile = resolve(outDir, `backfill_log_${timestamp}.json`);

let sql = `\
-- Backfill installed_equipment from tickets (open + closed + valid)
-- Generated: ${new Date().toISOString()}
-- Source: ${SUPABASE_URL}
-- Filters: is_deleted=false AND status IN ('Closed','New','In Progress','Under Observation','Parts Received')
--         AND customer_id IS NOT NULL AND product<>'' AND valid serial (not NA/null/-/none, len>=3)
-- Dedup: (customer_id, upper(serial_no)) keep earliest ticket; skip if already exists
-- Stats: tickets=${tickets.length}, installed_existing=${installed.length}, candidates=${candidates.length}, distinct=${seen.size}, already_exists=${skippedExisting.length}, to_insert=${toInsert.length}
-- Safety: Idempotent - each INSERT has WHERE NOT EXISTS guard. Re-running inserts 0 rows.
--         Run as single transaction. No DELETE/UPDATE on existing rows.
-- How to run: Supabase Dashboard -> SQL Editor -> paste & Run (or psql < file)

BEGIN;

-- Optional: ensure RLS allows service_role inserts (already granted). Verify:
-- SELECT * FROM pg_policies WHERE tablename='installed_equipment';

`;

if(toInsert.length){
  sql += `\n-- ${toInsert.length} new equipment rows (deduped, skipping ${skippedExisting.length} already present)\n`;
  // Generate individual idempotent INSERT ... SELECT ... WHERE NOT EXISTS for each row
  // Safer than bulk VALUES ON CONFLICT because no unique constraint exists yet.
  for(const t of toInsert){
    const custId = t.customer_id;
    const serialUpper = String(t.serial_no).trim().toUpperCase();
    const modelEsc = sqlEscape(t._modelNo);
    const serialEsc = sqlEscape(serialUpper);
    const prodIdVal = t._productId ? `'${t._productId}'::uuid` : 'NULL';
    const caseIdEsc = sqlEscape(t.case_id || t.id);
    // Use SELECT + WHERE NOT EXISTS to make idempotent even if file run twice
    sql += `INSERT INTO public.installed_equipment (customer_id, product_id, model_no, serial_no, warranty_months, remarks)\n`;
    sql += `SELECT '${custId}'::uuid, ${prodIdVal}, '${modelEsc}', '${serialEsc}', 0, 'Backfilled from ticket ${caseIdEsc} (' || '${sqlEscape(t.status)}' || ')'\n`;
    sql += `WHERE NOT EXISTS (SELECT 1 FROM public.installed_equipment WHERE customer_id='${custId}'::uuid AND upper(trim(serial_no)) = '${serialEsc}');\n`;
  }
  sql += `\n`;
  // Optional: link tickets.equipment_id back to the newly created equipment (idempotent, only where null)
  // This does an UPDATE on tickets - safe but we keep it commented; user can uncomment if they want traceability.
  sql += `-- Optional: back-link tickets.equipment_id to the newly created installed_equipment (only where ticket.equipment_id IS NULL)
-- Uncomment to enable traceability:
-- UPDATE public.tickets t SET equipment_id = ie.id
-- FROM public.installed_equipment ie
-- WHERE t.equipment_id IS NULL
--   AND t.is_deleted = false
--   AND t.status IN ('Closed','New','In Progress','Under Observation','Parts Received')
--   AND t.customer_id IS NOT NULL
--   AND ie.customer_id = t.customer_id
--   AND upper(trim(ie.serial_no)) = upper(trim(t.serial_no))
--   AND upper(trim(t.serial_no)) NOT IN ('NA','-','NULL','NIL','#N/A','N/A','NONE','FALSE')
--   AND length(trim(t.serial_no))>=3;
`;

} else {
  sql += `-- No new rows to insert (all candidates already exist)\n`;
}

sql += `\nCOMMIT;\n\n`;
sql += `-- Verification queries (run after COMMIT):
-- 1. Count total equipment
-- SELECT count(*) FROM public.installed_equipment;
-- 2. Count backfilled rows
-- SELECT count(*) FROM public.installed_equipment WHERE remarks LIKE 'Backfilled from ticket%';
-- 3. Show backfilled rows with customer name
-- SELECT ie.id, c.company, ie.model_no, ie.serial_no, ie.warranty_months, ie.remarks, ie.created_at
-- FROM public.installed_equipment ie JOIN public.customers c ON c.id=ie.customer_id
-- WHERE ie.remarks LIKE 'Backfilled from ticket%' ORDER BY ie.created_at DESC;
-- 4. Confirm no duplicates by (customer, serial)
-- SELECT customer_id, upper(trim(serial_no)), count(*) FROM public.installed_equipment WHERE serial_no IS NOT NULL GROUP BY 1,2 HAVING count(*)>1;
`;

writeFileSync(outFile, sql, 'utf8');
console.log(`\n✓ SQL written: ${outFile} (${(sql.length/1024).toFixed(1)} KB, ${toInsert.length} inserts)`);

// Preview CSV
const csvHeader = 'case_id,status,customer_id,customer_name,product_model,serial_no,product_id_found,created_at';
const csvRows = toInsert.map(t=>{
  const cname = (custMap.get(t.customer_id)||'').replace(/"/g,'""');
  return [
    t.case_id,
    t.status,
    t.customer_id,
    `"${cname}"`,
    `"${String(t._modelNo).replace(/"/g,'""')}"`,
    String(t.serial_no).trim().toUpperCase(),
    t._productId || '',
    t.created_at
  ].join(',');
});
const csv = [csvHeader, ...csvRows].join('\n');
writeFileSync(previewFile, csv, 'utf8');
console.log(`✓ Preview CSV: ${previewFile} (${toInsert.length} rows)`);

// Log JSON for audit
const log = {
  generated_at: new Date().toISOString(),
  supabase_url: SUPABASE_URL,
  filters: {
    statuses: Array.from(VALID_STATUSES),
    exclude_is_deleted: true,
    require_customer_id: true,
    require_product: true,
    valid_serial: "not in (NA,-,NULL,NIL,#N/A,N/A,NONE,FALSE) and length>=3",
    dedupe: "customer_id|upper(serial_no) keep earliest",
    skip_existing: true
  },
  counts: {
    tickets_total: tickets.length,
    installed_existing: installed.length,
    candidates: candidates.length,
    byStatus,
    distinctKeys: seen.size,
    alreadyExists: skippedExisting.length,
    toInsert: toInsert.length,
    prodExactHit,
    prodLowerHit,
    prodMiss
  },
  toInsert_sample: toInsert.slice(0,5).map(t=>({case_id:t.case_id,status:t.status,customer:t.customer_id,product:t._modelNo,serial:String(t.serial_no).trim().toUpperCase(),product_id:t._productId})),
  skipped_sample: skippedExisting.slice(0,3).map(t=>({case_id:t.case_id,serial:String(t.serial_no).trim().toUpperCase()})),
  output_sql: outFile,
  output_csv: previewFile
};
writeFileSync(logFile, JSON.stringify(log, null, 2), 'utf8');
console.log(`✓ Log JSON: ${logFile}`);

console.log(`\nNext: Open ${outFile} and review, then paste into Supabase SQL Editor and Run. Re-running is safe (0 new inserts second time).`);
