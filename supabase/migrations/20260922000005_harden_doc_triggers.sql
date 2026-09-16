-- Migration: 20260922000005_harden_doc_triggers.sql
-- Harden document triggers without changing their business semantics.
--
-- 1) tickets_clear_grn/dc_on_cancel(): add SECURITY DEFINER + SET search_path.
--    These run a side-effect UPDATE on public.tickets. As plain plpgsql they
--    execute as the caller under tickets RLS, so a GRN/DC cancel issued by a
--    caller without tickets.edit fails the WHOLE cancel (stock reversal
--    included) on an RLS violation. The definer makes the side-effect run as
--    the function owner, so cancels succeed regardless of caller.
--    RESIDUAL (deliberate, documented): the clear matches every ticket stamp
--    equal to the cancelled doc number. Narrowing it (e.g. UNIQUE on the
--    stamp columns) could block legitimate multi-ticket documents, which is
--    worse than clearing a re-generable label on an explicit admin cancel.
--    A proper grn_id/dc_id FK link is future work, not this migration.
--
-- 2) Custody INSERT siblings: trg_ims_stamp_custodian_dc and
--    trg_ims_clear_custodian_grn are AFTER UPDATE triggers whose WHEN clause
--    contains a dead `TG_OP = 'INSERT'` disjunct (TG_OP is always 'UPDATE'
--    there), so documents created DIRECTLY as Submitted never stamp/clear
--    custody. The new AFTER INSERT siblings close that gap. No double-fire:
--    the UPDATE triggers only fire on a status TRANSITION into Submitted.
--
-- SAFE: additive only, idempotent (CREATE OR REPLACE + DROP TRIGGER IF EXISTS
-- + CREATE, all guarded by information_schema checks). Zero destructive
-- statements; no existing rows touched.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN.

-- =====================================================================
-- 1) Cancel-unlink functions: SECURITY DEFINER + locked search_path
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tickets_clear_grn_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Cancelled' AND NEW.grn_no IS NOT NULL AND NEW.grn_no <> '' THEN
    UPDATE public.tickets
    SET grn_no = NULL
    WHERE grn_no = NEW.grn_no;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tickets_clear_dc_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Cancelled' AND NEW.challan_no IS NOT NULL AND NEW.challan_no <> '' THEN
    UPDATE public.tickets
    SET dc_no = NULL
    WHERE dc_no = NEW.challan_no;
  END IF;
  RETURN NEW;
END;
$$;

-- Triggers themselves are unchanged (DROP+CREATE keeps them idempotent).
DO $$ BEGIN
  IF to_regclass('public.grns') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_tickets_clear_grn_on_cancel ON public.grns;
    CREATE TRIGGER trg_tickets_clear_grn_on_cancel
      AFTER UPDATE OF status ON public.grns
      FOR EACH ROW
      WHEN (NEW.status = 'Cancelled')
      EXECUTE FUNCTION public.tickets_clear_grn_on_cancel();
  END IF;
  IF to_regclass('public.delivery_challans') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_tickets_clear_dc_on_cancel ON public.delivery_challans;
    CREATE TRIGGER trg_tickets_clear_dc_on_cancel
      AFTER UPDATE OF status ON public.delivery_challans
      FOR EACH ROW
      WHEN (NEW.status = 'Cancelled')
      EXECUTE FUNCTION public.tickets_clear_dc_on_cancel();
  END IF;
END $$;

-- =====================================================================
-- 2a) DC custody: AFTER INSERT sibling (direct-Submitted dispatches)
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'delivery_challans'
      AND column_name = 'carrier_employee_id'
  ) AND EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'ims_stamp_custodian_on_dc_dispatch'
  ) THEN
    DROP TRIGGER IF EXISTS trg_ims_stamp_custodian_dc_ins ON public.delivery_challans;
    CREATE TRIGGER trg_ims_stamp_custodian_dc_ins
      AFTER INSERT ON public.delivery_challans
      FOR EACH ROW
      WHEN (NEW.status = 'Submitted'
            AND NEW.carrier_employee_id IS NOT NULL)
      EXECUTE FUNCTION public.ims_stamp_custodian_on_dc_dispatch();
  ELSE
    RAISE NOTICE 'Migration 20260922000005: DC INSERT custody sibling NOT created (carrier_employee_id missing)';
  END IF;
END $$;

-- =====================================================================
-- 2b) GRN custody: AFTER INSERT sibling (direct-Submitted receipts)
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'grns'
      AND column_name = 'carrier_employee_id'
  ) AND EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'ims_clear_custodian_on_grn_receipt'
  ) THEN
    DROP TRIGGER IF EXISTS trg_ims_clear_custodian_grn_ins ON public.grns;
    CREATE TRIGGER trg_ims_clear_custodian_grn_ins
      AFTER INSERT ON public.grns
      FOR EACH ROW
      WHEN (NEW.status = 'Submitted')
      EXECUTE FUNCTION public.ims_clear_custodian_on_grn_receipt();
  ELSE
    RAISE NOTICE 'Migration 20260922000005: GRN INSERT custody sibling NOT created (carrier_employee_id missing)';
  END IF;
END $$;
