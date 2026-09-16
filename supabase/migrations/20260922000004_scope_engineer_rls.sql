-- Migration: 20260922000004_scope_engineer_rls.sql
-- Scope Engineer-role holders to their assigned calls at the database layer.
--
-- CONTEXT: any authenticated user can currently SELECT all tickets, and any
-- holder of tickets.create can UPDATE any ticket_visits / verification row,
-- read the full assignment log, and read every engineer's uploaded docs.
-- The 'Engineer' app_role already promises "read assigned calls + upload
-- notes/photos" (20260915000003) and the /eng UI already enforces it — this
-- migration makes the database agree with the UI.
--
-- BLAST-RADIUS RULE: behavior changes ONLY for users holding the 'Engineer'
-- app_role. Admins, office/dispatcher roles, and every other authenticated
-- user keep byte-identical access to what they had before. Each policy below
-- is structured as (old-condition) AND (admin OR NOT engineer OR assigned),
-- so for non-engineers the new clause is TRUE and the old semantics hold.
--
-- ASSIGNMENT has two legs because the assigned_employee_id FK backfill is
-- still in flight (see 20260915000001 §2): FK match first, then a
-- name-equality fallback against the caller's own employee row. The fallback
-- is transitional — a follow-up migration removes it once every open ticket
-- carries the FK.
--
-- SAFE: additive only, idempotent (CREATE OR REPLACE + DROP IF EXISTS +
-- CREATE; re-running changes nothing). Zero destructive statements; no rows
-- read, written, or altered — RLS metadata only.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN.

-- =====================================================================
-- 0) Helpers (self-contained; STABLE so Postgres memoizes per statement)
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

-- Self-sufficiency: RLS must be on for the storage policy below to have any
-- effect (it is on in production; this is a no-op there). Idempotent.
DO $$ BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- =====================================================================
-- 1) Scoped policies (guarded: skip cleanly if prerequisites are missing)
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_permission') THEN
    RAISE NOTICE 'scope_engineer_rls: has_role/has_permission missing — skipping';
    RETURN;
  END IF;
  IF to_regclass('public.tickets') IS NULL
     OR to_regclass('public.ticket_visits') IS NULL
     OR to_regclass('public.ticket_customer_verifications') IS NULL
     OR to_regclass('public.ticket_equipment_verifications') IS NULL
     OR to_regclass('public.ticket_assignment_history') IS NULL THEN
    RAISE NOTICE 'scope_engineer_rls: engineer tables missing — skipping';
    RETURN;
  END IF;

  -- -- -- tickets SELECT: engineers see assigned calls only -- -- --
  DROP POLICY IF EXISTS "auth view tickets" ON public.tickets;
  CREATE POLICY "auth view tickets" ON public.tickets
    FOR SELECT TO authenticated
    USING (
      auth.uid() IS NOT NULL
      AND (is_deleted = false OR public.has_role(auth.uid(), 'admin'::public.app_role))
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR NOT public.is_field_engineer(auth.uid())
        OR assigned_employee_id = public.my_employee_id(auth.uid())
        OR (
          assigned_engineer_name IS NOT NULL
          AND assigned_engineer_name = public.my_employee_name(auth.uid())
        )
      )
    );

  -- -- -- ticket_visits UPDATE: assigned engineers only -- -- --
  DROP POLICY IF EXISTS "auth update tvis" ON public.ticket_visits;
  CREATE POLICY "auth update tvis" ON public.ticket_visits
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_permission(auth.uid(), 'tickets', 'create')
        AND NOT public.is_field_engineer(auth.uid())
      )
      OR (
        public.is_field_engineer(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.tickets t
          WHERE t.id = ticket_visits.ticket_id
            AND (
              t.assigned_employee_id = public.my_employee_id(auth.uid())
              OR (
                t.assigned_engineer_name IS NOT NULL
                AND t.assigned_engineer_name = public.my_employee_name(auth.uid())
              )
            )
        )
      )
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_permission(auth.uid(), 'tickets', 'create')
        AND NOT public.is_field_engineer(auth.uid())
      )
      OR (
        public.is_field_engineer(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.tickets t
          WHERE t.id = ticket_visits.ticket_id
            AND (
              t.assigned_employee_id = public.my_employee_id(auth.uid())
              OR (
                t.assigned_engineer_name IS NOT NULL
                AND t.assigned_engineer_name = public.my_employee_name(auth.uid())
              )
            )
        )
      )
    );

  -- -- -- verification UPDATEs: assigned engineers only (SELECT/INSERT unchanged) -- -- --
  DROP POLICY IF EXISTS "auth update tcv" ON public.ticket_customer_verifications;
  CREATE POLICY "auth update tcv" ON public.ticket_customer_verifications
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_permission(auth.uid(), 'tickets', 'create')
        AND NOT public.is_field_engineer(auth.uid())
      )
      OR (
        public.is_field_engineer(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.tickets t
          WHERE t.id = ticket_customer_verifications.ticket_id
            AND (
              t.assigned_employee_id = public.my_employee_id(auth.uid())
              OR (
                t.assigned_engineer_name IS NOT NULL
                AND t.assigned_engineer_name = public.my_employee_name(auth.uid())
              )
            )
        )
      )
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_permission(auth.uid(), 'tickets', 'create')
        AND NOT public.is_field_engineer(auth.uid())
      )
      OR (
        public.is_field_engineer(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.tickets t
          WHERE t.id = ticket_customer_verifications.ticket_id
            AND (
              t.assigned_employee_id = public.my_employee_id(auth.uid())
              OR (
                t.assigned_engineer_name IS NOT NULL
                AND t.assigned_engineer_name = public.my_employee_name(auth.uid())
              )
            )
        )
      )
    );

  DROP POLICY IF EXISTS "auth update tev" ON public.ticket_equipment_verifications;
  CREATE POLICY "auth update tev" ON public.ticket_equipment_verifications
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_permission(auth.uid(), 'tickets', 'create')
        AND NOT public.is_field_engineer(auth.uid())
      )
      OR (
        public.is_field_engineer(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.tickets t
          WHERE t.id = ticket_equipment_verifications.ticket_id
            AND (
              t.assigned_employee_id = public.my_employee_id(auth.uid())
              OR (
                t.assigned_engineer_name IS NOT NULL
                AND t.assigned_engineer_name = public.my_employee_name(auth.uid())
              )
            )
        )
      )
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_permission(auth.uid(), 'tickets', 'create')
        AND NOT public.is_field_engineer(auth.uid())
      )
      OR (
        public.is_field_engineer(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.tickets t
          WHERE t.id = ticket_equipment_verifications.ticket_id
            AND (
              t.assigned_employee_id = public.my_employee_id(auth.uid())
              OR (
                t.assigned_engineer_name IS NOT NULL
                AND t.assigned_engineer_name = public.my_employee_name(auth.uid())
              )
            )
        )
      )
    );

  -- -- -- assignment history SELECT: own rows + own tickets (was USING(true)) -- -- --
  DROP POLICY IF EXISTS "auth select assignment_history" ON public.ticket_assignment_history;
  CREATE POLICY "auth select assignment_history" ON public.ticket_assignment_history
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR NOT public.is_field_engineer(auth.uid())
      OR employee_id = public.my_employee_id(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.tickets t
        WHERE t.id = ticket_assignment_history.ticket_id
          AND (
            t.assigned_employee_id = public.my_employee_id(auth.uid())
            OR (
              t.assigned_engineer_name IS NOT NULL
              AND t.assigned_engineer_name = public.my_employee_name(auth.uid())
            )
          )
      )
    );

  -- -- -- engineer-uploads SELECT: own folder (reads via signed URLs bypass RLS) -- -- --
  DROP POLICY IF EXISTS "Authenticated can read engineer-uploads" ON storage.objects;
  CREATE POLICY "Authenticated can read engineer-uploads" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'engineer-uploads'
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR NOT public.is_field_engineer(auth.uid())
        OR (
          (storage.foldername(name))[1] = 'engineer'
          AND (storage.foldername(name))[2] = public.my_employee_id(auth.uid())::text
        )
      )
    );
END $$;
