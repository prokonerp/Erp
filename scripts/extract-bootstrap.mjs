#!/usr/bin/env node
/**
 * extract-bootstrap.mjs — regenerate
 * supabase/migrations/20260821000000_bootstrap_base_schema.sql from
 * supabase/setup_new_supabase.sql.
 *
 * The versioned chain (20260822… →) was written as deltas on top of
 * setup_new_supabase.sql, which was never versioned, so a fresh
 * `supabase db reset` aborted at the first migration. This emits the base
 * objects the chain assumes, verbatim from setup (modulo idempotency
 * forcing), in dependency order.
 *
 * Dependency closure: starting from the objects the chain references
 * (NEED_*), we repeatedly add (a) tables/types referenced by kept DDL, and
 * (b) functions called by kept function bodies, until fixpoint — so a fresh
 * apply never hits a missing FK target or helper function.
 *
 * Idempotency forcing (safe no-ops where the object exists → live is safe):
 *   CREATE TABLE → IF NOT EXISTS            CREATE TYPE → guarded DO block
 *   ADD COLUMN   → IF NOT EXISTS            ADD CONSTRAINT → guarded DO block
 *   DROP CONSTRAINT → IF EXISTS             CREATE [UNIQUE] INDEX → IF NOT EXISTS
 *   CREATE FUNCTION → CREATE OR REPLACE     CREATE TRIGGER/POLICY → DROP IF EXISTS first
 *   CREATE SEQUENCE → IF NOT EXISTS         ENABLE RLS / REPLICA IDENTITY → verbatim
 *
 * Emit order: extensions → types → sequences → tables (+ALTERs/indexes) →
 * functions → RLS enable → policies → triggers → grants → seeds.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SETUP = join(ROOT, "supabase", "setup_new_supabase.sql");
const OUT = join(ROOT, "supabase", "migrations", "20260821000000_bootstrap_base_schema.sql");

// ---- objects the versioned chain references (derived from the coverage
// checker's FAIL list; the closure below pulls in their dependencies).
const SEED_TABLES = "app_modules app_roles app_users branches companies customers defective_tags delivery_challans document_deletion_audit employees eway_bills gatepasses general_delivery_challans grns ims_stock_items ims_transactions ims_transfer_sequence ims_transfers ims_txn_sequence indents installed_equipment invoice_items invoice_settings invoices lead_activities leads password_history po_settings products purchase_order_items purchase_orders quotations role_module_permissions sales_order_settings sales_orders serials ticket_activities ticket_settings tickets user_roles vendors warehouses ims_audit_log indent_oracle_map defective_tag_sequence ticket_sequence indent_sequence".split(" ");
const SEED_FUNCTIONS = "touch_updated_at has_role has_permission claim_admin is_designated_owner record_user_login record_user_logout next_ims_txn_seq next_ims_transfer_seq ims_add_qty ims_deduct_qty check_password_reuse record_password_history validate_indent_oem_ticket update_updated_at_column trg_indent_recalc_from_doc sync_indent_oracle_map sync_assignable_employee set_ticket_case_id set_so_no set_quote_no set_po_no set_invoice_no set_indent_no set_ims_txn_no set_ims_transfer_no set_grn_no set_gdc_no set_defective_tag_no set_dc_challan_no set_challan_no products_normalize_names log_ticket_created invoice_item_sync_serials invoice_cancel_release_serials indents_autoclose_oracles indent_default_status ims_write_audit ims_transfer_status_effects ims_set_warehouse_type grn_post_inventory gdc_post_inventory gdc_guard_status dc_touch_updated_at dc_post_inventory next_ticket_seq next_indent_seq recalc_indent_status oracles_autoclose _oracle_block_complete oracle_docs_pending oracle_docs_satisfied _oracle_row_str".split(" ");
const SEED_TYPES = "app_role ims_stock_type ims_stock_status ims_txn_type".split(" ");
const SEED_SEED_TABLES = ["app_roles", "role_module_permissions", "app_modules"];

// Schema completions — columns the versioned chain (or the app) requires but
// that appear in neither the setup dump nor any migration (they were added to
// live out-of-band). Kept minimal, typed conservatively, and emitted with
// IF NOT EXISTS so they are no-ops on live. Each entry names its consumer.
const SCHEMA_COMPLETIONS = [
  // 20260824000000_perf_masters_picker.sql indexes customers(city).
  "ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS city text;",
  // 20260918000003_transfer_cancel_reversal.sql compares ims_transfer_status
  // against 'cancelled' four days before 20260922000003 adds the value, so a
  // from-scratch apply aborted with "invalid input value for enum". Add it up
  // front; the later guarded ALTER TYPE ADD VALUE becomes a no-op.
  "ALTER TYPE public.ims_transfer_status ADD VALUE IF NOT EXISTS 'cancelled';",
];

const INCHAIN_TABLES = new Set("customer_branches engineer_admin_audit engineer_consent_events engineer_conveyance_expenses engineer_conveyance_rates engineer_conveyance_settlements engineer_daily_logs engineer_daily_movements engineer_duty_sessions engineer_gate_overrides engineer_live_status engineer_location_pings engineer_location_settings engineer_place_visits field_service_reports notifications proforma_invoice_settings proforma_invoices public_rate_limit_hits so_conversions so_fulfillments ticket_assignment_history ticket_customer_verifications ticket_equipment_verifications ticket_visits".split(" "));

const norm = (s) => s.replace(/^public\./i, "").replace(/"/g, "").toLowerCase();
const fnBase = (s) => norm(s).replace(/\(.*/, "");
/** Normalized signature `${'$'}{name}(${'$'}{args})` for overload liveness checks. */
const fnSig = (name, args) =>
  `${'$'}{fnBase(name)}(${'$'}{String(args || "").replace(/\s+/g, "").replace(/public\./gi, "").replace(/"/g, "").toLowerCase()})`;

/** Drop leading comment/blank lines (keeps comments inside bodies intact). */
function stripLeadingComments(chunk) {
  let s = chunk;
  for (;;) {
    const t = s.replace(/^[ \t]*\n/, "");
    if (/^\s*--[^\n]*\n?/.test(t)) { s = t.replace(/^\s*--[^\n]*\n?/, ""); continue; }
    if (/^\s*\/\*[\s\S]*?\*\/\s*/.test(t)) { s = t.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""); continue; }
    return t.trimStart();
  }
}
const isExternal = (t) => /^(auth|storage|extensions|net|vault|realtime|cron|supabase_functions)\./.test(t);

/** Split top-level statements; aware of quotes, dollar bodies, comments. */
function splitStatements(sql) {
  const stmts = [];
  let cur = "";
  let i = 0;
  const n = sql.length;
  let tag = null;
  while (i < n) {
    if (tag) {
      if (sql.startsWith(tag, i)) { cur += tag; i += tag.length; tag = null; }
      else cur += sql[i++];
      continue;
    }
    const dm = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
    if (dm) { tag = dm[0]; cur += tag; i += tag.length; continue; }
    const ch = sql[i];
    if (ch === "'") {
      let j = i + 1;
      while (j < n) { if (sql[j] === "'") { if (sql[j + 1] === "'") j += 2; else break; } else j++; }
      cur += sql.slice(i, Math.min(j + 1, n));
      i = Math.min(j + 1, n);
      continue;
    }
    if (ch === '"') { const j = sql.indexOf('"', i + 1); cur += j === -1 ? sql.slice(i) : sql.slice(i, j + 1); i = j === -1 ? n : j + 1; continue; }
    if (sql.startsWith("--", i)) { const j = sql.indexOf("\n", i); cur += j === -1 ? sql.slice(i) : sql.slice(i, j); i = j === -1 ? n : j; continue; }
    if (sql.startsWith("/*", i)) { const j = sql.indexOf("*/", i + 2); cur += j === -1 ? sql.slice(i) : sql.slice(i, j + 2); i = j === -1 ? n : j + 2; continue; }
    if (ch === ";") { stmts.push(cur + ";"); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) stmts.push(cur);
  return stmts;
}

/** Leading-comment-stripped head of a statement. */
function headOf(st) {
  let s = st.trimStart();
  for (;;) {
    if (s.startsWith("--")) { const j = s.indexOf("\n"); if (j === -1) return ""; s = s.slice(j + 1).trimStart(); continue; }
    if (s.startsWith("/*")) { const j = s.indexOf("*/"); if (j === -1) return ""; s = s.slice(j + 2).trimStart(); continue; }
    return s;
  }
}

const raw = readFileSync(SETUP, "utf8");

// Policies/triggers the versioned chain (everything except the bootstrap
// itself) later DROPs or recreates. The bootstrap must NOT create the
// setup-era version of those: some reference columns that only exist once a
// chain migration adds them (e.g. leads.assigned_to), so creating them here
// fails a fresh apply — and the chain's own CREATE would overwrite them
// anyway.
const touchedPolicies = new Set();
const touchedTriggers = new Set();
{
  const dir = join(ROOT, "supabase", "migrations");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".sql") || f.startsWith("20260821000000")) continue;
    const t = readFileSync(join(dir, f), "utf8");
    for (const m of t.matchAll(/(?:CREATE|DROP)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+public\.([\w"]+)/gi))
      touchedPolicies.add(`${norm(m[2])}|${m[1].toLowerCase()}`);
    for (const m of t.matchAll(/(?:CREATE|DROP)\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([\w"]+)[\s\S]*?\sON\s+public\.([\w"]+)/gi))
      touchedTriggers.add(`${norm(m[2])}|${m[1].replace(/"/g, "").toLowerCase()}`);
  }
}
const statements = splitStatements(raw).map((s) => ({ sql: s, head: headOf(s).replace(/\s+/g, " ").trim() }));

// ---- indexes into the setup file
const setupTables = new Map();   // name -> CREATE TABLE stmt
const setupTypes = new Map();    // name -> CREATE TYPE stmt (standalone or DO-wrapped)
const setupFns = new Map();      // base name -> [stmts]
const alterStmts = [];           // {table, sql}
const indexStmts = [];           // {table, sql}
const triggerStmts = [];         // {table, name, sql, drop}
const policyStmts = [];          // {table, sql}
const grantStmts = [];           // {objects:Set, sql}
const rlsStmts = [];
const seqStmts = new Map();      // name -> stmt
const seedStmts = [];            // {table, sql}

for (const { sql, head } of statements) {
  let m;
  if ((m = head.match(/^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i)))
    { setupTables.set(norm(m[1]), sql); continue; }
  if ((m = head.match(/^CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i)))
    { setupTypes.set(norm(m[1]), sql); continue; }
  if ((m = head.match(/^DO\s+\$([A-Za-z_]*)\$/i))) {
    const tm = sql.match(/CREATE\s+TYPE\s+([\w."]+)\s+AS\s+ENUM/i);
    if (tm) { setupTypes.set(norm(tm[1]), sql); continue; }
  }
  if ((m = head.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)/i)))
    { const b = fnBase(m[1]); (setupFns.get(b) ?? setupFns.set(b, []).get(b)).push(sql); continue; }
  if ((m = head.match(/^CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i)))
    { seqStmts.set(norm(m[1]), sql); continue; }
  if ((m = head.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.([\w"]+)/i)))
    { alterStmts.push({ table: norm(m[1]), sql }); continue; }
  if ((m = head.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)\s+ON\s+public\.([\w"]+)/i)))
    { indexStmts.push({ table: norm(m[2]), sql }); continue; }
  if ((m = head.match(/^CREATE\s+TRIGGER\s+([\w"]+)[\s\S]*?\sON\s+public\.([\w"]+)/i)))
    { triggerStmts.push({ table: norm(m[2]), name: m[1].replace(/"/g, ""), sql }); continue; }
  if ((m = head.match(/^CREATE\s+POLICY\s+("?[\w" ]+?"?)\s+ON\s+public\.([\w"]+)/i)))
    { policyStmts.push({ table: norm(m[2]), name: m[1], sql }); continue; }
  if ((m = head.match(/^(?:GRANT|REVOKE)\s+/i))) {
    const objs = new Set();
    for (const g of sql.matchAll(/\b(?:ON|FROM)\s+(?:TABLE\s+|FUNCTION\s+)?(?:ALL\s+(?:TABLES|FUNCTIONS)\s+IN\s+SCHEMA\s+)?(public\.[\w"]+)/gi)) objs.add(norm(g[1]));
    grantStmts.push({ objs, sql });
    continue;
  }
  if ((m = head.match(/^ALTER\s+TABLE\s+public\.[\w"]+\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i)))
    { const t = head.match(/public\.([\w"]+)/i); rlsStmts.push({ table: norm(t[1]), sql }); continue; }
  if ((m = head.match(/^INSERT\s+INTO\s+public\.([\w"]+)/i)))
    { seedStmts.push({ table: norm(m[1]), sql }); continue; }
}

// ---- unified dependency closure (tables ↔ functions ↔ types), fixpoint.
// Root set = EVERY table in the setup dump that the chain does not itself
// create. Starting from only chain-referenced tables left 32 live tables
// (accounts_ledger, attendance, payments_received, …) out of the bootstrap,
// so a rebuild would silently miss them — a fresh DB must match live.
const neededTables = new Set(
  [...setupTables.keys()].filter((t) => !INCHAIN_TABLES.has(t)),
);
const neededFns = new Set(SEED_FUNCTIONS.map((f) => fnBase(f)));
const neededTypes = new Set(SEED_TYPES.map(norm));
{
  let grew = true;
  while (grew) {
    grew = false;
    const sources = [];
    for (const t of neededTables) if (setupTables.has(t)) sources.push(setupTables.get(t));
    for (const a of alterStmts) if (neededTables.has(a.table)) sources.push(a.sql);
    for (const i of indexStmts) if (neededTables.has(i.table)) sources.push(i.sql);
    for (const tr of triggerStmts) if (neededTables.has(tr.table)) sources.push(tr.sql);
    for (const p of policyStmts) if (neededTables.has(p.table)) sources.push(p.sql);
    for (const f of neededFns) for (const s of setupFns.get(f) ?? []) sources.push(s);

    for (const s of sources) {
      // tables: FK targets + DML targets inside kept function bodies
      for (const r of s.matchAll(/REFERENCES\s+public\.([\w"]+)/gi)) {
        const t = norm(r[1]);
        if (!neededTables.has(t) && !INCHAIN_TABLES.has(t) && setupTables.has(t)) { neededTables.add(t); grew = true; }
      }
      for (const r of s.matchAll(/\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM|FROM|JOIN)\s+public\.([\w"]+)/gi)) {
        const t = norm(r[1]);
        if (!neededTables.has(t) && !INCHAIN_TABLES.has(t) && setupTables.has(t)) { neededTables.add(t); grew = true; }
      }
      // functions via public.fn( — a trigger's EXECUTE FUNCTION counts too
      for (const c of s.matchAll(/\bpublic\.([\w"]+)\s*\(/g)) {
        const b = fnBase(norm(c[1]));
        if (setupFns.has(b) && !neededFns.has(b)) { neededFns.add(b); grew = true; }
      }
      // types: any `public.X` token that is a known enum (covers casts
      // `::public.X` and column types `col public.X` alike)
      for (const c of s.matchAll(/\bpublic\.([\w"]+)/g)) {
        const t = norm(c[1]);
        if (setupTypes.has(t) && !neededTypes.has(t)) { neededTypes.add(t); grew = true; }
      }
    }
  }
}

// ---- emit helpers -------------------------------------------------------
const forceCreate = (sql, reKw, litCreate) =>
  sql.replace(
    new RegExp(`^((?:\\s|--[^\\n]*\\n|\\/\\*[\\s\\S]*?\\*\\/)*)CREATE\\s+${reKw}\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?`, "i"),
    `$1CREATE ${litCreate} `,
  );
const guardAddConstraint = (sql) =>
  `DO $$ BEGIN\n${sql.trim().replace(/;$/, "")};\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;`;
const forceDropIfExists = (sql) =>
  sql.replace(/\bDROP\s+CONSTRAINT\s+(?!IF\s+EXISTS)/i, "DROP CONSTRAINT IF EXISTS ");
const forceAddColumnIfNotExists = (sql) =>
  sql.replace(/ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/gi, "ADD COLUMN IF NOT EXISTS ");

function emitTable(t) {
  const out = [];
  out.push(forceCreate(setupTables.get(t), "(?:TEMP\\s+|TEMPORARY\\s+)?TABLE", "TABLE IF NOT EXISTS"));
  for (const a of alterStmts) {
    if (a.table !== t) continue;
    const sp = a.sql.replace(/\s+/g, " ").trim();
    if (/ENABLE ROW LEVEL SECURITY/i.test(sp)) continue; // separate section
    if (/\bADD\s+CONSTRAINT\b/i.test(sp)) { out.push(guardAddConstraint(forceAddColumnIfNotExists(a.sql))); continue; }
    out.push(forceDropIfExists(forceAddColumnIfNotExists(a.sql)));
  }
  for (const i of indexStmts) {
    if (i.table !== t) continue;
    out.push(forceCreate(i.sql, "(?:UNIQUE\\s+)?INDEX", "INDEX IF NOT EXISTS"));
  }
  return out;
}

// ---- sequence references (kept table defaults + function bodies) ----------
const seqRefs = new Set();
{
  const src = [];
  for (const t of neededTables) if (setupTables.has(t)) src.push(setupTables.get(t));
  for (const f of neededFns) for (const s of setupFns.get(f) ?? []) src.push(s);
  for (const s of src) for (const r of s.matchAll(/nextval\('public\.([\w"]+)'/gi)) seqRefs.add(norm(r[1]));
}

// Final existence of functions/tables/views after replaying setup top-to-bottom
// (the dump contains create→drop→recreate cycles). Grants/revokes are emitted
// LAST and only for objects that still exist at the end.
const aliveFns = new Set();
const aliveSigs = new Set();
const aliveTables = new Set();
const aliveViews = new Set();
for (const { head } of statements) {
  let m;
  if ((m = head.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)\s*\(([^)]*)\)/i))) { aliveFns.add(fnBase(m[1])); aliveSigs.add(fnSig(m[1], m[2])); }
  else if ((m = head.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)/i))) aliveFns.add(fnBase(m[1]));
  else if ((m = head.match(/^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w."]+)\s*\(([^)]*)\)/i))) { aliveFns.delete(fnBase(m[1])); aliveSigs.delete(fnSig(m[1], m[2])); }
  else if ((m = head.match(/^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w."]+)/i))) aliveFns.delete(fnBase(m[1]));
  else if ((m = head.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP\s+|TEMPORARY\s+)?VIEW\s+([\w."]+)/i))) aliveViews.add(norm(m[1]));
  else if ((m = head.match(/^DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?([\w."]+)/i))) aliveViews.delete(norm(m[1]));
  else if ((m = head.match(/^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i))) aliveTables.add(norm(m[1]));
  else if ((m = head.match(/^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w."]+)/i))) aliveTables.delete(norm(m[1]));
}

// ---- assemble in ORIGINAL setup-file order (the order actually applied to
// live), filtered to needed objects. Preserving relative order keeps FK and
// column dependencies valid without a hand-rolled topological sort.
const emittedNames = {
  tables: new Set([...neededTables].filter((t) => setupTables.has(t))),
  fns: new Set([...neededFns].filter((f) => setupFns.has(f))),
  types: new Set([...neededTypes].filter((t) => setupTypes.has(t))),
};
const emitted = [];
const deferredGrants = [];
let dropped = 0;

for (const { sql, head } of statements) {
  let m;
  // extensions
  if ((m = head.match(/^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)/i))) {
    if (/pgcrypto|pg_trgm|uuid-ossp|btree_gin|btree_gist/i.test(m[1])) emitted.push(forceCreate(sql, "EXTENSION", "EXTENSION IF NOT EXISTS"));
    continue;
  }
  // types (standalone → wrap in duplicate_object-guarded DO; DO-wrapped kept)
  if ((m = head.match(/^CREATE\s+TYPE\s+([\w."]+)/i))) {
    if (neededTypes.has(norm(m[1]))) {
      const body = stripLeadingComments(sql).replace(/;\s*$/, "");
      emitted.push(`DO $$ BEGIN\n${body};\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;`);
    }
    continue;
  }
  if (/^DO\s+\$[A-Za-z_]*\$/i.test(head)) {
    const tm = sql.match(/CREATE\s+TYPE\s+([\w."]+)\s+AS\s+ENUM/i);
    if (tm && neededTypes.has(norm(tm[1]))) emitted.push(sql);
    continue;
  }
  // sequences
  if ((m = head.match(/^CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i))) {
    if (seqRefs.has(norm(m[1]))) emitted.push(forceCreate(sql, "SEQUENCE", "SEQUENCE IF NOT EXISTS"));
    continue;
  }
  // tables
  if ((m = head.match(/^CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/i))) {
    if (neededTables.has(norm(m[1]))) emitted.push(forceCreate(sql, "(?:TEMP\\s+|TEMPORARY\\s+)?TABLE", "TABLE IF NOT EXISTS"));
    continue;
  }
  // indexes
  if ((m = head.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w"]+\s+ON\s+public\.([\w"]+)/i))) {
    if (neededTables.has(norm(m[1]))) emitted.push(forceCreate(sql, "(?:UNIQUE\\s+)?INDEX", "INDEX IF NOT EXISTS"));
    continue;
  }
  // functions — keep the dump's own DROP FUNCTION IF EXISTS guards: some
  // functions are redefined with a different return type, which a bare
  // CREATE OR REPLACE rejects ("cannot change return type of existing
  // function").
  if ((m = head.match(/^DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w."]+)\s*\(/i))) {
    if (neededFns.has(fnBase(m[1]))) emitted.push(sql);
    continue;
  }
  if ((m = head.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w."]+)/i))) {
    if (neededFns.has(fnBase(m[1]))) emitted.push(forceCreate(sql, "(?:OR\\s+REPLACE\\s+)?FUNCTION", "OR REPLACE FUNCTION"));
    continue;
  }
  // ALTER TABLE (columns, constraints, RLS, replica identity)
  if ((m = head.match(/^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?public\.([\w"]+)/i))) {
    const t = norm(m[1]);
    if (!neededTables.has(t)) continue;
    let s2 = forceAddColumnIfNotExists(forceDropIfExists(sql));
    if (/\bADD\s+CONSTRAINT\b/i.test(s2)) s2 = guardAddConstraint(s2);
    emitted.push(s2);
    continue;
  }
  // triggers
  if ((m = head.match(/^CREATE\s+TRIGGER\s+([\w"]+)[\s\S]*?\sON\s+public\.([\w"]+)/i))) {
    const t = norm(m[2]);
    const nm = m[1].replace(/"/g, "");
    if (!neededTables.has(t)) continue;
    if (touchedTriggers.has(`${t}|${nm.toLowerCase()}`)) continue; // chain owns it
    emitted.push(`DROP TRIGGER IF EXISTS ${nm} ON public.${t};`);
    emitted.push(sql);
    continue;
  }
  // policies (the setup file already DROPs before CREATE in most cases; add a
  // defensive DROP so a re-run and order surprises cannot fail)
  if ((m = head.match(/^CREATE\s+POLICY\s+("?[\w" ]+?"?)\s+ON\s+public\.([\w"]+)/i))) {
    const t = norm(m[2]);
    if (!neededTables.has(t)) continue;
    if (touchedPolicies.has(`${t}|${m[1].replace(/"/g, "").toLowerCase()}`)) continue; // chain owns it
    emitted.push(`DROP POLICY IF EXISTS ${m[1]} ON public.${t};`);
    emitted.push(sql);
    continue;
  }
  // grants / revokes — deferred to the end and guarded by a catalogue
  // existence check (an object may be created, dropped and recreated during
  // the dump; a raw REVOKE of a dropped overload errors).
  if (/^(?:GRANT|REVOKE)\b/i.test(head)) {
    const guards = [];
    for (const g of sql.matchAll(/\b(?:ON|FROM)\s+(?:TABLE\s+)?(public\.[\w"]+)/gi)) {
      guards.push(`to_regclass('${g[1].toLowerCase()}') IS NOT NULL`);
    }
    for (const g of sql.matchAll(/\bON\s+FUNCTION\s+(public\.[\w"]+)\s*\(([^)]*)\)/gi)) {
      guards.push(`to_regprocedure('${g[1].toLowerCase()}(${g[2].replace(/\s+/g, " ")})') IS NOT NULL`);
    }
    if (/\bON\s+ALL\s+(?:TABLES|FUNCTIONS)\s+IN\s+SCHEMA/i.test(sql)) {
      deferredGrants.push({ sql, guards: [] });
      continue;
    }
    if (guards.length === 0) { dropped++; continue; }
    deferredGrants.push({ sql, guards: [...new Set(guards)] });
    continue;
  }
  // seeds
  if ((m = head.match(/^INSERT\s+INTO\s+public\.([\w"]+)/i))) {
    if (SEED_SEED_TABLES.includes(norm(m[1]))) {
      if (!/ON\s+CONFLICT/i.test(sql)) console.error(`SEED WITHOUT ON CONFLICT (hand-fix): ${sql.slice(0, 90)}`);
      emitted.push(sql);
    }
    continue;
  }
}

// ---- validation: (a) never reference an in-chain-only table (it does not
// exist yet on a fresh DB), (b) FK targets must appear earlier in emission.
{
  const problems = [];
  const seenTables = new Set();
  emitted.forEach((s, idx) => {
    const tbl = s.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.([\w"]+)/i);
    const self = tbl ? norm(tbl[1]) : null;
    // in-chain-only references
    for (const r of s.matchAll(/REFERENCES\s+public\.([\w"]+)/gi)) {
      const t = norm(r[1]);
      if (t === self) continue; // self-referencing FK inside its own CREATE is fine
      if (INCHAIN_TABLES.has(t)) problems.push(`references in-chain-only table public.${t}: ${s.slice(0, 90)}`);
      else if (!neededTables.has(t)) problems.push(`references non-bootstrap table public.${t}: ${s.slice(0, 90)}`);
      else if (tbl && !seenTables.has(t)) problems.push(`FK target public.${t} not yet created at statement ${idx}: ${s.slice(0, 90)}`);
    }
    if (tbl) seenTables.add(norm(tbl[1]));
  });
  const dups = [...neededTables].filter((t) => emitted.filter((s) => new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}\\b`, "i").test(s)).length > 1);
  if (dups.length) problems.push(`duplicate CREATE TABLE: ${dups.join(", ")}`);
  if (problems.length) {
    console.error(`\nVALIDATION PROBLEMS (${problems.length}):`);
    for (const p of problems.slice(0, 30)) console.error("  " + p);
    process.exitCode = 1;
  } else {
    console.error("validation: OK (no in-chain refs, FK targets precede use, no duplicate tables)");
  }
}

// ---- render inside one guard so this is a NO-OP on any DB that already has
// the base schema (live). Without the guard, re-creating permissive base
// policies / re-granting revoked privileges would REGRESS an existing DB
// (later chain migrations would not re-run to re-harden).
const header = `-- =============================================================================
-- 20260821000000_bootstrap_base_schema.sql — versioned base-schema bootstrap.
--
-- WHY: the chain from 20260822… was written as deltas on top of
-- supabase/setup_new_supabase.sql, which was never versioned — a fresh
-- \`supabase db reset\` (or disaster-recovery rebuild) aborted at the first
-- migration. This file versions the base objects the chain assumes,
-- extracted verbatim from setup (modulo idempotency forcing) with a
-- dependency closure so no FK target or helper function is missing.
--
-- SAFE ON LIVE: the whole file is a single guard that returns immediately
-- when public.app_users exists — i.e. on any already-provisioned database
-- it changes nothing. It only executes on a fresh/cloned database.
-- Generated by scripts/extract-bootstrap.mjs; validated by
-- scripts/check-migration-coverage.mjs. Do not hand-edit — change the
-- extractor and regenerate.
-- =============================================================================`;

{
  const lines = [header.trimEnd(), ""];
  lines.push(`-- Guarded: a no-op when the base schema already exists (existing databases).`);
  lines.push(`DO $bootstrap$`);
  lines.push(`DECLARE`);
  lines.push(`  _base_present boolean := to_regclass('public.app_users') IS NOT NULL;`);
  lines.push(`BEGIN`);
  lines.push(`  IF _base_present THEN`);
  lines.push(`    RAISE NOTICE 'Base schema already present - bootstrap skipped (no-op on existing databases).';`);
  lines.push(`    RETURN;`);
  lines.push(`  END IF;`);
  lines.push("");
  for (const s of emitted) lines.push(`  EXECUTE $stmt$ ${s.replace(/\s+$/, "")} $stmt$;`);
  if (SCHEMA_COMPLETIONS.length) {
    lines.push(`  -- Schema completions (columns required by later migrations/app, absent from the dump).`);
    for (const c of SCHEMA_COMPLETIONS) lines.push(`  EXECUTE $stmt$ ${c} $stmt$;`);
  }
  for (const g of deferredGrants) {
    const stmt = `  EXECUTE $stmt$ ${g.sql.replace(/\s+$/, "")} $stmt$;`;
    if (g.guards.length === 0) { lines.push(stmt); continue; }
    lines.push(`  IF ${g.guards.join(" AND ")} THEN`);
    lines.push(`  ${stmt.trim()}`);
    lines.push(`  END IF;`);
  }
  lines.push("");
  lines.push(`END`);
  lines.push(`$bootstrap$;`);
  writeFileSync(OUT, lines.join("\n") + "\n");
  console.error(
    `wrote ${OUT}\n  statements=${emitted.length} (dropped ${dropped} non-object grants)\n  tables=${neededTables.size} functions=${neededFns.size} types=${neededTypes.size}`,
  );
}
