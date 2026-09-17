-- Migration: 20260925000005_verification_step_order.sql
-- Purpose: Enforce the fixed 3-step verify order (customer -> equipment -> work)
--   at the DB layer: INSERT into ticket_equipment_verifications is refused
--   unless a ticket_customer_verifications row already exists for that ticket.
--
-- WHAT WAS BROKEN:
--   The engineer ticket workspace writes verifications via DIRECT client
--   upserts (supabase.from("ticket_customer_verifications").upsert(...) and
--   supabase.from("ticket_equipment_verifications").upsert(...) in
--   src/routes/eng.ticket.$id.tsx). The pure gates canProceedToStep2 /
--   canProceedToWork in src/lib/ticket-verifications.ts are UI-only, so a
--   direct equipment-before-customer insert (console, script, stale client)
--   silently skips step 1.
--
-- WHAT THIS FILE DOES:
--   BEFORE INSERT trigger trg_verification_step_order on
--   public.ticket_equipment_verifications calling
--   public.enforce_verification_step_order(), which RAISES unless a
--   public.ticket_customer_verifications row exists for NEW.ticket_id.
--   Trigger (not RLS WITH CHECK) so the rule survives client shape changes.
--   INSERT-only so UPDATE / re-verify of an existing equipment row keeps
--   working. Step 3 (work) stays UI-gated via canProceedToWork — see below.
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste this file → Run,
--      or: `supabase db push` from the repo root.
--   2) Verify: the post-condition block at the end RAISES on any miss, so a
--      clean apply IS the verification. Then spot-check with the read-only
--      SELECTs in VERIFY below, plus the transactional probe (rolls back,
--      writes nothing) against a real ticket id.
--
-- VERIFY (read-only — safe to run any time):
--   SELECT tgname FROM pg_trigger
--    WHERE tgname = 'trg_verification_step_order';
--   SELECT p.proname, p.prosecdef
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname = 'enforce_verification_step_order';
--
-- PROBE (transactional — rolls back, persists nothing; replace <TICKET_ID>):
--   BEGIN;
--   -- 1) Must FAIL: equipment before customer on a ticket with no customer row.
--   INSERT INTO public.ticket_equipment_verifications
--     (ticket_id, verdict, original_model, original_serial)
--     VALUES ('<TICKET_ID>', 'matched', 'probe-model', 'probe-serial');
--   -- expect: ERROR "equipment verification requires a customer
--   --   verification row first for ticket ..."
--   ROLLBACK;
--   BEGIN;
--   -- 2) Must SUCCEED: customer first, then equipment.
--   INSERT INTO public.ticket_customer_verifications
--     (ticket_id, verdict) VALUES ('<TICKET_ID>', 'verified');
--   INSERT INTO public.ticket_equipment_verifications
--     (ticket_id, verdict, original_model, original_serial)
--     VALUES ('<TICKET_ID>', 'matched', 'probe-model', 'probe-serial');
--   -- expect: both inserts succeed.
--   ROLLBACK;
--
-- NOTES:
-- - Additive-only, idempotent (CREATE OR REPLACE function, DROP TRIGGER IF
--   EXISTS + CREATE TRIGGER, to_regclass-guarded DO blocks). Apply-twice is
--   clean. No behavior change for SELECT / UPDATE / DELETE paths.
-- - Step 3 / work is INTENTIONALLY left UI-gated (canProceedToWork): work
--   spans many tables (activities, visits, FSRs) with no single insert point,
--   so no DB gate is added here. UI must keep checking both rows exist.
-- - Upsert compatibility: upsert on a MISSING equipment row fires INSERT
--   (gated — correct); upsert on an EXISTING equipment row fires UPDATE
--   (ungated — re-verify keeps working).
--
-- CARVE-OUTS (explicit):
-- - `reset-ticket-engineer` (src/lib/reset-ticket-engineer.functions.ts)
--   DELETEs both verification tables via service role: untouched — this
--   migration adds no DELETE trigger, and RLS DELETE policies are unchanged.
-- - Admin corrections: UPDATEs on either table (re-verify, corrected values)
--   are untouched — trigger is INSERT-only.
-- - Customer re-verify / insert path is untouched — no trigger on
--   ticket_customer_verifications.
--
-- Safety assertion (executable SQL): this file contains zero DELETE FROM /
--   TRUNCATE / DROP TABLE / DROP COLUMN — the ROLLBACK statements above and
--   below appear only inside comments and never execute.
--
-- ROLLBACK (comments only — run manually, in this order, if reverting):
--   DROP TRIGGER IF EXISTS trg_verification_step_order ON public.ticket_equipment_verifications;
--   DROP FUNCTION IF EXISTS public.enforce_verification_step_order();
--   (Leaves all pre-existing RLS policies and rows exactly as they were.)

-- =====================================================================
-- 0) Precondition: verification tables must exist (from
--    20260912000000_ticket_verifications.sql). Fail-soft: NOTICE-skip the
--    trigger wiring when they are missing so unrelated applies never abort.
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.ticket_customer_verifications') IS NULL
     OR to_regclass('public.ticket_equipment_verifications') IS NULL THEN
    RAISE NOTICE 'Migration 20260925000005: verification tables missing — trigger NOT created (apply 20260912000000 first)';
  END IF;
END $$;

-- =====================================================================
-- 1) Trigger function: refuse equipment INSERT without a customer row for
--    the same ticket. SECURITY DEFINER so the customer-row check cannot be
--    hidden by the caller's RLS visibility; fixed search_path. Reads only —
--    never writes.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.enforce_verification_step_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF to_regclass('public.ticket_customer_verifications') IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.ticket_customer_verifications
    WHERE ticket_id = NEW.ticket_id
  ) THEN
    RAISE EXCEPTION
      'equipment verification requires a customer verification row first for ticket % (verify customer before equipment)',
      NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$func$;

COMMENT ON FUNCTION public.enforce_verification_step_order()
  IS 'Step-order gate (20260925000005): equipment INSERT requires an existing ticket_customer_verifications row for the same ticket_id. INSERT-only; UPDATE/DELETE untouched.';

-- =====================================================================
-- 2) BEFORE INSERT trigger (idempotent: DROP IF EXISTS + CREATE). Guarded
--    so a missing equipment table NOTICE-skips instead of aborting.
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.ticket_equipment_verifications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_verification_step_order
      ON public.ticket_equipment_verifications;
    CREATE TRIGGER trg_verification_step_order
      BEFORE INSERT ON public.ticket_equipment_verifications
      FOR EACH ROW EXECUTE FUNCTION public.enforce_verification_step_order();
  ELSE
    RAISE NOTICE 'Migration 20260925000005: trigger NOT created (ticket_equipment_verifications missing)';
  END IF;
END $$;

-- =====================================================================
-- 3) Post-conditions: a clean apply IS the verification. Anything missing
--    below RAISES (loud) instead of a silent NOTICE. Skips only when the
--    base tables are absent (precondition case above).
-- =====================================================================
DO $$ DECLARE
  missing text[] := '{}';
BEGIN
  IF to_regclass('public.ticket_customer_verifications') IS NULL
     OR to_regclass('public.ticket_equipment_verifications') IS NULL THEN
    RAISE NOTICE 'Migration 20260925000005 post-conditions SKIPPED (verification tables missing)';
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'enforce_verification_step_order'
  ) THEN
    missing := missing || 'function enforce_verification_step_order';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_verification_step_order'
      AND tgrelid = 'public.ticket_equipment_verifications'::regclass
  ) THEN
    missing := missing || 'trigger trg_verification_step_order on ticket_equipment_verifications';
  END IF;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'Migration 20260925000005 post-conditions FAILED: %', array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE 'Migration 20260925000005 post-conditions OK';
END $$;
