-- Migration: 20260916000001_engineer_carrier_identity.sql
-- Add carrier/employee FK columns to delivery documents + sync triggers + module seeds.
-- SAFE: additive only, idempotent (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, ON CONFLICT DO NOTHING).
-- Zero DROP TABLE/COLUMN, zero DELETE/TRUNCATE, zero UPDATE on existing rows.
-- FK constraints added NOT VALID then validated separately (SHARE UPDATE EXCLUSIVE only).

-- =====================================================================
-- 0) GUARD: informational — columns are metadata-only ADD COLUMN IF NOT EXISTS,
--    so missing prior state is harmless. Triggers are conditional on column presence
--    (same pattern as migration 000004_assignment_automation.sql).
-- =====================================================================

-- =====================================================================
-- 1) ADD CARRIER TEXT COLUMNS TO general_delivery_challans (if absent)
--    GDC currently has no driver/transport fields — add them so the sync
--    trigger has text columns to sync to/from.
-- =====================================================================
ALTER TABLE public.general_delivery_challans
  ADD COLUMN IF NOT EXISTS driver_name TEXT,
  ADD COLUMN IF NOT EXISTS driver_mobile TEXT;

-- =====================================================================
-- 2) ADD FK COLUMNS (nullable, no defaults, no backfill)
-- =====================================================================
ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS carrier_employee_id UUID NULL;
COMMENT ON COLUMN public.delivery_challans.carrier_employee_id IS 'FK to employees(id) — driver/transporter identity. Set via sync trigger.';

ALTER TABLE public.general_delivery_challans
  ADD COLUMN IF NOT EXISTS carrier_employee_id UUID NULL;
COMMENT ON COLUMN public.general_delivery_challans.carrier_employee_id IS 'FK to employees(id) — driver/transporter identity. Set via sync trigger.';

ALTER TABLE public.grns
  ADD COLUMN IF NOT EXISTS carrier_employee_id UUID NULL;
COMMENT ON COLUMN public.grns.carrier_employee_id IS 'FK to employees(id) — driver/transporter identity. Set via sync trigger.';

ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS engineer_employee_id UUID NULL;
COMMENT ON COLUMN public.indents.engineer_employee_id IS 'FK to employees(id) — engineer identity. Set via sync trigger.';

-- =====================================================================
-- 3) FK CONSTRAINTS — NOT VALID skips full-table scan; VALIDATE takes only
--    SHARE UPDATE EXCLUSIVE lock (non-blocking). One constraint per table.
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_dc_carrier_employee'
  ) THEN
    ALTER TABLE public.delivery_challans
      ADD CONSTRAINT fk_dc_carrier_employee
      FOREIGN KEY (carrier_employee_id) REFERENCES public.employees(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_gdc_carrier_employee'
  ) THEN
    ALTER TABLE public.general_delivery_challans
      ADD CONSTRAINT fk_gdc_carrier_employee
      FOREIGN KEY (carrier_employee_id) REFERENCES public.employees(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_grn_carrier_employee'
  ) THEN
    ALTER TABLE public.grns
      ADD CONSTRAINT fk_grn_carrier_employee
      FOREIGN KEY (carrier_employee_id) REFERENCES public.employees(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_indent_engineer_employee'
  ) THEN
    ALTER TABLE public.indents
      ADD CONSTRAINT fk_indent_engineer_employee
      FOREIGN KEY (engineer_employee_id) REFERENCES public.employees(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- VALIDATE (non-blocking SHARE UPDATE EXCLUSIVE lock only)
ALTER TABLE public.delivery_challans    VALIDATE CONSTRAINT fk_dc_carrier_employee;
ALTER TABLE public.general_delivery_challans VALIDATE CONSTRAINT fk_gdc_carrier_employee;
ALTER TABLE public.grns                 VALIDATE CONSTRAINT fk_grn_carrier_employee;
ALTER TABLE public.indents              VALIDATE CONSTRAINT fk_indent_engineer_employee;

-- =====================================================================
-- 4) SYNC TRIGGER FUNCTIONS (CREATE OR REPLACE — unconditional, safe)
--    Functions reference columns lazily; won't error if column is missing.
-- =====================================================================

-- 4a) delivery_challans: carrier_employee_id ↔ driver_name/driver_mobile
--     transporter_name is the COMPANY, never overwritten.
CREATE OR REPLACE FUNCTION public.enforce_dc_carrier_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp record;
  norm_phone text;
  match_cnt integer;
BEGIN
  -- Direction A: FK is set → overwrite driver text from employee row
  IF NEW.carrier_employee_id IS NOT NULL THEN
    SELECT name, phone INTO emp
      FROM public.employees WHERE id = NEW.carrier_employee_id;
    IF FOUND THEN
      NEW.driver_name   := emp.name;
      NEW.driver_mobile := emp.phone;
    END IF;
    RETURN NEW;
  END IF;

  -- Direction B: FK is NULL but driver text changed → resolve FK from text
  IF NEW.driver_name IS DISTINCT FROM OLD.driver_name
     OR NEW.driver_mobile IS DISTINCT FROM OLD.driver_mobile THEN

    -- Phone-first: digit-normalized unique active match
    IF NEW.driver_mobile IS NOT NULL AND btrim(NEW.driver_mobile) <> '' THEN
      norm_phone := regexp_replace(NEW.driver_mobile, '\D', '', 'g');
      IF norm_phone <> '' THEN
        SELECT count(*) INTO match_cnt
          FROM public.employees
         WHERE active = true
           AND phone IS NOT NULL AND phone <> ''
           AND regexp_replace(phone, '\D', '', 'g') = norm_phone;
        IF match_cnt = 1 THEN
          SELECT id INTO NEW.carrier_employee_id
            FROM public.employees
           WHERE active = true
             AND phone IS NOT NULL AND phone <> ''
             AND regexp_replace(phone, '\D', '', 'g') = norm_phone
           LIMIT 1;
        END IF;
      END IF;
    END IF;

    -- Name fallback: unique active name match
    IF NEW.carrier_employee_id IS NULL
       AND NEW.driver_name IS NOT NULL AND btrim(NEW.driver_name) <> '' THEN
      SELECT id INTO NEW.carrier_employee_id
        FROM public.employees
       WHERE active = true
         AND lower(trim(name)) = lower(trim(NEW.driver_name))
       LIMIT 1;
      IF NEW.carrier_employee_id IS NOT NULL THEN
        IF (SELECT count(*) FROM public.employees
             WHERE active = true
               AND lower(trim(name)) = lower(trim(NEW.driver_name))) > 1 THEN
          NEW.carrier_employee_id := NULL;  -- ambiguous
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4b) general_delivery_challans: same pattern as DC
CREATE OR REPLACE FUNCTION public.enforce_gdc_carrier_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp record;
  norm_phone text;
  match_cnt integer;
BEGIN
  IF NEW.carrier_employee_id IS NOT NULL THEN
    SELECT name, phone INTO emp
      FROM public.employees WHERE id = NEW.carrier_employee_id;
    IF FOUND THEN
      NEW.driver_name   := emp.name;
      NEW.driver_mobile := emp.phone;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.driver_name IS DISTINCT FROM OLD.driver_name
     OR NEW.driver_mobile IS DISTINCT FROM OLD.driver_mobile THEN

    IF NEW.driver_mobile IS NOT NULL AND btrim(NEW.driver_mobile) <> '' THEN
      norm_phone := regexp_replace(NEW.driver_mobile, '\D', '', 'g');
      IF norm_phone <> '' THEN
        SELECT count(*) INTO match_cnt
          FROM public.employees
         WHERE active = true
           AND phone IS NOT NULL AND phone <> ''
           AND regexp_replace(phone, '\D', '', 'g') = norm_phone;
        IF match_cnt = 1 THEN
          SELECT id INTO NEW.carrier_employee_id
            FROM public.employees
           WHERE active = true
             AND phone IS NOT NULL AND phone <> ''
             AND regexp_replace(phone, '\D', '', 'g') = norm_phone
           LIMIT 1;
        END IF;
      END IF;
    END IF;

    IF NEW.carrier_employee_id IS NULL
       AND NEW.driver_name IS NOT NULL AND btrim(NEW.driver_name) <> '' THEN
      SELECT id INTO NEW.carrier_employee_id
        FROM public.employees
       WHERE active = true
         AND lower(trim(name)) = lower(trim(NEW.driver_name))
       LIMIT 1;
      IF NEW.carrier_employee_id IS NOT NULL THEN
        IF (SELECT count(*) FROM public.employees
             WHERE active = true
               AND lower(trim(name)) = lower(trim(NEW.driver_name))) > 1 THEN
          NEW.carrier_employee_id := NULL;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4c) grns: carrier_employee_id ↔ driver_name/driver_mobile
--     transporter_name is the company, never touched.
--     source_name/source_contact_number are the PARTY, not the driver.
CREATE OR REPLACE FUNCTION public.enforce_grn_carrier_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp record;
  norm_phone text;
  match_cnt integer;
BEGIN
  IF NEW.carrier_employee_id IS NOT NULL THEN
    SELECT name, phone INTO emp
      FROM public.employees WHERE id = NEW.carrier_employee_id;
    IF FOUND THEN
      NEW.driver_name   := emp.name;
      NEW.driver_mobile := emp.phone;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.driver_name IS DISTINCT FROM OLD.driver_name
     OR NEW.driver_mobile IS DISTINCT FROM OLD.driver_mobile THEN

    IF NEW.driver_mobile IS NOT NULL AND btrim(NEW.driver_mobile) <> '' THEN
      norm_phone := regexp_replace(NEW.driver_mobile, '\D', '', 'g');
      IF norm_phone <> '' THEN
        SELECT count(*) INTO match_cnt
          FROM public.employees
         WHERE active = true
           AND phone IS NOT NULL AND phone <> ''
           AND regexp_replace(phone, '\D', '', 'g') = norm_phone;
        IF match_cnt = 1 THEN
          SELECT id INTO NEW.carrier_employee_id
            FROM public.employees
           WHERE active = true
             AND phone IS NOT NULL AND phone <> ''
             AND regexp_replace(phone, '\D', '', 'g') = norm_phone
           LIMIT 1;
        END IF;
      END IF;
    END IF;

    IF NEW.carrier_employee_id IS NULL
       AND NEW.driver_name IS NOT NULL AND btrim(NEW.driver_name) <> '' THEN
      SELECT id INTO NEW.carrier_employee_id
        FROM public.employees
       WHERE active = true
         AND lower(trim(name)) = lower(trim(NEW.driver_name))
       LIMIT 1;
      IF NEW.carrier_employee_id IS NOT NULL THEN
        IF (SELECT count(*) FROM public.employees
             WHERE active = true
               AND lower(trim(name)) = lower(trim(NEW.driver_name))) > 1 THEN
          NEW.carrier_employee_id := NULL;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 4d) indents: engineer_employee_id ↔ engineer_name (no phone on indents)
CREATE OR REPLACE FUNCTION public.enforce_indent_engineer_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp record;
BEGIN
  -- Direction A: FK is set → overwrite engineer_name from employee row
  IF NEW.engineer_employee_id IS NOT NULL THEN
    SELECT name INTO emp
      FROM public.employees WHERE id = NEW.engineer_employee_id;
    IF FOUND THEN
      NEW.engineer_name := emp.name;
    END IF;
    RETURN NEW;
  END IF;

  -- Direction B: FK is NULL but engineer_name changed → resolve FK
  IF NEW.engineer_name IS DISTINCT FROM OLD.engineer_name THEN
    IF NEW.engineer_name IS NOT NULL AND btrim(NEW.engineer_name) <> '' THEN
      SELECT id INTO NEW.engineer_employee_id
        FROM public.employees
       WHERE active = true
         AND lower(trim(name)) = lower(trim(NEW.engineer_name))
       LIMIT 1;
      IF NEW.engineer_employee_id IS NOT NULL THEN
        IF (SELECT count(*) FROM public.employees
             WHERE active = true
               AND lower(trim(name)) = lower(trim(NEW.engineer_name))) > 1 THEN
          NEW.engineer_employee_id := NULL;  -- ambiguous → NULL
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- =====================================================================
-- 5) CONDITIONAL TRIGGER CREATION (same guard pattern as migration 0004)
--    Functions are unconditional; triggers require column presence.
-- =====================================================================

-- 5a) delivery_challans
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'delivery_challans' AND column_name = 'carrier_employee_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_enforce_dc_carrier_sync ON public.delivery_challans;
    CREATE TRIGGER trg_enforce_dc_carrier_sync
      BEFORE INSERT OR UPDATE ON public.delivery_challans
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_dc_carrier_sync();
  ELSE
    RAISE NOTICE 'Migration 20260916000001: DC sync trigger NOT created (carrier_employee_id missing)';
  END IF;
END $$;

-- 5b) general_delivery_challans
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'general_delivery_challans' AND column_name = 'carrier_employee_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_enforce_gdc_carrier_sync ON public.general_delivery_challans;
    CREATE TRIGGER trg_enforce_gdc_carrier_sync
      BEFORE INSERT OR UPDATE ON public.general_delivery_challans
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_gdc_carrier_sync();
  ELSE
    RAISE NOTICE 'Migration 20260916000001: GDC sync trigger NOT created (carrier_employee_id missing)';
  END IF;
END $$;

-- 5c) grns
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'grns' AND column_name = 'carrier_employee_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_enforce_grn_carrier_sync ON public.grns;
    CREATE TRIGGER trg_enforce_grn_carrier_sync
      BEFORE INSERT OR UPDATE ON public.grns
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_grn_carrier_sync();
  ELSE
    RAISE NOTICE 'Migration 20260916000001: GRN sync trigger NOT created (carrier_employee_id missing)';
  END IF;
END $$;

-- 5d) indents
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'indents' AND column_name = 'engineer_employee_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_enforce_indent_engineer_sync ON public.indents;
    CREATE TRIGGER trg_enforce_indent_engineer_sync
      BEFORE INSERT OR UPDATE ON public.indents
      FOR EACH ROW
      EXECUTE FUNCTION public.enforce_indent_engineer_sync();
  ELSE
    RAISE NOTICE 'Migration 20260916000001: indent sync trigger NOT created (engineer_employee_id missing)';
  END IF;
END $$;

-- =====================================================================
-- 6) SEEDS: app_modules for future surfaces (ON CONFLICT DO NOTHING)
--    app_modules columns: key (PK), label, sort_order, supports_import, is_active
--    No role_module_permissions rows yet → has_permission stays fail-closed.
-- =====================================================================
INSERT INTO public.app_modules (key, label, sort_order, supports_import, is_active)
VALUES ('engineer_parts', 'Engineer Parts', 90, false, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_modules (key, label, sort_order, supports_import, is_active)
VALUES ('engineer_docs', 'Engineer Documents', 95, false, true)
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- 7) INDEXES (brief lock — acceptable per table size)
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_dc_carrier_employee ON public.delivery_challans(carrier_employee_id);
CREATE INDEX IF NOT EXISTS idx_gdc_carrier_employee ON public.general_delivery_challans(carrier_employee_id);
CREATE INDEX IF NOT EXISTS idx_grn_carrier_employee ON public.grns(carrier_employee_id);
CREATE INDEX IF NOT EXISTS idx_indent_engineer_employee ON public.indents(engineer_employee_id);

-- =====================================================================
-- 8) BACKFILL: NO automatic row UPDATEs. Report-only for admin cleanup.
--    Run these manually to identify unmatched carriers:
--
--    -- Unmatched DC carriers (driver text exists but no FK):
--    SELECT dc.challan_no, dc.driver_name, dc.driver_mobile
--      FROM public.delivery_challans dc
--     WHERE dc.carrier_employee_id IS NULL
--       AND (dc.driver_name IS NOT NULL AND btrim(dc.driver_name) <> '');
--
--    -- Ambiguous DC carriers (multiple active employees match name):
--    SELECT dc.challan_no, dc.driver_name,
--           count(*) as match_count
--      FROM public.delivery_challans dc
--      JOIN public.employees e ON e.active = true
--        AND lower(trim(e.name)) = lower(trim(dc.driver_name))
--     WHERE dc.carrier_employee_id IS NULL
--     GROUP BY dc.challan_no, dc.driver_name
--    HAVING count(*) > 1;
--
--    -- Same pattern for GRNs (replace delivery_challans with grns)
--    -- Same pattern for GDC (replace delivery_challans with general_delivery_challans)
--
--    -- Unmatched indent engineers:
--    SELECT i.indent_no, i.engineer_name
--      FROM public.indents i
--     WHERE i.engineer_employee_id IS NULL
--       AND (i.engineer_name IS NOT NULL AND btrim(i.engineer_name) <> '');
--
--    -- Ambiguous indent engineers:
--    SELECT i.indent_no, i.engineer_name, count(*) as match_count
--      FROM public.indents i
--      JOIN public.employees e ON e.active = true
--        AND lower(trim(e.name)) = lower(trim(i.engineer_name))
--     WHERE i.engineer_employee_id IS NULL
--     GROUP BY i.indent_no, i.engineer_name
--    HAVING count(*) > 1;
-- =====================================================================

-- =====================================================================
-- NOTES
-- =====================================================================
-- Trigger order: BEFORE triggers fire in alphabetical name order.
--   Existing BEFORE triggers on these tables (dc_touch_updated, trg_gdc_touch,
--   trg_validate_indent_oem, etc.) coexist — ours runs alongside them.
--
-- Direction B uses count-then-pick (no min(uuid)/max(uuid)).
--   0 matches → FK stays NULL (text is king).
--   1 match  → FK set.
--   2+ match → ambiguous → FK stays NULL (safe default).
--
-- FK constraints are NOT VALID initially → no table scan.
-- VALIDATE CONSTRAINT takes only SHARE UPDATE EXCLUSIVE (non-blocking).
--
-- Rollback:
--   DROP TRIGGER trg_enforce_dc_carrier_sync ON public.delivery_challans;
--   DROP TRIGGER trg_enforce_gdc_carrier_sync ON public.general_delivery_challans;
--   DROP TRIGGER trg_enforce_grn_carrier_sync ON public.grns;
--   DROP TRIGGER trg_enforce_indent_engineer_sync ON public.indents;
--   DROP FUNCTION public.enforce_dc_carrier_sync();
--   DROP FUNCTION public.enforce_gdc_carrier_sync();
--   DROP FUNCTION public.enforce_grn_carrier_sync();
--   DROP FUNCTION public.enforce_indent_engineer_sync();
--   ALTER TABLE public.delivery_challans DROP CONSTRAINT fk_dc_carrier_employee;
--   ALTER TABLE public.general_delivery_challans DROP CONSTRAINT fk_gdc_carrier_employee;
--   ALTER TABLE public.grns DROP CONSTRAINT fk_grn_carrier_employee;
--   ALTER TABLE public.indents DROP CONSTRAINT fk_indent_engineer_employee;
--   ALTER TABLE public.delivery_challans DROP COLUMN carrier_employee_id;
--   ALTER TABLE public.general_delivery_challans DROP COLUMN carrier_employee_id;
--   ALTER TABLE public.general_delivery_challans DROP COLUMN driver_name;
--   ALTER TABLE public.general_delivery_challans DROP COLUMN driver_mobile;
--   ALTER TABLE public.grns DROP COLUMN carrier_employee_id;
--   ALTER TABLE public.indents DROP COLUMN engineer_employee_id;
--   DELETE FROM public.app_modules WHERE key IN ('engineer_parts','engineer_docs');
