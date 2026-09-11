-- Migration: 20260916000002_engineer_custody_postings.sql
-- Custody stamping on ims_stock_items — carried-part tracking.
-- Consumes carrier_employee_id columns added by 20260916000001.
-- SAFE: additive only (ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, no DROP/DELETE/TRUNCATE).
-- Zero UPDATE of existing rows outside the new column on newly-posted rows.

-- =====================================================================
-- 1) ADD COLUMN: custodian_employee_id (nullable, no default, no backfill)
-- =====================================================================
ALTER TABLE public.ims_stock_items
  ADD COLUMN IF NOT EXISTS custodian_employee_id UUID NULL;

COMMENT ON COLUMN public.ims_stock_items.custodian_employee_id
  IS 'FK to employees(id) — the carrier/engineer currently custody of this part. Set on dispatch, cleared on receipt.';

-- =====================================================================
-- 2) FK CONSTRAINT — NOT VALID then VALIDATE (non-blocking)
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_ims_stock_custodian_employee'
  ) THEN
    ALTER TABLE public.ims_stock_items
      ADD CONSTRAINT fk_ims_stock_custodian_employee
      FOREIGN KEY (custodian_employee_id) REFERENCES public.employees(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

ALTER TABLE public.ims_stock_items
  VALIDATE CONSTRAINT fk_ims_stock_custodian_employee;

-- =====================================================================
-- 3) INDEX — btree for lookup by custodian
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_ims_stock_custodian
  ON public.ims_stock_items(custodian_employee_id);

-- =====================================================================
-- 4) DC DISPATCH TRIGGER — stamp custodian from carrier_employee_id
--    Fires AFTER the stock-posting UPDATE in dc_post_inventory so the
--    carrier_employee_id (set by BEFORE sync trigger) is resolved.
--    Only stamps rows where custodian IS NULL (idempotent).
--    Carrier-less DCs: carrier_employee_id IS NULL → trigger returns
--    immediately → zero side-effects on existing branches.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ims_stamp_custodian_on_dc_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.carrier_employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.ims_stock_items
     SET custodian_employee_id = NEW.carrier_employee_id
   WHERE transaction_ref = 'DC ' || NEW.challan_no
     AND custodian_employee_id IS NULL;

  RETURN NEW;
END;
$$;

-- Conditional trigger creation (information_schema guard per migration convention)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'delivery_challans'
      AND column_name = 'carrier_employee_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_ims_stamp_custodian_dc ON public.delivery_challans;
    CREATE TRIGGER trg_ims_stamp_custodian_dc
      AFTER UPDATE OF status ON public.delivery_challans
      FOR EACH ROW
      WHEN (NEW.status = 'Submitted'
            AND NEW.carrier_employee_id IS NOT NULL
            AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted'))
      EXECUTE FUNCTION public.ims_stamp_custodian_on_dc_dispatch();
  ELSE
    RAISE NOTICE 'Migration 20260916000002: DC custody trigger NOT created (carrier_employee_id missing)';
  END IF;
END $$;

-- =====================================================================
-- 5) GRN RECEIPT TRIGGER — clear custodian for serial-matched rows
--    Fires AFTER the INSERT/UPSERT in grn_post_inventory.
--    Clears custodian_employee_id (SET NULL) on matching stock rows.
--    Unmatched serials: RAISE WARNING (receipt must never fail).
--    Idempotent: only clears rows where custodian IS NOT NULL.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ims_clear_custodian_on_grn_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it JSONB;
  serial TEXT;
  sr RECORD;
BEGIN
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    -- Expand serials array, fall back to comma-joined serial_no
    IF jsonb_typeof(it->'serials') = 'array' THEN
      FOR serial IN
        SELECT btrim(x) FROM jsonb_array_elements_text(it->'serials') AS x
        WHERE btrim(x) <> ''
      LOOP
        -- Find stock item by serial (any status — item may be issued/available)
        SELECT id INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = serial LIMIT 1;

        IF NOT FOUND THEN
          RAISE WARNING 'GRN %: serial "%" not found in stock items — custodian not cleared',
            NEW.grn_no, serial;
          CONTINUE;
        END IF;

        -- Idempotent: only clear if custodian is set
        UPDATE public.ims_stock_items
           SET custodian_employee_id = NULL
         WHERE id = sr.id
           AND custodian_employee_id IS NOT NULL;
      END LOOP;

    ELSIF NULLIF(btrim(COALESCE(it->>'serial_no','')), '') IS NOT NULL THEN
      serial := btrim(it->>'serial_no');

      SELECT id INTO sr FROM public.ims_stock_items
       WHERE part_serial_no = serial LIMIT 1;

      IF NOT FOUND THEN
        RAISE WARNING 'GRN %: serial "%" not found in stock items — custodian not cleared',
          NEW.grn_no, serial;
        CONTINUE;
      END IF;

      UPDATE public.ims_stock_items
         SET custodian_employee_id = NULL
       WHERE id = sr.id
         AND custodian_employee_id IS NOT NULL;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Conditional trigger creation
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'grns'
      AND column_name = 'carrier_employee_id'
  ) THEN
    DROP TRIGGER IF EXISTS trg_ims_clear_custodian_grn ON public.grns;
    CREATE TRIGGER trg_ims_clear_custodian_grn
      AFTER UPDATE OF status ON public.grns
      FOR EACH ROW
      WHEN (NEW.status = 'Submitted'
            AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted'))
      EXECUTE FUNCTION public.ims_clear_custodian_on_grn_receipt();
  ELSE
    RAISE NOTICE 'Migration 20260916000002: GRN custody trigger NOT created (carrier_employee_id missing)';
  END IF;
END $$;

-- =====================================================================
-- NOTES
-- =====================================================================
-- Trigger order: AFTER triggers fire in alphabetical name order.
--   trg_ims_clear_custodian_grn (GRN) and trg_ims_stamp_custodian_dc (DC)
--   fire AFTER their respective stock-posting triggers (trg_grn_post_inventory,
--   trg_dc_post_inventory). No interaction between them — different tables.
--
-- Carrier-less flows: carrier_employee_id IS NULL on the parent doc →
--   DC trigger returns immediately (no UPDATE issued).
--   GRN trigger always runs (clears custodian regardless of carrier presence).
--
-- Idempotency:
--   DC: stamps only rows where custodian IS NULL → re-submitting does not
--       overwrite an existing custodian.
--   GRN: clears only rows where custodian IS NOT NULL → clearing a NULL
--        custodian is a no-op.
--
-- Unmatched serials on GRN: RAISE WARNING (never ERROR) — receipt must
--   not fail because of custody.
--
-- Rollback:
--   DROP TRIGGER trg_ims_stamp_custodian_dc ON public.delivery_challans;
--   DROP TRIGGER trg_ims_clear_custodian_grn ON public.grns;
--   DROP FUNCTION public.ims_stamp_custodian_on_dc_dispatch();
--   DROP FUNCTION public.ims_clear_custodian_on_grn_receipt();
--   ALTER TABLE public.ims_stock_items DROP CONSTRAINT fk_ims_stock_custodian_employee;
--   DROP INDEX IF EXISTS public.idx_ims_stock_custodian;
--   ALTER TABLE public.ims_stock_items DROP COLUMN custodian_employee_id;
