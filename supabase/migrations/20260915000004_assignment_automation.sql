-- Migration: 20260915000004_assignment_automation.sql
-- Automate ticket assignment sync (FK ↔ text) and history logging at DB level.
-- SAFE: additive only, idempotent (CREATE OR REPLACE, DROP IF EXISTS + CREATE).
-- Zero DROP TABLE/COLUMN, zero DELETE/TRUNCATE. Single UPDATE targets only
-- newly-inserted history rows (empty pre-deploy → zero existing-data impact).

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
BEGIN
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

    -- Try phone first: digit-normalized exact match among active employees
    IF NEW.assigned_engineer_phone IS NOT NULL AND trim(NEW.assigned_engineer_phone) <> '' THEN
      norm_phone := regexp_replace(NEW.assigned_engineer_phone, '\D', '', 'g');
      IF norm_phone <> '' THEN
        SELECT id INTO NEW.assigned_employee_id
          FROM public.employees
         WHERE active = true
           AND regexp_replace(phone, '\D', '', 'g') = norm_phone
         LIMIT 1;
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

DROP TRIGGER IF EXISTS trg_enforce_ticket_assignment_sync ON public.tickets;
CREATE TRIGGER trg_enforce_ticket_assignment_sync
  BEFORE INSERT OR UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ticket_assignment_sync();

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

  -- Fire only when assignment identity actually changes
  IF NEW.assigned_employee_id IS DISTINCT FROM OLD.assigned_employee_id
     OR NEW.assigned_engineer_name IS DISTINCT FROM OLD.assigned_engineer_name
     OR NEW.assigned_engineer_phone IS DISTINCT FROM OLD.assigned_engineer_phone THEN

    -- Close any open history rows for this ticket
    UPDATE public.ticket_assignment_history
       SET unassigned_at = now()
     WHERE ticket_id = NEW.id
       AND unassigned_at IS NULL;

    -- Insert new history row if there is an assignee
    IF NEW.assigned_employee_id IS NOT NULL
       OR (NEW.assigned_engineer_name IS NOT NULL AND trim(NEW.assigned_engineer_name) <> '') THEN
      BEGIN
        INSERT INTO public.ticket_assignment_history
          (ticket_id, employee_id, assigned_by, assigned_at, notes)
        VALUES
          (NEW.id, NEW.assigned_employee_id, auth.uid(), now(), 'auto-logged');
      EXCEPTION WHEN OTHERS THEN
        -- auth.uid() null under service_role → allow NULL assigned_by
        INSERT INTO public.ticket_assignment_history
          (ticket_id, employee_id, assigned_by, assigned_at, notes)
        VALUES
          (NEW.id, NEW.assigned_employee_id, NULL, now(), 'auto-logged');
      END;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_ticket_assignment_history ON public.tickets;
CREATE TRIGGER trg_log_ticket_assignment_history
  AFTER UPDATE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.log_ticket_assignment_history();

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
