-- Migration: 20260923000001_backfill_assignee_links.sql
--
-- CONTEXT: 20260922000007 added fk_tickets_assigned_employee NOT VALID and left
-- it unvalidated while orphan links exist; 20260922000004 scopes Engineer-role
-- holders via a two-leg assignment check (assigned_employee_id FK match first,
-- assigned_engineer_name exact-match fallback second). Rows that still carry
-- only the legacy text leg keep the fallback alive, so this migration backfills
-- the FK leg wherever the text leg resolves unambiguously, then re-attempts
-- VALIDATE of fk_tickets_assigned_employee. The backfill report NOTICE is the
-- A5 gate diagnostic (R1): the name-fallback removal ships only when the
-- unmatched/ambiguous counts are zero (or the user signs off on the residue).
--
-- SAFE: additive only, idempotent (guarded DO blocks; the UPDATE's WHERE clause
-- matches only still-unlinked rows, so re-runs touch zero rows). Ambiguous
-- names are NEVER guessed — a ticket is linked only when exactly ONE employees
-- row carries that exact name. Orphan-scan-then-VALIDATE never fails the push:
-- the constraint validates only when clean, otherwise a NOTICE prints the
-- exact report query. No RLS involved (plain UPDATE + SELECT only).
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN.

-- =====================================================================
-- 1) Backfill tickets.assigned_employee_id from assigned_engineer_name
--    (exact match, uniqueness-guarded, idempotent)
-- =====================================================================
DO $$ DECLARE
  v_backfilled integer := 0;
  v_unmatched  integer := 0;
  v_ambiguous  integer := 0;
BEGIN
  IF to_regclass('public.tickets') IS NULL
     OR to_regclass('public.employees') IS NULL THEN
    RAISE NOTICE 'backfill_assignee_links: public.tickets or public.employees missing — skipping';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'assigned_employee_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'assigned_engineer_name'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'name'
  ) THEN
    RAISE NOTICE 'backfill_assignee_links: required columns (tickets.assigned_employee_id / tickets.assigned_engineer_name / employees.name) missing — skipping';
    RETURN;
  END IF;

  -- Link only where the name resolves to EXACTLY one employee row
  -- (no uuid aggregate exists in PG — the correlated count is the guard).
  -- Idempotent: linked rows have assigned_employee_id IS NOT NULL, so the
  -- WHERE clause excludes them and re-runs touch zero rows.
  UPDATE public.tickets t
  SET assigned_employee_id = e.id
  FROM public.employees e
  WHERE t.assigned_employee_id IS NULL
    AND t.assigned_engineer_name IS NOT NULL
    AND e.name = t.assigned_engineer_name
    AND (SELECT count(*) FROM public.employees e2 WHERE e2.name = e.name) = 1;

  GET DIAGNOSTICS v_backfilled = ROW_COUNT;

  -- Residue, measured on still-unlinked rows (the A5 gate diagnostic).
  SELECT count(*) INTO v_unmatched
  FROM public.tickets t
  WHERE t.assigned_employee_id IS NULL
    AND t.assigned_engineer_name IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.employees e WHERE e.name = t.assigned_engineer_name
    );

  SELECT count(*) INTO v_ambiguous
  FROM public.tickets t
  WHERE t.assigned_employee_id IS NULL
    AND t.assigned_engineer_name IS NOT NULL
    AND (
      SELECT count(*) FROM public.employees e WHERE e.name = t.assigned_engineer_name
    ) > 1;

  RAISE NOTICE 'backfill_assignee_links: backfilled=% unmatched_name=% ambiguous_name=% (ambiguous names never guessed; clean up residue, then re-run — re-runs touch zero rows when clean)', v_backfilled, v_unmatched, v_ambiguous;
END $$;

-- =====================================================================
-- 2) Re-attempt VALIDATE of fk_tickets_assigned_employee
--    (orphan-scan-then-VALIDATE pattern copied from 20260922000007 §1)
-- =====================================================================
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
