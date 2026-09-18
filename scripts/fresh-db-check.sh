#!/usr/bin/env bash
#
# fresh-db-check.sh — replay the ENTIRE migration chain on a throwaway LOCAL
# PostgreSQL cluster with Supabase prerequisite stubs, twice, asserting zero
# errors. This is the strongest verification available without Docker/Supabase.
#
# SAFETY: local-only, always. Never touches Supabase or any remote database.
#   - initialises a cluster under a temp dir
#   - listens on a unix socket only (no TCP), port not published
#   - drops the cluster on exit
#
# Usage: bash scripts/fresh-db-check.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@15/bin}"
[ -x "$PGBIN/pg_ctl" ] || PGBIN="$(dirname "$(command -v pg_ctl)")"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/prokon-freshdb.XXXXXX")"
DATA="$TMP/data"
SOCK="$TMP/sock"
LOG="$TMP/pg.log"
export PGHOST="$SOCK"
export PGDATABASE=prokon_fresh
export PGUSER="$(whoami)"
mkdir -p "$SOCK"

cleanup() {
  "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "==> initdb ($($PGBIN/postgres --version))"
"$PGBIN/initdb" -D "$DATA" -U "$PGUSER" --no-locale --encoding=UTF8 >/dev/null

echo "==> start (unix socket only)"
"$PGBIN/pg_ctl" -D "$DATA" -l "$LOG" -o "-k $SOCK -c listen_addresses=''" -w start >/dev/null

echo "==> create database + stubs"
"$PGBIN/createdb" "$PGDATABASE"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q --single-transaction -d "$PGDATABASE" -f scripts/local-pg-supabase-stubs.sql >/dev/null

apply_all() {
  local pass="$1"
  local fail=0
  # bootstrap first (sorts before the chain), then every migration in order
  for f in supabase/migrations/*.sql; do
    if ! "$PGBIN/psql" -v ON_ERROR_STOP=1 -q --single-transaction -d "$PGDATABASE" -f "$f" >"$TMP/out.txt" 2>&1; then
      echo "  PASS $pass FAILED: $f"
      grep -nE "ERROR|FATAL|LINE [0-9]+" "$TMP/out.txt" | tail -20 | sed 's/^/      /'
      echo "      --- last lines ---"
      tail -6 "$TMP/out.txt" | sed 's/^/      /'
      fail=1
      break
    fi
  done
  return $fail
}

echo "==> pass 1 (fresh apply, full chain)"
if ! apply_all 1; then echo "RESULT: FAIL (pass 1)"; exit 1; fi

echo "==> pass 2 (re-apply — proves idempotency)"
if ! apply_all 2; then echo "RESULT: FAIL (pass 2 — not idempotent)"; exit 1; fi

echo "==> post-checks"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q -d "$PGDATABASE" -tA <<'SQL'
select 'tables=' || count(*) from pg_tables where schemaname = 'public';
select 'has_role=' || (to_regprocedure('public.has_role(uuid,public.app_role)') is not null);
select 'rls_tables_without_policy=' || count(*) from (
  select c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    and c.relname not in ('public_rate_limit_hits','engineer_location_settings')
) x;
select '  - no-policy: ' || c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relrowsecurity
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    and c.relname not in ('public_rate_limit_hits','engineer_location_settings')
  order by 1;
SQL

echo "==> preflight-live.sql on a FULLY-APPLIED db (reference output)"
"$PGBIN/psql" -v ON_ERROR_STOP=1 -q -d "$PGDATABASE" -f scripts/preflight-live.sql || { echo "RESULT: FAIL (preflight did not run)"; exit 1; }

echo "RESULT: PASS (full chain applied twice, zero errors; preflight valid)"
