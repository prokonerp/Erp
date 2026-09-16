-- Migration: 20260922000007_integrity_constraints.sql
-- Foreign keys + range CHECKs the engineer series deferred, added the safe way.
--
-- CONTEXT: assigned_employee_id, assignment_history.assigned_by, and
-- employees.auth_user_id were added as bare uuid columns (backfill-first by
-- design); visits/departure and odometer ranges were never bounded. This
-- migration adds the constraints WITHOUT blocking on legacy data:
--   * every constraint is created NOT VALID (new writes enforced at once,
--     existing rows untouched, no long table locks);
--   * VALIDATE runs only when a violation scan comes back clean;
--   * otherwise the constraint stays NOT VALID and a NOTICE prints the exact
--     report query, so the push never fails and cleanup is a data task, not
--     a migration incident.
--
-- SAFE: additive only, idempotent (pg_constraint guards; re-runs are no-ops).
-- Zero destructive statements; no rows read for update, none deleted.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN / UPDATE.

-- =====================================================================
-- 1) tickets.assigned_employee_id -> employees(id), orphan links null out
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.tickets') IS NOT NULL
     AND to_regclass('public.employees') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_assigned_employee') THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT fk_tickets_assigned_employee
      FOREIGN KEY (assigned_employee_id) REFERENCES public.employees(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_assigned_employee' AND NOT convalidated)
     AND to_regclass('public.tickets') IS NOT NULL
     AND to_regclass('public.employees') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tickets t
      LEFT JOIN public.employees e ON e.id = t.assigned_employee_id
      WHERE t.assigned_employee_id IS NOT NULL AND e.id IS NULL
    ) THEN
      ALTER TABLE public.tickets VALIDATE CONSTRAINT fk_tickets_assigned_employee;
    ELSE
      RAISE NOTICE 'fk_tickets_assigned_employee left NOT VALID: orphan links exist. Report: SELECT t.id FROM public.tickets t LEFT JOIN public.employees e ON e.id = t.assigned_employee_id WHERE t.assigned_employee_id IS NOT NULL AND e.id IS NULL;';
    END IF;
  END IF;
END $$;

-- =====================================================================
-- 2) ticket_assignment_history.assigned_by -> auth.users(id), null on delete
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.ticket_assignment_history') IS NOT NULL
     AND to_regclass('auth.users') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tah_assigned_by') THEN
    ALTER TABLE public.ticket_assignment_history
      ADD CONSTRAINT fk_tah_assigned_by
      FOREIGN KEY (assigned_by) REFERENCES auth.users(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tah_assigned_by' AND NOT convalidated)
     AND to_regclass('public.ticket_assignment_history') IS NOT NULL
     AND to_regclass('auth.users') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ticket_assignment_history h
      LEFT JOIN auth.users u ON u.id = h.assigned_by
      WHERE h.assigned_by IS NOT NULL AND u.id IS NULL
    ) THEN
      ALTER TABLE public.ticket_assignment_history VALIDATE CONSTRAINT fk_tah_assigned_by;
    ELSE
      RAISE NOTICE 'fk_tah_assigned_by left NOT VALID: orphan links exist. Report: SELECT h.id FROM public.ticket_assignment_history h LEFT JOIN auth.users u ON u.id = h.assigned_by WHERE h.assigned_by IS NOT NULL AND u.id IS NULL;';
    END IF;
  END IF;
END $$;

-- =====================================================================
-- 3) employees.auth_user_id -> auth.users(id), null on delete (identity link)
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.employees') IS NOT NULL
     AND to_regclass('auth.users') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_employees_auth_user') THEN
    ALTER TABLE public.employees
      ADD CONSTRAINT fk_employees_auth_user
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_employees_auth_user' AND NOT convalidated)
     AND to_regclass('public.employees') IS NOT NULL
     AND to_regclass('auth.users') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.employees e
      LEFT JOIN auth.users u ON u.id = e.auth_user_id
      WHERE e.auth_user_id IS NOT NULL AND u.id IS NULL
    ) THEN
      ALTER TABLE public.employees VALIDATE CONSTRAINT fk_employees_auth_user;
    ELSE
      RAISE NOTICE 'fk_employees_auth_user left NOT VALID: orphan links exist. Report: SELECT e.id FROM public.employees e LEFT JOIN auth.users u ON u.id = e.auth_user_id WHERE e.auth_user_id IS NOT NULL AND u.id IS NULL;';
    END IF;
  END IF;
END $$;

-- =====================================================================
-- 4) ticket_visits: departure must not precede arrival (NULLs allowed)
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.ticket_visits') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ticket_visits_departure_after_arrival') THEN
    ALTER TABLE public.ticket_visits
      ADD CONSTRAINT chk_ticket_visits_departure_after_arrival
      CHECK (departure_at IS NULL OR arrival_at IS NULL OR departure_at >= arrival_at)
      NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ticket_visits_departure_after_arrival' AND NOT convalidated)
     AND to_regclass('public.ticket_visits') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ticket_visits
      WHERE departure_at IS NOT NULL AND arrival_at IS NOT NULL AND departure_at < arrival_at
    ) THEN
      ALTER TABLE public.ticket_visits VALIDATE CONSTRAINT chk_ticket_visits_departure_after_arrival;
    ELSE
      RAISE NOTICE 'chk_ticket_visits_departure_after_arrival left NOT VALID: inverted rows exist. Report: SELECT id FROM public.ticket_visits WHERE departure_at IS NOT NULL AND arrival_at IS NOT NULL AND departure_at < arrival_at;';
    END IF;
  END IF;
END $$;

-- =====================================================================
-- 5) ticket_assignment_history: assigned_at required, unassign after assign
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.ticket_assignment_history') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tah_time_order') THEN
    ALTER TABLE public.ticket_assignment_history
      ADD CONSTRAINT chk_tah_time_order
      CHECK (assigned_at IS NOT NULL AND (unassigned_at IS NULL OR unassigned_at >= assigned_at))
      NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tah_time_order' AND NOT convalidated)
     AND to_regclass('public.ticket_assignment_history') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ticket_assignment_history
      WHERE assigned_at IS NULL OR (unassigned_at IS NOT NULL AND unassigned_at < assigned_at)
    ) THEN
      ALTER TABLE public.ticket_assignment_history VALIDATE CONSTRAINT chk_tah_time_order;
    ELSE
      RAISE NOTICE 'chk_tah_time_order left NOT VALID: bad rows exist. Report: SELECT id FROM public.ticket_assignment_history WHERE assigned_at IS NULL OR (unassigned_at IS NOT NULL AND unassigned_at < assigned_at);';
    END IF;
  END IF;
END $$;

-- =====================================================================
-- 6) engineer_daily_logs: odometers must be non-negative (NULLs allowed)
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.engineer_daily_logs') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_daily_logs_odometer_nonneg') THEN
    ALTER TABLE public.engineer_daily_logs
      ADD CONSTRAINT chk_daily_logs_odometer_nonneg
      CHECK (
        (morning_odometer IS NULL OR morning_odometer >= 0)
        AND (evening_odometer IS NULL OR evening_odometer >= 0)
      )
      NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_daily_logs_odometer_nonneg' AND NOT convalidated)
     AND to_regclass('public.engineer_daily_logs') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.engineer_daily_logs
      WHERE (morning_odometer IS NOT NULL AND morning_odometer < 0)
         OR (evening_odometer IS NOT NULL AND evening_odometer < 0)
    ) THEN
      ALTER TABLE public.engineer_daily_logs VALIDATE CONSTRAINT chk_daily_logs_odometer_nonneg;
    ELSE
      RAISE NOTICE 'chk_daily_logs_odometer_nonneg left NOT VALID: negative readings exist. Report: SELECT id FROM public.engineer_daily_logs WHERE (morning_odometer IS NOT NULL AND morning_odometer < 0) OR (evening_odometer IS NOT NULL AND evening_odometer < 0);';
    END IF;
  END IF;
END $$;
