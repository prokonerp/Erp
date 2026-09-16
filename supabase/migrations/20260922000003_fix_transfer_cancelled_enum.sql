-- Migration: 20260922000003_fix_transfer_cancelled_enum.sql
-- Ensure the 'cancelled' value exists on public.ims_transfer_status.
--
-- CONTEXT: 20260918000003_transfer_cancel_reversal.sql added a trigger whose
-- WHEN clause and function body reference NEW.status = 'cancelled', but no
-- migration ever added that value to the enum (the live DB received it
-- out-of-band). On a fresh `supabase db reset` the trigger is dead and any
-- write of 'cancelled' raises "invalid input value for enum".
--
-- SAFE: additive only, idempotent (guarded DO block — re-running is a no-op).
-- Zero destructive statements. No rows touched.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ims_transfer_status') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ims_transfer_status'
        AND e.enumlabel = 'cancelled'
    ) THEN
      ALTER TYPE public.ims_transfer_status ADD VALUE 'cancelled';
    END IF;
  END IF;
END $$;
