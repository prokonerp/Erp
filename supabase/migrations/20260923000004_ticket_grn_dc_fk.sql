-- Migration: 20260923000004_ticket_grn_dc_fk.sql
-- Link tickets to their Customer GRN / Customer DC by ID instead of
-- stamp-text equality.
--
-- CONTEXT: 20260918000001 added tickets.grn_no / tickets.dc_no text stamps;
-- 20260918000002 made cancelling a GRN/DC clear the stamp on EVERY ticket
-- carrying that document number; 20260922000005 hardened those triggers
-- (SECURITY DEFINER + locked search_path) and documented the stamp-equality
-- clearing as a deliberate residual ("A proper grn_id/dc_id FK link is future
-- work"). This migration is that future work: tickets.grn_id -> grns(id) and
-- tickets.dc_id -> delivery_challans(id), backfilled from the stamps, with
-- the cancel triggers rewritten to clear by ID.
--
-- BEHAVIOR CHANGE (explicit): previously cancelling a GRN/DC cleared the
-- stamp text on EVERY ticket carrying that document number; now only the
-- FK-linked tickets (grn_id = cancelled GRN id / dc_id = cancelled DC id)
-- have their FK AND legacy stamp cleared. Unlinked tickets that happen to
-- carry the same stamp text are no longer touched.
--
-- SAFE: additive only, idempotent (to_regclass / information_schema /
-- pg_constraint guards; backfills WHERE-guarded so re-runs touch zero rows;
-- DROP TRIGGER IF EXISTS + CREATE). FKs are created NOT VALID and validated
-- only when the orphan scan is clean, else a NOTICE prints the exact report
-- query — the push never fails. No existing rows deleted.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN.

-- =====================================================================
-- 1) tickets.grn_id / tickets.dc_id uuid columns (guards: table + column)
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.tickets') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'tickets'
         AND column_name = 'grn_id'
     ) THEN
    ALTER TABLE public.tickets ADD COLUMN grn_id uuid;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.tickets') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'tickets'
         AND column_name = 'dc_id'
     ) THEN
    ALTER TABLE public.tickets ADD COLUMN dc_id uuid;
  END IF;
END $$;

-- =====================================================================
-- 2) FKs NOT VALID: fk_tickets_grn -> grns(id), fk_tickets_dc ->
--    delivery_challans(id), ON DELETE SET NULL (guard: pg_constraint)
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.tickets') IS NOT NULL
     AND to_regclass('public.grns') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_grn') THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT fk_tickets_grn
      FOREIGN KEY (grn_id) REFERENCES public.grns(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.tickets') IS NOT NULL
     AND to_regclass('public.delivery_challans') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_dc') THEN
    ALTER TABLE public.tickets
      ADD CONSTRAINT fk_tickets_dc
      FOREIGN KEY (dc_id) REFERENCES public.delivery_challans(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- =====================================================================
-- 3) Backfill from the legacy stamps, mirroring the exact joins the
--    current cancel triggers use (tickets.grn_no = grns.grn_no;
--    tickets.dc_no = delivery_challans.challan_no). WHERE-guarded +
--    idempotent: re-runs touch zero rows.
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.tickets') IS NOT NULL
     AND to_regclass('public.grns') IS NOT NULL THEN
    UPDATE public.tickets t
    SET grn_id = g.id
    FROM public.grns g
    WHERE t.grn_id IS NULL
      AND t.grn_no IS NOT NULL
      AND t.grn_no <> ''
      AND g.grn_no = t.grn_no;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.tickets') IS NOT NULL
     AND to_regclass('public.delivery_challans') IS NOT NULL THEN
    UPDATE public.tickets t
    SET dc_id = d.id
    FROM public.delivery_challans d
    WHERE t.dc_id IS NULL
      AND t.dc_no IS NOT NULL
      AND t.dc_no <> ''
      AND d.challan_no = t.dc_no;
  END IF;
END $$;

-- =====================================================================
-- 4) Rewrite the cancel triggers to clear by ID (FK + legacy stamp),
--    keeping SECURITY DEFINER + SET search_path = public + the same
--    trigger names and WHEN (NEW.status = 'Cancelled') clauses.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tickets_clear_grn_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Cancelled' THEN
    UPDATE public.tickets
    SET grn_id = NULL,
        grn_no = NULL
    WHERE grn_id = NEW.id;
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
  IF NEW.status = 'Cancelled' THEN
    UPDATE public.tickets
    SET dc_id = NULL,
        dc_no = NULL
    WHERE dc_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

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
-- 5) Orphan-scan-then-VALIDATE for both new FKs (pattern copied from
--    20260922000007_integrity_constraints.sql section 1: validate only
--    when clean, else NOTICE with the report query — never fail the push).
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_grn' AND NOT convalidated)
     AND to_regclass('public.tickets') IS NOT NULL
     AND to_regclass('public.grns') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tickets t
      LEFT JOIN public.grns g ON g.id = t.grn_id
      WHERE t.grn_id IS NOT NULL AND g.id IS NULL
    ) THEN
      ALTER TABLE public.tickets VALIDATE CONSTRAINT fk_tickets_grn;
    ELSE
      RAISE NOTICE 'fk_tickets_grn left NOT VALID: orphan links exist. Report: SELECT t.id FROM public.tickets t LEFT JOIN public.grns g ON g.id = t.grn_id WHERE t.grn_id IS NOT NULL AND g.id IS NULL;';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tickets_dc' AND NOT convalidated)
     AND to_regclass('public.tickets') IS NOT NULL
     AND to_regclass('public.delivery_challans') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tickets t
      LEFT JOIN public.delivery_challans d ON d.id = t.dc_id
      WHERE t.dc_id IS NOT NULL AND d.id IS NULL
    ) THEN
      ALTER TABLE public.tickets VALIDATE CONSTRAINT fk_tickets_dc;
    ELSE
      RAISE NOTICE 'fk_tickets_dc left NOT VALID: orphan links exist. Report: SELECT t.id FROM public.tickets t LEFT JOIN public.delivery_challans d ON d.id = t.dc_id WHERE t.dc_id IS NOT NULL AND d.id IS NULL;';
    END IF;
  END IF;
END $$;
