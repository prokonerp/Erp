-- Migration: 20260923000009_fix_password_history_search_path.sql
--
-- CONTEXT:
--   public.record_password_history(uuid, text) and public.check_password_reuse(uuid, text)
--   (supabase/migrations/20260829000002_harden_rls_permissions.sql lines ~215-252)
--   pin SET search_path TO 'public' but call crypt()/gen_salt(), which live in the
--   extensions schema (pgcrypto) -> 42883 (undefined_function) on every password
--   change, currently swallowed client-side (see scripts/provision-engineers.sql
--   step-5 note, the source of truth for the live failure).
--   Fix: widen search_path to 'public, extensions' so pgcrypto resolves, keeping
--   public first so unqualified table references still resolve to public.
--
-- BLAST-RADIUS:
--   DDL metadata only (ALTER FUNCTION ... SET search_path). No body rewrite, no
--   table changes, no data changes, no grant changes, no trigger rewiring.
--
-- SAFE: additive, idempotent, safe to re-run. Guarded DO blocks check pg_proc for
--   each (uuid, text) signature first and RAISE NOTICE + skip when absent.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE / DROP TABLE /
--   DROP COLUMN / DROP FUNCTION statements, zero GRANT/REVOKE changes, and zero
--   CREATE OR REPLACE FUNCTION bodies.
--
-- Overload inventory (see report): grep of supabase/migrations shows only the
--   single (uuid, text) overload of each function (both defined in
--   20260829000002_harden_rls_permissions.sql; no other migration re-defines
--   them). Both are covered below; no second overload needs the fix.

-- =====================================================================
-- 1) public.record_password_history(uuid, text)
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'record_password_history'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'uuid, text'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.record_password_history(uuid, text) SET search_path TO ''public, extensions''';
    RAISE NOTICE 'search_path fixed on public.record_password_history(uuid, text)';
  ELSE
    RAISE NOTICE 'skip: public.record_password_history(uuid, text) not present';
  END IF;
END $$;

-- =====================================================================
-- 2) public.check_password_reuse(uuid, text)
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'check_password_reuse'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'uuid, text'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.check_password_reuse(uuid, text) SET search_path TO ''public, extensions''';
    RAISE NOTICE 'search_path fixed on public.check_password_reuse(uuid, text)';
  ELSE
    RAISE NOTICE 'skip: public.check_password_reuse(uuid, text) not present';
  END IF;
END $$;
