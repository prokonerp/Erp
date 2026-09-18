#!/usr/bin/env python3
"""
gen-missing-types.py — add public tables / RPCs that exist in the database but
are absent from src/integrations/supabase/types.ts (which is hand-kept because
`supabase gen types` needs Docker / the Management API, neither available here).

It introspects a fully-migrated PostgreSQL and splices generated TypeScript
entries into types.ts in the same style the Supabase generator uses
(alphabetical, Row/Insert/Update/Relationships, Args/Returns).

Usage:
  python3 scripts/gen-missing-types.py \
      --db "host=127.0.0.1 port=55432 dbname=prokon_types" [--write]

  --functions a,b,c   restrict function generation to this list (default:
                      read from src, every .rpc("...") call site)
  --write             apply changes (default is a dry run that prints a diff)
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TYPES = ROOT / "src" / "integrations" / "supabase" / "types.ts"

# --------------------------------------------------------------------------- #
# database access
# --------------------------------------------------------------------------- #
def psql_json(conn, sql):
    r = subprocess.run(
        ["psql", conn, "-tA", "-c", f"select coalesce(json_agg(t), '[]'::json) from ({sql}) t"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        sys.exit(f"psql failed:\n{r.stderr}")
    return json.loads(r.stdout.strip() or "[]")


def load_schema(conn):
    tables = psql_json(conn, """
        select t.tablename as name
        from pg_tables t where t.schemaname = 'public'
    """)
    cols = psql_json(conn, """
        select c.table_name, c.column_name, c.data_type, c.udt_name,
               c.is_nullable, (c.column_default is not null) as has_default,
               c.ordinal_position
        from information_schema.columns c
        where c.table_schema = 'public'
        order by c.table_name, c.ordinal_position
    """)
    fks = psql_json(conn, """
        select con.conname, cl.relname as table_name,
               con.confrelid::regclass::text as ref_table,
               (select array_agg(a.attname order by u.ord)
                  from unnest(con.conkey) with ordinality u(attnum, ord)
                  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = u.attnum) as columns,
               (select array_agg(a.attname order by u.ord)
                  from unnest(con.confkey) with ordinality u(attnum, ord)
                  join pg_attribute a on a.attrelid = con.confrelid and a.attnum = u.attnum) as ref_columns
        from pg_constraint con
        join pg_class cl on cl.oid = con.conrelid
        join pg_namespace n on n.oid = cl.relnamespace
        where con.contype = 'f' and n.nspname = 'public'
    """)
    enums = psql_json(conn, """
        select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' group by t.typname order by t.typname
    """)
    return tables, cols, fks, enums


def load_functions(conn, names):
    if not names:
        return []
    quoted = ",".join("'" + n + "'" for n in names)
    return psql_json(conn, f"""
        select p.proname as name,
               pg_get_function_arguments(p.oid) as args,
               pg_get_function_result(p.oid)  as returns,
               p.proretset as setof
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ({quoted})
        order by p.proname, p.oid
    """)


# --------------------------------------------------------------------------- #
# type mapping
# --------------------------------------------------------------------------- #
SCALARS = {
    "uuid": "string", "text": "string", "character varying": "string",
    "character": "string", "citext": "string", "name": "string",
    "date": "string", "timestamp with time zone": "string",
    "timestamp without time zone": "string", "time with time zone": "string",
    "time without time zone": "string", "inet": "string", "cidr": "string",
    "macaddr": "string", "bytea": "string", "interval": "string",
    "tsvector": "string", "xml": "string", "varchar": "string", "bpchar": "string",
    "integer": "number", "bigint": "number", "smallint": "number",
    "numeric": "number", "double precision": "number", "real": "number",
    "money": "number", "oid": "number",
    "boolean": "boolean",
    "json": "Json", "jsonb": "Json",
}

def ts_base(data_type, udt_name, enum_names):
    if data_type == "USER-DEFINED":
        if udt_name in enum_names:
            return f'Database["public"]["Enums"]["{udt_name}"]'
        return "Json"
    if data_type == "ARRAY":
        return ts_base("", udt_name[1:], enum_names) + "[]"
    return SCALARS.get(data_type, "Json")


def ts_type(col, enum_names):
    t = ts_base(col["data_type"], col["udt_name"], enum_names)
    return f'{t} | null' if col["is_nullable"] == "YES" else t


def emit_table(name, cols, fks, enum_names):
    def lines(fields, indent):
        return "\n".join(f"{indent}{f}" for f in fields)

    I = " " * 10  # column indent

    row = [f'{c["column_name"]}: {ts_type(c, enum_names)}' for c in cols]
    ins = []
    for c in cols:
        opt = "?" if (c["is_nullable"] == "YES" or c["has_default"]) else ""
        ins.append(f'{c["column_name"]}{opt}: {ts_type(c, enum_names)}')
    upd = [f'{c["column_name"]}?: {ts_type(c, enum_names)}' for c in cols]

    rel = []
    for fk in fks:
        rel.append(
            "          {\n"
            f'            foreignKeyName: "{fk["conname"]}"\n'
            f'            columns: {json.dumps(fk["columns"])}\n'
            "            isOneToOne: false\n"
            f'            referencedRelation: "{fk["ref_table"].replace("public.", "")}"\n'
            f'            referencedColumns: {json.dumps(fk["ref_columns"])}\n'
            "          }"
        )
    rel_block = "[]" if not rel else "[\n" + ",\n".join(rel) + ",\n        ]"

    return (
        f"      {name}: {{\n"
        f"        Row: {{\n{lines(row, I)}\n        }}\n"
        f"        Insert: {{\n{lines(ins, I)}\n        }}\n"
        f"        Update: {{\n{lines(upd, I)}\n        }}\n"
        f"        Relationships: {rel_block}\n"
        f"      }}\n"
    )


def split_args(argstr):
    """Split 'a uuid, b text DEFAULT x, c numeric' on top-level commas."""
    parts, depth, cur, q = [], 0, "", False
    for ch in argstr:
        if ch == "'":
            q = not q
        elif not q:
            if ch in "([":
                depth += 1
            elif ch in ")]":
                depth -= 1
            elif ch == "," and depth == 0:
                parts.append(cur.strip()); cur = ""; continue
        cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


def emit_function(fn, enum_names):
    args = []
    for a in split_args(fn["args"] or ""):
        m = re.match(r"^([\w]+)\s+(.*?)(?:\s+DEFAULT\s+(.*))?$", a, re.S)
        if not m:
            continue
        aname, atype, adefault = m.group(1), m.group(2).strip(), m.group(3)
        if aname in ("OUT", "INOUT", "IN", "VARIADIC"):
            continue
        # normalise pg type text
        atype = re.sub(r"\s+with(out)? time zone$", "", atype)
        t = SCALARS.get(atype, "Json")
        opt = "?" if adefault is not None else ""
        args.append(f"{aname}{opt}: {t}")

    ret = (fn["returns"] or "void").strip()
    m = re.match(r"^TABLE\s*\((.*)\)$", ret, re.S)
    if m and fn["setof"]:
        fields = []
        for f in split_args(m.group(1)):
            fm = re.match(r"^([\w]+)\s+(.*)$", f, re.S)
            if not fm:
                continue
            fname, ftype = fm.group(1), fm.group(2).strip()
            ftype = re.sub(r"\s+with(out)? time zone$", "", ftype)
            fields.append(f'{fname}: {SCALARS.get(ftype, "Json")} | null')
        ret_ts = "{\n          " + "\n          ".join(fields) + "\n        }[]"
    elif m:
        ret_ts = "Json[]"
    else:
        ret_ts = {"void": "undefined", "boolean": "boolean"}.get(
            ret, SCALARS.get(re.sub(r"^SETOF\s+", "", ret), "Json")
        )
    args_ts = "{ " + "; ".join(args) + " }" if args else "Record<PropertyKey, never>"
    return f"      {fn['name']}: {{ Args: {args_ts}; Returns: {ret_ts} }}\n"


# --------------------------------------------------------------------------- #
# splicing
# --------------------------------------------------------------------------- #
def existing_keys(block):
    """Keys of an object-of-objects block (Tables / Functions / CompositeTypes)."""
    return set(re.findall(r"^      ([a-z_][a-z0-9_]*): \{", block, re.M))


def existing_enum_keys(block):
    """Keys of the Enums block — values are string-literal unions, not objects."""
    return set(re.findall(r"^      ([a-z_][a-z0-9_]*):", block, re.M))


def insert_alphabetical(text, block_open, block_close, snippet_name, snippet):
    """Insert snippet into the block whose keys start with block_open.

    The block text ends with the indentation of the NEXT top-level key, so when
    the snippet sorts last it must go BEFORE that trailing indent line — never
    after it, or it merges with the following block header.
    """
    start = text.index(block_open) + len(block_open)
    end = text.index(block_close, start)
    block = text[start:end]
    lines = block.split("\n")
    # the block ends with its own closing "    }" line — never insert past it
    close_idx = len(lines) - 1
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].rstrip() == "    }":
            close_idx = i
            break
    idx = close_idx
    for i, ln in enumerate(lines[:close_idx]):
        m = re.match(r"^      ([a-z_][a-z0-9_]*): \{", ln)
        if m and m.group(1) > snippet_name:
            idx = i
            break
    lines.insert(idx, snippet.rstrip("\n"))
    return text[:start] + "\n".join(lines) + text[end:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--types", default=str(TYPES))
    ap.add_argument("--functions", default="")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()

    path = Path(a.types)
    text = path.read_text()

    t_start = text.index("    Tables: {")
    t_end = text.index("    Views: {", t_start)
    f_start = text.index("    Functions: {")
    f_end = text.index("    Enums: {", f_start)
    en_start = text.index("    Enums: {", f_end + 1) if text.count("    Enums: {") > 1 else f_end
    # enums live between Functions and CompositeTypes (first Enums occurrence)
    en_start = text.index("    Enums: {")
    en_end = text.index("    CompositeTypes: {", en_start)

    existing_tables = existing_keys(text[t_start:t_end])
    existing_fns = existing_keys(text[f_start:f_end])
    existing_enums = existing_enum_keys(text[en_start:en_end])

    tables, cols, fks, enums = load_schema(a.db)
    enum_names = {e["name"] for e in enums}

    db_tables = {t["name"] for t in tables}
    missing_tables = sorted(db_tables - existing_tables)

    if a.functions:
        fn_names = [x for x in a.functions.split(",") if x]
    else:
        # default: every .rpc("...") call site in src — the RPCs the app uses
        found = set()
        for f in (ROOT / "src").rglob("*"):
            if f.suffix in (".ts", ".tsx"):
                found.update(re.findall(r'\.rpc\(\s*"([a-z_0-9]+)"', f.read_text(errors="ignore")))
        fn_names = sorted(found)
    fns = load_functions(a.db, fn_names)
    # an overloaded function must appear ONCE — keep the fullest signature
    by_name = {}
    for f in fns:
        cur = by_name.get(f["name"])
        if cur is None or len(f["args"] or "") > len(cur["args"] or ""):
            by_name[f["name"]] = f
    fns = list(by_name.values())
    missing_fns = [f for f in fns if f["name"] not in existing_fns]

    missing_enums = [e for e in enums if e["name"] not in existing_enums]

    if not (missing_tables or missing_fns or missing_enums):
        print("nothing missing — types.ts already matches the database")
        return

    print(f"missing: {len(missing_tables)} tables, {len(missing_fns)} functions, {len(missing_enums)} enums")
    for t in missing_tables:
        print("   table   ", t)
    for f in missing_fns:
        print("   function", f["name"])

    out = text
    # enums first (tables reference them)
    for e in sorted(missing_enums, key=lambda x: x["name"]):
        labels = " | ".join(f'"{l}"' for l in e["labels"])
        out = insert_alphabetical(out, "    Enums: {", "    CompositeTypes: {", e["name"], f'      {e["name"]}: {labels}\n')

    for tname in missing_tables:
        tcols = sorted([c for c in cols if c["table_name"] == tname], key=lambda c: c["column_name"])
        tfks = [f for f in fks if f["table_name"] == tname]
        out = insert_alphabetical(out, "    Tables: {", "    Views: {", tname, emit_table(tname, tcols, tfks, enum_names))

    for fn in sorted(missing_fns, key=lambda f: f["name"]):
        out = insert_alphabetical(out, "    Functions: {", "    Enums: {", fn["name"], emit_function(fn, enum_names))

    if a.write:
        path.write_text(out)
        print(f"wrote {path}")
    else:
        print("\n(dry run — pass --write to apply)")


if __name__ == "__main__":
    main()
