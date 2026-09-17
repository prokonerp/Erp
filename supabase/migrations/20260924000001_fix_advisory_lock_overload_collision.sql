-- 20260924000001_fix_advisory_lock_overload_collision.sql
--
-- ROOT-CAUSE FIX for the production storage incident (2026-09-16 → 2026-09-17).
--
-- SYMPTOM
--   Every object WRITE to Supabase Storage failed:
--     500 {"statusCode":"500","error":"DatabaseError","message":"database error, code: P0001"}
--   on POST /storage/v1/object/<bucket>/<path> AND POST /storage/v1/upload/resumable
--   (tus), for every bucket, while list/read/sign/delete kept working.
--   Reproduced from the Supabase Dashboard's own file browser — i.e. with zero
--   application code involved — proving it was never an app bug.
--
-- CAUSE
--   20260911000003_advisory_lock_rpc.sql created these in `public`:
--     pg_advisory_lock(text), pg_advisory_unlock(text), pg_advisory_xact_lock(text)
--   These are OVERLOADS of the pg_catalog built-ins, which take bigint.
--   20260923000008_harden_advisory_locks.sql then added a namespace guard that
--   RAISEs P0001 for any key not prefixed 'so_fulfill:'.
--
--   The storage API calls pg_advisory_* with an untyped/string key on its object
--   write path. With a `text` overload present, PostgreSQL's unknown-argument
--   resolution prefers the string category, so that call binds to
--   public.pg_advisory_*(text) instead of pg_catalog.pg_advisory_*(bigint) —
--   and the guard raises 'advisory lock key outside app namespace' (P0001).
--
--   Evidence: the Postgres log shows exactly that RAISE 0.5–1.0s after all 8
--   failing storage writes on 2026-09-16 (18:08:59→18:09:00 … 18:42:15→18:42:16),
--   including a bare signed-URL PUT that no application code touched.
--
-- FIX
--   Drop the three colliding overloads (restoring the real built-ins for every
--   caller, including the platform) and re-create the app's wrappers under an
--   app-namespaced, collision-free name: app_advisory_lock / _unlock / _xact_lock.
--   The application is updated to call the new names in the same commit.
--
-- SAFE
--   Function DDL only. No table/row/policy/bucket change. Zero
--   DELETE / TRUNCATE / DROP TABLE / DROP COLUMN statements.
--   The three DROPs are the fix — they remove functions that hijack the platform.
--
-- APPLY ORDER
--   After 20260911000003 and 20260923000008 (both already live). Apply by hand in
--   the Supabase SQL editor, then reload the PostgREST schema cache (see tail).

-- ── 1) Remove the overloads that hijack the platform's advisory-lock calls ────
DROP FUNCTION IF EXISTS public.pg_advisory_lock(text);
DROP FUNCTION IF EXISTS public.pg_advisory_unlock(text);
DROP FUNCTION IF EXISTS public.pg_advisory_xact_lock(text);

-- ── 2) Re-create the app wrappers under a collision-free name ────────────────
--    Same guards and semantics as 20260923000008, new names.

CREATE OR REPLACE FUNCTION public.app_advisory_lock(key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF key IS NULL OR key !~ '^so_fulfill:' THEN RAISE EXCEPTION 'advisory lock key outside app namespace'; END IF;
  PERFORM pg_advisory_lock(hashtextextended(key, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.app_advisory_unlock(key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF key IS NULL OR key !~ '^so_fulfill:' THEN RAISE EXCEPTION 'advisory lock key outside app namespace'; END IF;
  PERFORM pg_advisory_unlock(hashtextextended(key, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.app_advisory_xact_lock(key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF key IS NULL OR key !~ '^so_fulfill:' THEN RAISE EXCEPTION 'advisory lock key outside app namespace'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(key, 0));
END;
$$;

-- ── 3) Grants ────────────────────────────────────────────────────────────────
--    authenticated + service_role = the two roles the app calls with.
--    PUBLIC is revoked so anon can no longer hold a foreign 'so_fulfill:' key
--    (that was the abuse vector 20260923000008 tried to close but could not,
--    because the old names carried the default PUBLIC EXECUTE grant).

REVOKE ALL ON FUNCTION public.app_advisory_lock(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_advisory_unlock(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_advisory_xact_lock(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.app_advisory_lock(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_advisory_unlock(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_advisory_xact_lock(text) TO authenticated, service_role;

-- ── Reload PostgREST's schema cache so the new RPC names resolve ─────────────
--    (Supabase normally does this automatically; harmless to repeat.)
NOTIFY pgrst, 'reload schema';
