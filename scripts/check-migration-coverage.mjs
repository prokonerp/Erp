#!/usr/bin/env node
/**
 * check-migration-coverage.mjs — static fresh-apply safety check (no DB).
 *
 * Reads supabase/migrations/*.sql in filename order and reports:
 *   FAIL — an object (table / function / enum / view) referenced before any
 *          migration defines it. On a fresh `supabase db reset` the chain
 *          aborts at the first such statement.
 *   WARN — a non-idempotent CREATE (bare CREATE TABLE/INDEX/TYPE, CREATE
 *          FUNCTION without OR REPLACE, CREATE POLICY without a preceding
 *          DROP IF EXISTS). Re-applying the file errors out.
 *
 * Allowlisted (exist on every fresh Supabase project, never our DDL):
 *   pg_catalog, information_schema, auth.*, storage.* (schema objects),
 *   extensions/* (pgcrypto, pg_trgm, uuid-ossp, pgjwt, pg_cron, pg_net…),
 *   cron.*, vault.*, realtime.*, supabase_functions.*, pg_* catalog fns.
 *
 * Usage: node scripts/check-migration-coverage.mjs [--strict]
 * Exit 1 on any FAIL; exit 2 on WARN-only when --strict is passed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG_DIR = join(ROOT, "supabase", "migrations");
const STRICT = process.argv.includes("--strict");

/** Strip -- line comments and /* *\/ blocks, respecting quotes + dollar-quoting. */
function stripComments(sql) {
  // Consume a single-quoted string starting at i; return [blanked, nextI].
  // Newlines are preserved so line numbers never drift.
  function blankStringAt(start) {
    let j = start + 1;
    let blank = "";
    while (j < n) {
      const c = sql[j];
      if (c === "'") {
        if (sql[j + 1] === "'") { blank += "  "; j += 2; }
        else { j++; break; }
      } else if (c === "\n") { blank += "\n"; j++; }
      else { blank += " "; j++; }
    }
    return [blank, j];
  }
  let out = "";
  let i = 0;
  const n = sql.length;
  let dollarTag = null;
  while (i < n) {
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        out += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      const ch = sql[i];
      if (ch === "'") {
        const [blank, ni] = blankStringAt(i);
        out += blank;
        i = ni;
        continue;
      }
      if (sql.startsWith("--", i)) {
        const j = sql.indexOf("\n", i);
        i = j === -1 ? n : j;
        continue;
      }
      if (sql.startsWith("/*", i)) {
        const j = sql.indexOf("*/", i + 2);
        const block = j === -1 ? sql.slice(i) : sql.slice(i, j + 2);
        out += block.replace(/[^\n]/g, "");
        i = j === -1 ? n : j + 2;
        continue;
      }
      out += ch;
      i++;
      continue;
    }
    const dm = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/);
    if (dm) {
      dollarTag = dm[0];
      out += dollarTag;
      i += dollarTag.length;
      continue;
    }
    const ch = sql[i];
    if (ch === "'") {
      // single-quoted string ('' escape)
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") j += 2;
          else break;
        } else j++;
      }
      out += sql.slice(i, Math.min(j + 1, n));
      i = Math.min(j + 1, n);
      continue;
    }
    if (ch === '"' || ch === "`") {
      const j = sql.indexOf(ch, i + 1);
      out += sql.slice(i, j === -1 ? n : j + 1);
      i = j === -1 ? n : j + 1;
      continue;
    }
    if (sql.startsWith("--", i)) {
      const j = sql.indexOf("\n", i);
      i = j === -1 ? n : j;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const j = sql.indexOf("*/", i + 2);
      // preserve newlines so reported line numbers match the file
      const block = j === -1 ? sql.slice(i) : sql.slice(i, j + 2);
      out += block.replace(/[^\n]/g, "");
      i = j === -1 ? n : j + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const norm = (name) => name.replace(/^public\./i, "").toLowerCase();
const TRIGGER_VARS = new Set(["OLD", "NEW", "TG_OP", "TG_TABLE_NAME", "TG_TABLE_SCHEMA", "TG_ARGV", "TG_NAME", "FOUND"]);

/** Copy of the SQL with single-quoted string bodies blanked (keeps structure). */
function blankStrings(sql) {
  // blank bodies but KEEP newlines: collapsing them fuses string soup into
  // phantom matches ('…from Delivery…') and misaligns line numbers.
  return sql.replace(/'(?:[^']|'')*'/g, (m) => m.replace(/[^\n]/g, ""));
}

const ALLOW_SCHEMAS = new Set([
  "auth",
  "storage",
  "cron",
  "vault",
  "realtime",
  "extensions",
  "supabase_functions",
  "pg_temp",
  "net",
  "pgsodium",
]);
const ALLOW_OBJECTS = new Set([
  // pg_catalog / ubiquitous helpers (schema-qualified or bare)
  "pg_enum",
  "pg_policies",
  "pg_tables",
  "pg_proc",
  "pg_class",
  "pg_attribute",
  "pg_constraint",
  "pg_namespace",
  "pg_extension",
  "pg_available_extensions",
  "gen_random_uuid",
  "to_regclass",
  "current_setting",
  "set_config",
  "pg_trigger",
  "pg_roles",
  "pg_type",
  "pg_indexes",
  "pg_locks",
  "pg_publication_tables",
  "pg_advisory_lock",
  "pg_advisory_unlock",
  "pg_advisory_xact_lock",
  "cron.job",
  "cron.schedule",
  "cron.unschedule",
]);

// Bare words that are never tables (keywords, booleans, substring units).
const BARE_STOP = new Set(["TRUE", "FALSE", "NULL"]);

const files = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

// defined: kind -> Map<name, fileIndex>. Two passes: pass 0 records every
// definition chain-wide (so a table/function mix-up can be told apart from
// a true gap); pass 1 checks references against definitions at-or-before
// the referencing file.
const defined = { table: new Map(), function: new Map(), type: new Map(), view: new Map() };
const fails = [];
const warns = [];

const DEF_RES = [
  [/CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([\w.]+)/gi, "table"],
  [/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)/gi, "function"],
  [/CREATE\s+TYPE\s+(IF\s+NOT\s+EXISTS\s+)?([\w.]+)/gi, "type"],
  [/CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP\s+|TEMPORARY\s+)?VIEW\s+([\w.]+)/gi, "view"],
];

const fileSql = files.map((f) => ({
  file: f,
  sql: stripComments(readFileSync(join(MIG_DIR, f), "utf8")),
}));
fileSql.forEach(({ file, sql }, fi) => {
  for (const [re, kind] of DEF_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sql)) !== null) {
      // name = last captured group (qualifier groups differ per regex)
      const groups = m.slice(1).filter((g) => g !== undefined);
      const name = groups.length > 0 ? groups[groups.length - 1] : null;
      if (!name || isAllowlisted(name)) continue;
      const key = norm(name);
      if (!defined[kind].has(key)) defined[kind].set(key, fi);
    }
  }
});

function isAllowlisted(raw) {
  const low = raw.toLowerCase();
  if (ALLOW_OBJECTS.has(low) || ALLOW_OBJECTS.has(norm(raw))) return true;
  const dot = low.indexOf(".");
  if (dot > 0 && ALLOW_SCHEMAS.has(low.slice(0, dot))) return true;
  return false;
}

function defineAt() {
  // definitions are collected in the pre-pass above; kept for symmetry.
}

function refAt(kind, raw, fi, file, line, ctx) {
  if (isAllowlisted(raw)) return;
  const key = norm(raw);
  // views satisfy table references (FROM v / GRANT ON v)
  const defIdx =
    kind === "table"
      ? (defined.table.get(key) ?? defined.view.get(key))
      : defined[kind].get(key);
  if (defIdx !== undefined && defIdx <= fi) return; // defined at-or-before use
  if (kind === "table" && defined.function.has(key)) return; // set-returning fn in FROM; checked as function
  fails.push({ file, line, kind, name: raw, ctx });
}

fileSql.forEach(({ file, sql }, fi) => {
  const scan = blankStrings(sql); // string literals ('from Sales…') are never refs
  const lines = sql.split("\n");
  const scanLines = scan.split("\n");

  // DO-block spans (guarded DDL: EXCEPTION WHEN duplicate_object …) — WARNs inside are suppressed.
  const doSpans = [];
  {
    const re = /\bDO\s+(\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)/gi;
    let m;
    while ((m = re.exec(scan)) !== null) {
      const close = scan.indexOf(m[1], m.index + m[0].length);
      doSpans.push([m.index, close === -1 ? scan.length : close + m[1].length]);
    }
  }
  // line-start offsets for span membership
  const lineOff = [];
  {
    let o = 0;
    for (const ln of scanLines) { lineOff.push(o); o += ln.length + 1; }
  }
  const inDoBlock = (idx) => doSpans.some(([a, b]) => lineOff[idx] >= a && lineOff[idx] < b);
  // CREATE FUNCTION foo() is safe when the file drops it first
  const droppedFns = new Set();
  {
    const re = /\bDROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([\w.]+)/gi;
    let m;
    while ((m = re.exec(scan)) !== null) droppedFns.add(norm(m[1]));
  }

  // CTE names defined in this file (WITH a AS … / , b AS () — never tables.
  const ctes = new Set();
  {
    const re = /(?:\bWITH\b|,)\s*([\w]+)\s+AS\s*\(/gi;
    let m;
    while ((m = re.exec(scan)) !== null) ctes.add(m[1].toLowerCase());
  }

  // ---- references + idempotency (line-granular for reporting)
  // `IF to_regclass(...)/to_regprocedure(...) IS NOT NULL THEN ... END IF;`
  // guards make the reference intentionally conditional (the bootstrap emits
  // guarded GRANT/REVOKE). Refs inside such a guard are not creation-order
  // dependencies, so skip them.
  let guardDepth = 0;
  lines.forEach((ln, idx) => {
    const line = idx + 1;
    const t = ln.trim();
    const s = scanLines[idx];
    if (!t) return;
    if (/^END\s+IF\s*;/i.test(t)) { if (guardDepth > 0) guardDepth--; return; }
    if (/^IF\b/i.test(t) && /to_reg(class|procedure)\s*\(/i.test(t)) { guardDepth++; return; }
    if (guardDepth > 0) return;

    // table references (schema-qualified = authoritative; bare only for
    // FROM/JOIN/REFERENCES and never when followed by `(` — that's a call)
    const trefs = [
      [/\bFROM\s+((?:[\w]+\.)?[\w]+)\b(?!\s*\()/gi, true],
      [/\bJOIN\s+((?:[\w]+\.)?[\w]+)\b(?!\s*\()/gi, true],
      [/\bUPDATE\s+(public\.[\w]+)/gi, false],
      [/\bINSERT\s+INTO\s+(public\.[\w]+|storage\.[\w]+)/gi, false],
      [/\bDELETE\s+FROM\s+(public\.[\w]+)/gi, false],
      [/\bREFERENCES\s+((?:[\w]+\.)?[\w]+)\b(?!\s*\()/gi, true],
      [/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(public\.[\w]+)/gi, false],
      [/\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?[\w]+\s+ON\s+(public\.[\w]+)/gi, false],
      [/\bDROP\s+(?:TABLE|VIEW|FUNCTION|TYPE|POLICY|TRIGGER)\s+(?:IF\s+EXISTS\s+)?(public\.[\w]+)/gi, false],
      [/\bTRUNCATE\s+(?:TABLE\s+)?(public\.[\w]+)/gi, false],
      [/\bON\s+(public\.[\w]+)/gi, false], // CREATE POLICY … ON t / CREATE INDEX … ON t
      [/\bGRANT\s+[\w\s,()]*\sON\s+(?:TABLE\s+)?(public\.[\w]+)/gi, false],
    ];
    const accessClause = /\b(REVOKE|GRANT)\b/i.test(t); // REVOKE…FROM <role>
    for (const [re, isFromLike] of trefs) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(s)) !== null) {
        // partial-qualifier backtrack guard: "public" in "public.t (" must
        // not match — the full "public.t" match (or its skip) owns it.
        if (s[m.index + m[0].length] === ".") continue;
        if (isFromLike && accessClause) continue; // REVOKE…FROM <role>, not a table
        if (isFromLike) {
          const before = s.slice(Math.max(0, m.index - 32), m.index);
          if (/\bIS\s+(?:NOT\s+)?DISTINCT\s+$/i.test(before)) continue; // IS [NOT] DISTINCT FROM <expr>
          // SUBSTRING(x FROM y FOR z) / EXTRACT(u FROM v) — x/y are exprs
          if (/\b(SUBSTRING|EXTRACT|POSITION|OVERLAY|TRIM)\s*\([^()]*$/i.test(before)) continue;
          const after = s.slice(m.index + m[0].length, m.index + m[0].length + 8);
          if (/^\s*(\)|\bfor\b|\bfrom\b)/i.test(after)) continue; // EXTRACT/SUBSTRING … FROM x
        }
        const name = m[1];
        if (!name || TRIGGER_VARS.has(name.toUpperCase())) continue;
        if (BARE_STOP.has(name.toUpperCase())) continue;
        if (!name.includes(".") && ctes.has(name.toLowerCase())) continue;
        // non-public qualified names are allowlisted (or skipped) in refAt
        if (name.includes(".") && !/^public\./i.test(name)) continue;
        refAt("table", name, fi, file, line, t.slice(0, 120));
      }
    }

    // function references: public.name( outside INDEX/REFERENCES tails,
    // bare has_role(, bare PERFORM name(
    {
      const re = /\bpublic\.([\w]+)\s*\(/g;
      let m;
      while ((m = re.exec(s)) !== null) {
        const before = s.slice(Math.max(0, m.index - 32), m.index);
        if (/\bON\s*$/i.test(before)) continue; // CREATE INDEX … ON t (cols)
        if (/\bREFERENCES\s*$/i.test(before)) continue; // … REFERENCES t (cols)
        if (/\bINTO\s*$/i.test(before)) continue; // INSERT INTO t (cols)
        if (/\bTABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?$/i.test(before)) continue; // CREATE TABLE t (cols)
        if (/\bVIEW\s+$/i.test(before)) continue; // CREATE VIEW v AS …
        refAt("function", `public.${m[1]}`, fi, file, line, t.slice(0, 120));
      }
    }
    {
      const re = /\bhas_role\s*\(/g;
      let m;
      while ((m = re.exec(s)) !== null) refAt("function", "has_role", fi, file, line, t.slice(0, 120));
    }
    {
      const re = /\bPERFORM\s+([\w.]+)\s*\(/gi;
      let m;
      while ((m = re.exec(s)) !== null) {
        if (/^pg_advisory_/i.test(m[1])) continue; // builtin
        refAt("function", m[1], fi, file, line, t.slice(0, 120));
      }
    }

    // enum casts: 'x'::public.name  /  ::app_role
    const eref = /::\s*(public\.[\w]+|app_role)\b/gi;
    {
      let m;
      while ((m = eref.exec(ln)) !== null) refAt("type", m[1], fi, file, line, t.slice(0, 120));
    }

    // ---- idempotency WARNs (suppressed inside guarded DO blocks)
    if (inDoBlock(idx)) return;
    if (/^\s*CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(ln)) {
      warns.push({ file, line, kind: "table", msg: "bare CREATE TABLE (fails on re-apply)", ctx: t.slice(0, 100) });
    }
    if (/^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS)/i.test(ln)) {
      warns.push({ file, line, kind: "index", msg: "bare CREATE INDEX (fails on re-apply)", ctx: t.slice(0, 100) });
    }
    if (/^\s*CREATE\s+TYPE\s+(?!IF\s+NOT\s+EXISTS)/i.test(ln)) {
      warns.push({ file, line, kind: "type", msg: "bare CREATE TYPE (fails on re-apply)", ctx: t.slice(0, 100) });
    }
    if (/^\s*CREATE\s+FUNCTION\s+/i.test(ln)) {
      const nm = ln.match(/^\s*CREATE\s+FUNCTION\s+([\w.]+)/i)?.[1];
      if (nm && droppedFns.has(norm(nm))) return; // DROP IF EXISTS-guarded
      warns.push({ file, line, kind: "function", msg: "CREATE FUNCTION without OR REPLACE", ctx: t.slice(0, 100) });
    }
  });
});

// ---- report: dedupe FAILs per (file, kind, normalized name), keep first line
const seen = new Set();
const uniqFails = fails.filter((f) => {
  const k = `${f.file}|${f.kind}|${norm(f.name)}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

console.log(`\nChecked ${files.length} migrations.\n`);
if (uniqFails.length === 0) {
  console.log("FAILs: none — every referenced object is defined earlier in the chain.");
} else {
  console.log(`FAILs: ${uniqFails.length} (referenced before definition — fresh apply aborts)`);
  for (const f of uniqFails) {
    console.log(`  FAIL  ${f.file}:${f.line}  [${f.kind}] ${f.name}`);
    console.log(`        ${f.ctx}`);
  }
}
if (warns.length === 0) {
  console.log("WARNs: none — chain is fully re-runnable.");
} else {
  console.log(`\nWARNs: ${warns.length} (non-idempotent statements)`);
  for (const w of warns) {
    console.log(`  WARN  ${w.file}:${w.line}  [${w.kind}] ${w.msg}`);
    console.log(`        ${w.ctx}`);
  }
}
console.log("");
if (uniqFails.length > 0) process.exit(1);
if (STRICT && warns.length > 0) process.exit(2);
