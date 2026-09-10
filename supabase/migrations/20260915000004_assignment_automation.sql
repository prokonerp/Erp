-- Migration: 20260915000004_assignment_automation.sql
-- Automate ticket assignment sync (FK ↔ text) and history logging at DB level.
-- SAFE: additive only, idempotent (CREATE OR REPLACE, DROP IF EXISTS + CREATE).
-- Zero DROP TABLE/COLUMN, zero DELETE/TRUNCATE. Single UPDATE targets only
-- newly-inserted history rows (empty pre-deploy → zero existing-data impact).

-- =====================================================================
-- 0) GUARD: triggers are created ONLY if migration 01 has run
--    (assigned_employee_id column present). Creating the triggers without the
--    column would break EVERY ticket write (NEW.assigned_employee_id would
--    raise at fire time), so creation itself is conditional — not just the body.
--    Functions are unconditional (CREATE OR REPLACE validates syntax only;
--    column references resolve lazily at first execution).
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'assigned_employee_id'
  ) THEN
    RAISE NOTICE 'Migration 0004: assigned_employee_id column not found (run 0001 first) — trigger creation skipped, functions only';
  END IF;
END $$;

-- NOTE: The functions below are safe to CREATE OR REPLACE even without the column
-- (they're just definitions — column references resolve at first execution, not
-- creation). The CREATE TRIGGER statements further below are wrapped in a
-- conditional DO block, so a missing column can never break ticket writes.
-- This is standard PostgreSQL behavior and idempotent.

-- =====================================================================
-- 0b) Phone-resolution performance note
--    The text→FK lookup matches on digit-normalized phone via
--    regexp_replace(phone, ...), which a plain btree cannot serve, so no
--    index is added here. The employees table is tiny (admin-managed) and
--    the lookup runs only when assignment text changes — sequential scan
--    cost is negligible. Revisit with an expression index if it ever grows.
-- =====================================================================

-- =====================================================================
-- 1) BEFORE INSERT OR UPDATE: sync assigned_employee_id ↔ text fields
--    Function: enforce_ticket_assignment_sync
--    Authoritative direction: FK → text (overwrite text from employee row).
--    Reverse resolution: text → FK (when text identity changes and FK is NULL).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enforce_ticket_assignment_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp record;
  norm_phone text;
  phone_cnt integer;
  phone_id uuid;BEGIN
  -- Direction A: FK is set → overwrite text fields from employee row (authoritative)
  IF NEW.assigned_employee_id IS NOT NULL THEN
    SELECT name, phone INTO emp
      FROM public.employees WHERE id = NEW.assigned_employee_id;
    IF FOUND THEN
      NEW.assigned_engineer_name := emp.name;
      NEW.assigned_engineer_phone := emp.phone;
    END IF;
    -- If employee row missing, leave text as-is (never null it)
    RETURN NEW;
  END IF;

  -- Direction B: FK is NULL but text identity changed → resolve FK from text
  -- On INSERT, OLD values are NULL; treat that as "changed" if text is non-null
  IF NEW.assigned_engineer_name IS DISTINCT FROM OLD.assigned_engineer_name
     OR NEW.assigned_engineer_phone IS DISTINCT FROM OLD.assigned_engineer_phone THEN

    -- Try phone first: digit-normalized exact match among active employees.
    -- Uniqueness-guarded: 0 or 2+ matches → leave FK NULL (same rule as names).
    IF NEW.assigned_engineer_phone IS NOT NULL AND trim(NEW.assigned_engineer_phone) <> '' THEN
      norm_phone := regexp_replace(NEW.assigned_engineer_phone, '\D', '', 'g');
      IF norm_phone <> '' THEN
        SELECT count(*) INTO phone_cnt
          FROM public.employees
         WHERE active = true
           AND phone IS NOT NULL AND phone <> ''
           AND regexp_replace(phone, '\D', '', 'g') = norm_phone;
        IF phone_cnt = 1 THEN
          SELECT id INTO phone_id
            FROM public.employees
           WHERE active = true
             AND phone IS NOT NULL AND phone <> ''
             AND regexp_replace(phone, '\D', '', 'g') = norm_phone
           LIMIT 1;
          NEW.assigned_employee_id := phone_id;
        END IF;
      END IF;
    END IF;

    -- If phone didn't resolve, try unique name match
    IF NEW.assigned_employee_id IS NULL
       AND NEW.assigned_engineer_name IS NOT NULL
       AND trim(NEW.assigned_engineer_name) <> '' THEN
      SELECT id INTO NEW.assigned_employee_id
        FROM public.employees
       WHERE active = true
         AND lower(trim(name)) = lower(trim(NEW.assigned_engineer_name))
       LIMIT 1;
      -- If 0 or 2+ rows match, LIMIT 1 picks one arbitrarily → guard with uniqueness check
      IF NEW.assigned_employee_id IS NOT NULL THEN
        IF (SELECT count(*) FROM public.employees
             WHERE active = true
               AND lower(trim(name)) = lower(trim(NEW.assigned_engineer_name))) > 1 THEN
          NEW.assigned_employee_id := NULL;  -- ambiguous → leave NULL, eng queue stays FK-safe
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Conditional creation: skipped (with NOTICE) when the FK column is absent,
-- so this file can never break ticket writes on a DB where 01 hasn't run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'assigned_employee_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_enforce_ticket_assignment_sync ON public.tickets;
    CREATE TRIGGER trg_enforce_ticket_assignment_sync
      BEFORE INSERT OR UPDATE ON public.tickets
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_ticket_assignment_sync();
  ELSE
    RAISE NOTICE 'Migration 0004: sync trigger NOT created (assigned_employee_id missing)';
  END IF;
END $$;

-- =====================================================================
-- 2) AFTER UPDATE: log assignment history
--    Function: log_ticket_assignment_history
--    Fires when FK or text identity changes.
--    UPDATE on history table targets only the newly-inserted row (empty pre-deploy).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.log_ticket_assignment_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Guard: skip silently if history table doesn't exist (migration 01 not applied)
  IF to_regclass('public.ticket_assignment_history') IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fire only when assignment identity actually changes.
  -- History logging must NEVER break the primary ticket write: every write
  -- below is wrapped so any failure degrades to a WARNING, never an error.
  IF NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id
     OR NEW.assigned_engineer_name IS DISTINCT FROM OLD.assigned_engineer_name
     OR NEW.assigned_engineer_phone IS DISTINCT FROM OLD.assigned_engineer_phone THEN

    BEGIN
      -- Close any open history rows for this ticket
      UPDATE public.ticket_assignment_history
         SET unassigned_at = now()
       WHERE ticket_id = NEW.id
         AND unassigned_at IS NULL;

      -- Insert new history row if there is an assignee.
      -- auth.uid() is NULL under service_role — column is nullable, no exception needed.
      IF NEW.assigned_employee_id IS NOT NULL
         OR (NEW.assigned_engineer_name IS NOT NULL AND trim(NEW.assigned_engineer_name) <> '') THEN
        INSERT INTO public.ticket_assignment_history
          (ticket_id, employee_id, assigned_by, assigned_at, notes)
        VALUES
          (NEW.id, NEW.assigned_employee_id, auth.uid(), now(), 'auto-logged');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'ticket_assignment_history log skipped for ticket %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NULL;
END;
$$;

-- Conditional creation (same guard as above): a WHEN clause referencing the
-- FK column is validated at CREATE time, so creation must be conditional.
-- The WHEN clause skips the function entirely for non-assignment updates
-- (the hot path: status-only changes pay zero trigger cost).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name = 'assigned_employee_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_log_ticket_assignment_history ON public.tickets;
    EXECUTE
      'CREATE TRIGGER trg_log_ticket_assignment_history
         AFTER UPDATE ON public.tickets
         FOR EACH ROW
         WHEN (OLD.assigned_employee_id IS DISTINCT FROM NEW.assigned_employee_id
            OR OLD.assigned_engineer_name IS DISTINCT FROM NEW.assigned_engineer_name
            OR OLD.assigned_engineer_phone IS DISTINCT FROM NEW.assigned_engineer_phone)
         EXECUTE FUNCTION public.log_ticket_assignment_history()';
  ELSE
    RAISE NOTICE 'Migration 0004: history trigger NOT created (assigned_employee_id missing)';
  END IF;
END $$;

-- =====================================================================
-- NOTES
-- =====================================================================
-- Trigger order: trg_enforce_ticket_assignment_sync fires BEFORE INSERT/UPDATE
--   (runs before row is written). trg_log_ticket_assignment_history fires AFTER UPDATE
--   (runs after row is committed). No interference with existing triggers:
--   - trg_sync_*_employee_* are on employees table (different table entirely).
--   - tickets_touch (BEFORE UPDATE, touch_updated_at) coexists; both BEFORE triggers
--     fire in alphabetical order — ours sets FK/text, touch_updated_at sets updated_at.
--   - tickets_case_id (BEFORE INSERT only) is independent.
--
-- Rollback: DROP TRIGGER trg_enforce_ticket_assignment_sync ON public.tickets;
--           DROP TRIGGER trg_log_ticket_assignment_history ON public.tickets;
--           DROP FUNCTION public.enforce_ticket_assignment_sync();
--           DROP FUNCTION public.log_ticket_assignment_history();
