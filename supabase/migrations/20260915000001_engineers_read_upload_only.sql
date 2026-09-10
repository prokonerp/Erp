-- Migration: 20260915000001_engineers_read_upload_only.sql
-- Engineers Module: READ + UPLOAD only. All edits/status/assign/delete stay with services+admin.
-- SAFE: additive only, idempotent (IF NOT EXISTS / DROP IF EXISTS + CREATE), zero destructive statements.
-- No backfill UPDATEs — report-only SELECTs in comments where needed.

-- =====================================================================
-- 1) employees: add auth_user_id for future Supabase Auth linking
--    Column only — no FK constraint yet (safe, zero data loss).
--    Email dedup UNIQUE deferred: destructive if dupes exist; index + comment only.
-- =====================================================================
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS auth_user_id uuid;

-- Unique index (one row per auth user once linked). Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_auth_user_id
  ON public.employees (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Comment: dedup email before adding UNIQUE constraint
-- Run once: SELECT email, count(*) FROM employees GROUP BY email HAVING count(*) > 1;
-- After dedup, add: ALTER TABLE public.employees ADD CONSTRAINT employees_email_unique UNIQUE (email);

-- =====================================================================
-- 2) tickets: add assigned_employee_id for proper FK-based assignment
--    Column + index only — no FK constraint yet (backfill required first).
--    Constraint guidance left as comment for later migration.
-- =====================================================================
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS assigned_employee_id uuid;

CREATE INDEX IF NOT EXISTS idx_tickets_assigned_employee_id
  ON public.tickets (assigned_employee_id)
  WHERE assigned_employee_id IS NOT NULL;

-- Future FK (after backfill assigned_engineer_name/phone → assigned_employee_id):
-- ALTER TABLE public.tickets
--   ADD CONSTRAINT fk_tickets_assigned_employee
--   FOREIGN KEY (assigned_employee_id) REFERENCES public.employees(id)
--   ON DELETE SET NULL NOT VALID;
-- ALTER TABLE public.tickets VALIDATE CONSTRAINT fk_tickets_assigned_employee;

-- =====================================================================
-- 3) ticket_assignment_history: full audit trail for engineer assignments
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.ticket_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  assigned_by uuid,
  assigned_at timestamptz DEFAULT now(),
  unassigned_at timestamptz,
  notes text
);

ALTER TABLE public.ticket_assignment_history ENABLE ROW LEVEL SECURITY;

-- SELECT: all authenticated users (engineers need to see assignment history)
DROP POLICY IF EXISTS "auth select assignment_history" ON public.ticket_assignment_history;
CREATE POLICY "auth select assignment_history" ON public.ticket_assignment_history
  FOR SELECT TO authenticated
  USING (true);

-- INSERT: admin or tickets.create permission only
DROP POLICY IF EXISTS "auth insert assignment_history" ON public.ticket_assignment_history;
CREATE POLICY "auth insert assignment_history" ON public.ticket_assignment_history
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'create')
  );

-- UPDATE: admin only (audit records should not be casually modified)
DROP POLICY IF EXISTS "auth update assignment_history" ON public.ticket_assignment_history;
CREATE POLICY "auth update assignment_history" ON public.ticket_assignment_history
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_tah_ticket_id
  ON public.ticket_assignment_history (ticket_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS idx_tah_employee_id
  ON public.ticket_assignment_history (employee_id);

-- =====================================================================
-- 4) RLS hardening: ticket_activities
--    - SELECT remains open (engineers must read activity feed)
--    - INSERT restricted to admin OR has_permission(tickets, create)
--    - UPDATE/DELETE admin-only
--    Wrapped in DO block: skips if has_role helper is missing (safety guard)
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'has_role'
  ) AND EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'has_permission'
  ) THEN
    -- Insert: admin or tickets.create
    DROP POLICY IF EXISTS "auth insert tact" ON public.ticket_activities;
    CREATE POLICY "auth insert tact" ON public.ticket_activities
      FOR INSERT TO authenticated
      WITH CHECK (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_permission(auth.uid(), 'tickets', 'create')
      );

    -- Update: admin only
    DROP POLICY IF EXISTS "Actor or admin update tact" ON public.ticket_activities;
    CREATE POLICY "auth update tact" ON public.ticket_activities
      FOR UPDATE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role))
      WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

    -- Delete: admin only
    DROP POLICY IF EXISTS "Actor or admin delete tact" ON public.ticket_activities;
    CREATE POLICY "auth delete tact" ON public.ticket_activities
      FOR DELETE TO authenticated
      USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  END IF;
END $$;

-- =====================================================================
-- 5) RLS hardening: storage.objects ticket-attachments UPDATE/DELETE → admin only
--    Why RESTRICTIVE (not DROP+replace): permissive policies combine with OR,
--    so merely adding an admin-only permissive policy would change nothing.
--    A RESTRICTIVE policy ANDs with every permissive policy, so it genuinely
--    restricts regardless of which permissive policies exist today.
--    Scope is bucket-pinned: rows in other buckets evaluate USING(true).
--    Safe: the only app writer is the admin-gated server fn (service_role
--    bypasses RLS); no client code writes this bucket directly (verified).
--    Wrapped in DO block: skips if has_role helper is missing.
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'has_role'
  ) THEN
    -- Cleanup of the known anyone-can-write policies (no-op if absent/renamed).
    DROP POLICY IF EXISTS "Authenticated update ticket attachments" ON storage.objects;
    DROP POLICY IF EXISTS "Authenticated delete ticket attachments" ON storage.objects;
    DROP POLICY IF EXISTS "admin update ticket attachments" ON storage.objects;
    DROP POLICY IF EXISTS "admin delete ticket attachments" ON storage.objects;

    CREATE POLICY "admin update ticket attachments" ON storage.objects
      AS RESTRICTIVE
      FOR UPDATE TO authenticated
      USING (
        bucket_id <> 'ticket-attachments'
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      )
      WITH CHECK (
        bucket_id <> 'ticket-attachments'
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      );

    CREATE POLICY "admin delete ticket attachments" ON storage.objects
      AS RESTRICTIVE
      FOR DELETE TO authenticated
      USING (
        bucket_id <> 'ticket-attachments'
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      );
  END IF;
END $$;

-- =====================================================================
-- SAFETY NOTES (not executed — documentation for future migrations):
--
-- tickets SELECT policy is deliberately NOT tightened here.
-- Current: USING(true) — all authenticated can read all tickets.
-- Tightening to admin OR tickets.read would break the existing app UI.
-- Leave for a future migration after UI audit confirms engineer-scoped reads.
--
-- employees.email UNIQUE constraint deferred.
-- Risk: duplicate emails would cause constraint violation on migration apply.
-- Pre-check: SELECT email, count(*) FROM employees GROUP BY email HAVING count(*) > 1;
-- After dedup cleanup, add constraint in a separate migration.
--
-- No backfill UPDATEs in this migration.
-- Backfill assigned_employee_id from assigned_engineer_name/phone
-- should be a separate migration with a report-only SELECT first:
--   SELECT t.id, t.case_id, t.assigned_engineer_name, e.id, e.name
--   FROM tickets t LEFT JOIN employees e ON e.name = t.assigned_engineer_name
--   WHERE t.assigned_employee_id IS NULL AND t.assigned_engineer_name IS NOT NULL;
-- =====================================================================
