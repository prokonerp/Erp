-- 20260911000003_advisory_lock_rpc.sql
-- Creates RPC wrappers for pg_advisory_lock/unlock/xact_lock so JS callers
-- (documentFlow.writers.ts withSoFulfillLock) can use them via supabase.rpc().
-- Without these wrappers, the JS lock is dead code (always falls back to optimistic).
--
-- SAFE: Idempotent (CREATE OR REPLACE). No data affected.
--       Functions are SECURITY DEFINER with GRANT EXECUTE to authenticated + service_role.
--       Uses hashtextextended() to convert text key → int8 for Postgres built-ins.
--       Session locks auto-release on disconnect; xact locks at transaction end.

-- ── pg_advisory_lock(key text) — session-level lock ───────────────────────────
CREATE OR REPLACE FUNCTION public.pg_advisory_lock(key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM pg_advisory_lock(hashtextextended(key, 0));
END;
$$;

-- ── pg_advisory_unlock(key text) — release session lock ───────────────────────
CREATE OR REPLACE FUNCTION public.pg_advisory_unlock(key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM pg_advisory_unlock(hashtextextended(key, 0));
END;
$$;

-- ── pg_advisory_xact_lock(key text) — transaction-level lock ──────────────────
CREATE OR REPLACE FUNCTION public.pg_advisory_xact_lock(key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(key, 0));
END;
$$;

-- ── Grant execute to authenticated + service_role ─────────────────────────────
GRANT EXECUTE ON FUNCTION public.pg_advisory_lock(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pg_advisory_unlock(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pg_advisory_xact_lock(text) TO authenticated, service_role;
