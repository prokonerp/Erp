-- Migration: 20260923000007_scope_reads_tighten_history.sql
-- Same-shape policy batch: scope Engineer-role reads on history/child tables
-- (M3 + M4) and tighten assignment-history INSERT to admin-only (M6).
--
-- CONTEXT (per item):
--   M3 — ticket_activities SELECT ("auth view tact") is USING(true) since the
--     snapshot era (supabase/setup_new_supabase.sql:617) and was never dropped:
--     20260915000001 hardened only INSERT/UPDATE/DELETE on ticket_activities,
--     leaving the permissive SELECT in place. This migration DROPs that legacy
--     row and CREATEs a scoped SELECT reusing the exact FK-only leg shapes
--     from 20260923000003 (admin leg + non-engineer leg + EXISTS FK leg via
--     ticket_activities.ticket_id). The legacy policy name is kept so the
--     snapshot-era row is replaced, not duplicated.
--   M4 — ticket_visits SELECT ("auth view ticket_visits") is admin/read/create
--     permissive (20260917000003). Same three legs via
--     ticket_visits.ticket_id. INSERT/UPDATE/DELETE policies on ticket_visits
--     are untouched.
--   M6 — ticket_assignment_history INSERT ("auth insert assignment_history")
--     is admin/create (20260915000001). Tightened to admin-only WITH CHECK.
--     Safe: the automation writer log_ticket_assignment_history() is SECURITY
--     DEFINER (20260915000004), so trigger writes bypass RLS regardless of
--     invoker and keep landing after this change.
--
-- BLAST-RADIUS: Engineer-role reads narrow to assigned tickets on
-- ticket_activities + ticket_visits; everyone else byte-identical. History
-- INSERT becomes admin-only (engineer direct INSERTs now fail; trigger writes
-- unaffected per above).
--
-- SAFE: guarded, idempotent (DROP POLICY IF EXISTS + CREATE; helpers are
-- CREATE OR REPLACE; re-running changes nothing). RLS metadata only — no rows
-- read, written, or altered.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN.

-- =====================================================================
-- 0) Helpers (self-contained; STABLE so Postgres memoizes per statement)
--    Byte-identical to 20260923000003 section 0.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_field_engineer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_users u
    JOIN public.app_roles r ON r.id = u.role_id
    WHERE u.user_id = _user_id
      AND u.status = 'active'
      AND r.name = 'Engineer'
  );
$$;

CREATE OR REPLACE FUNCTION public.my_employee_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.employees WHERE auth_user_id = _user_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.my_employee_name(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT name FROM public.employees WHERE auth_user_id = _user_id LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.is_field_engineer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_employee_id(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_employee_name(uuid) TO authenticated, service_role;

-- =====================================================================
-- 1) Scoped policies (guarded: skip cleanly if target tables are missing)
--    NOTE: deliberately NOT gated on has_role/has_permission — these policies
--    must exist even where helper implementations differ across environments.
--    has_role/has_permission are core helpers referenced exactly as in
--    20260923000003; only table presence is checked.
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.tickets') IS NULL
     OR to_regclass('public.ticket_activities') IS NULL
     OR to_regclass('public.ticket_visits') IS NULL
     OR to_regclass('public.ticket_assignment_history') IS NULL THEN
    RAISE NOTICE 'scope_reads_tighten_history: target tables missing — skipping';
    RETURN;
  END IF;

  -- -- -- M3: ticket_activities SELECT — was USING(true) -- -- --
  DROP POLICY IF EXISTS "auth view tact" ON public.ticket_activities;
  CREATE POLICY "auth view tact" ON public.ticket_activities
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR NOT public.is_field_engineer(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.tickets t
        WHERE t.id = ticket_activities.ticket_id
          AND t.assigned_employee_id = public.my_employee_id(auth.uid())
      )
    );

  -- -- -- M4: ticket_visits SELECT — was admin/read/create -- -- --
  DROP POLICY IF EXISTS "auth view ticket_visits" ON public.ticket_visits;
  CREATE POLICY "auth view ticket_visits" ON public.ticket_visits
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR NOT public.is_field_engineer(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.tickets t
        WHERE t.id = ticket_visits.ticket_id
          AND t.assigned_employee_id = public.my_employee_id(auth.uid())
      )
    );

  -- -- -- M6: assignment_history INSERT — was admin/create, now admin-only -- -- --
  DROP POLICY IF EXISTS "auth insert assignment_history" ON public.ticket_assignment_history;
  CREATE POLICY "auth insert assignment_history" ON public.ticket_assignment_history
    FOR INSERT TO authenticated
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
END $$;
