#!/usr/bin/env bash
#
# verify-migrations.sh — Fresh-database migration replay check (Task B5).
#
# SAFETY GUARANTEE (hard rule, enforced in code below):
#   LOCAL-ONLY, ALWAYS. This script NEVER touches a remote database.
#   - Refuses to run if SUPABASE_DB_URL / POSTGRES_URL / DATABASE_URL /
#     LOCAL_DB_URL (or CLI-linked project ref) points anywhere except
#     localhost / 127.0.0.1 / db.local. Prints the refusal reason.
#   - Uses ONLY `supabase start` / `supabase db reset` / local `psql $LOCAL_URL`.
#   - NEVER runs `supabase db push`, `supabase link`, or any remote command.
#
# Steps:
#   1. supabase start (local stack)
#   2. supabase db reset (full replay from scratch; any error fails)
#   3. For each target migration: apply TWICE via local psql with
#      ON_ERROR_STOP=1, asserting zero errors both times
#   4. Final assertion query (all fk_/chk_ constraints present in pg_constraint)
#   5. Print PASS summary
#
# Exit 0 on full green, non-zero with the failing step named otherwise.
# Remote/system validation is done by the coordinator (syntax check + dry
# review; full docker run only where docker exists). This script is not
# executed by automation against live databases.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STEP="init"

fail() {
  echo "FAIL: step '${STEP}' — $*" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 1. Prerequisite check: supabase CLI + docker present, else exit 2.
# ---------------------------------------------------------------------------
STEP="prereq-check"
command -v supabase >/dev/null 2>&1 || { echo "ERROR: 'supabase' CLI not found on PATH. Install it first (https://supabase.com/docs/guides/cli)." >&2; exit 2; }
command -v docker >/dev/null 2>&1 || { echo "ERROR: 'docker' not found on PATH. Local supabase stack requires Docker." >&2; exit 2; }
command -v psql >/dev/null 2>&1 || { echo "ERROR: 'psql' not found on PATH. Install PostgreSQL client tools first." >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon is not running. Start Docker Desktop / dockerd first." >&2; exit 2; }

# ---------------------------------------------------------------------------
# 2. SAFETY FIRST: refuse unless every configured endpoint is local.
#    Local = empty/unset, or URL/host containing localhost, 127.0.0.1,
#    db.local, or ::1. Anything else => refuse with reason.
# ---------------------------------------------------------------------------
STEP="safety-check"

is_local_value() {
  # Returns 0 if $1 is empty or refers to a local endpoint; 1 otherwise.
  # Parses the host exactly — substring matching would wrongly accept
  # values like 'postgres://evil.com?x=localhost' as local.
  local val="${1:-}"
  if [[ -z "$val" ]]; then
    return 0
  fi
  local host="${val#*://}"       # strip scheme
  host="${host##*@}"             # strip userinfo (greedy: passwords may contain @)
  host="${host%%[:/?#]*}"        # strip port/path/query
  host="${host#[}"               # strip [ of IPv6 literal
  host="${host%]}"               # strip ] of IPv6 literal
  case "$host" in
    localhost|127.0.0.1|db.local|::1) return 0 ;;
    *) return 1 ;;
  esac
}

refuse_remote() {
  # $1 = var name, $2 = value
  echo "REFUSAL: refusing to run — '$1' points to a non-local endpoint." >&2
  echo "  $1='$2'" >&2
  echo "  This script is LOCAL-ONLY (localhost / 127.0.0.1 / db.local)." >&2
  echo "  Unset $1 or point it at the local stack before re-running." >&2
  exit 3
}

for var in SUPABASE_DB_URL POSTGRES_URL DATABASE_URL LOCAL_DB_URL DB_URL PG_URL; do
  val="${!var:-}"
  if ! is_local_value "$val"; then
    refuse_remote "$var" "$val"
  fi
done

# CLI-linked project ref check: any explicit project ref env means "linked",
# which is forbidden for this script. Local `supabase start` needs no ref.
for var in SUPABASE_PROJECT_REF SUPABASE_PROJECT_ID SUPABASE_REF; do
  val="${!var:-}"
  if [[ -n "$val" ]]; then
    echo "REFUSAL: refusing to run — '$var' is set ('$val'), which indicates a CLI-linked remote project." >&2
    echo "  This script is LOCAL-ONLY. Unset $var before re-running." >&2
    exit 3
  fi
done

# Linked config check: supabase/config.toml with a real project_id means the
# CLI is linked to a remote project — refuse (local-only, always).
if [[ -f "supabase/config.toml" ]]; then
  linked_id="$(grep -E '^[[:space:]]*project_id[[:space:]]*=' supabase/config.toml | head -n 1 | sed -E 's/.*=[[:space:]]*"([^"]*)".*/\1/' || true)"
  if [[ -n "${linked_id:-}" ]]; then
    echo "REFUSAL: refusing to run — supabase/config.toml contains project_id='$linked_id' (CLI-linked remote project)." >&2
    echo "  This script is LOCAL-ONLY. Unlink or run in a checkout without a linked project_id." >&2
    exit 3
  fi
fi

# Local connection URL: overrideable only with another LOCAL url (checked above).
# The default holds the stock local Supabase credentials — never used against
# a remote (any non-local value is refused above).
LOCAL_URL="${LOCAL_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
if ! is_local_value "$LOCAL_URL"; then
  refuse_remote "LOCAL_DB_URL (effective LOCAL_URL)" "$LOCAL_URL"
fi

MIGRATIONS=(
  "supabase/migrations/20260923000001_backfill_assignee_links.sql"
  "supabase/migrations/20260923000002_validate_integrity_constraints.sql"
  "supabase/migrations/20260923000003_remove_name_fallback_rls.sql"
  "supabase/migrations/20260923000004_ticket_grn_dc_fk.sql"
)

# All target migration files must exist before touching docker.
STEP="migration-files-present"
for mig in "${MIGRATIONS[@]}"; do
  [[ -f "$mig" ]] || fail "migration file missing: $mig"
done

# ---------------------------------------------------------------------------
# 3a. supabase start (local stack).
# ---------------------------------------------------------------------------
STEP="supabase-start"
supabase start || fail "supabase start failed"

# ---------------------------------------------------------------------------
# 3b. supabase db reset (full replay from scratch; any error fails).
# ---------------------------------------------------------------------------
STEP="supabase-db-reset"
supabase db reset || fail "supabase db reset failed"

# ---------------------------------------------------------------------------
# 3c. Apply each target migration TWICE via local psql, zero errors both times.
# ---------------------------------------------------------------------------
apply_twice() {
  local mig="$1"
  local pass
  for pass in 1 2; do
    STEP="apply-twice:${mig}#${pass}"
    # ON_ERROR_STOP=1 makes psql exit non-zero on the first SQL error;
    # `set -e` + explicit check names the failing step.
    psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -q -f "$mig" || fail "psql apply failed: $mig (pass $pass of 2)"
    echo "OK: $mig (pass $pass of 2, zero errors)"
  done
}

for mig in "${MIGRATIONS[@]}"; do
  apply_twice "$mig"
done

# ---------------------------------------------------------------------------
# 3d. Final assertion: all fk_/chk_ constraints present in pg_constraint.
# ---------------------------------------------------------------------------
STEP="final-constraint-assertion"
constraint_count="$(psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT count(*) FROM pg_constraint WHERE conname LIKE 'fk\_%' ESCAPE '\\' OR conname LIKE 'chk\_%' ESCAPE '\\';")" \
  || fail "final constraint count query failed"
# Trim whitespace.
constraint_count="$(echo "$constraint_count" | tr -d '[:space:]')"
if [[ -z "$constraint_count" ]] || [[ "$constraint_count" -eq 0 ]]; then
  fail "expected fk_/chk_ constraints in pg_constraint, found '${constraint_count:-<empty>}'"
fi
echo "OK: pg_constraint holds ${constraint_count} fk_/chk_ constraints"

# Any fk_/chk_ constraint left NOT VALID is a failure.
STEP="final-constraint-validated"
invalid_count="$(psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -tAX -c "SELECT count(*) FROM pg_constraint WHERE (conname LIKE 'fk\_%' ESCAPE '\\' OR conname LIKE 'chk\_%' ESCAPE '\\') AND NOT convalidated;")" \
  || fail "constraint convalidated query failed"
invalid_count="$(echo "$invalid_count" | tr -d '[:space:]')"
if [[ "$invalid_count" != "0" ]]; then
  psql "$LOCAL_URL" -v ON_ERROR_STOP=1 -c "SELECT conname, contype, convalidated, conrelid::regclass AS on_table FROM pg_constraint WHERE (conname LIKE 'fk\_%' ESCAPE '\\' OR conname LIKE 'chk\_%' ESCAPE '\\') AND NOT convalidated ORDER BY conname;" >&2 || true
  fail "found ${invalid_count} fk_/chk_ constraints with convalidated = false"
fi
echo "OK: all fk_/chk_ constraints validated (convalidated = true)"

# ---------------------------------------------------------------------------
# 4. PASS summary. Exit 0 on full green.
# ---------------------------------------------------------------------------
STEP="done"
echo "PASS: fresh migration replay green — supabase start + db reset + 4 migrations × 2 applies + pg_constraint assertions."
exit 0
