-- Migration: 20260915000005_engineer_own_employee_row.sql
-- Engineers Module: let a signed-in user read their OWN employee row.
-- WHY: employees SELECT ("view employees") allows admin or employees-read
-- only. Engineer logins have neither, so every engineer-side identity lookup
-- (queue resolution, ticket ownership guard) silently returned zero rows and
-- the portal dead-ended at "contact admin" / "not assigned" — with no error.
-- This adds a narrow permissive policy: a row is visible iff its auth_user_id
-- matches the caller. Admins keep full access via the existing policy
-- (permissive policies OR together). No other table touched.
-- SAFE: additive only, idempotent (DROP IF EXISTS + CREATE), zero data writes.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'auth_user_id'
  ) THEN
    RAISE NOTICE 'Migration 0005: auth_user_id column missing (run 0001 first) — policy not created';
    RETURN;
  END IF;
  DROP POLICY IF EXISTS "own employee row" ON public.employees;
  CREATE POLICY "own employee row" ON public.employees
    FOR SELECT TO authenticated
    USING (auth_user_id = auth.uid());
END $$;
