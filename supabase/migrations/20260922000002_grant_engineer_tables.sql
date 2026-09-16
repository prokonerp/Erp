-- Migration: 20260922000002_grant_engineer_tables.sql
-- Grant the authenticated + service_role roles on all engineer-portal tables.
--
-- CONTEXT: the engineer-portal tables were created across 20260912-20260921
-- without any GRANT statements, so on a fresh `supabase db reset` every portal
-- query fails with "permission denied for table" (RLS policies alone do not
-- confer access). The live DB only works because grants were applied out-of-band.
-- This migration makes the grants part of versioned history.
--
-- SAFE: additive only, idempotent (GRANT is a no-op when already granted;
-- each statement is additionally guarded by to_regclass so partially-applied
-- environments never error). Zero destructive statements. Grants confer access
-- only — no rows are read, written, or altered by this file.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN / REVOKE.

DO $$ BEGIN
  IF to_regclass('public.ticket_customer_verifications') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_customer_verifications TO authenticated;
    GRANT ALL ON public.ticket_customer_verifications TO service_role;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.ticket_equipment_verifications') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_equipment_verifications TO authenticated;
    GRANT ALL ON public.ticket_equipment_verifications TO service_role;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.field_service_reports') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.field_service_reports TO authenticated;
    GRANT ALL ON public.field_service_reports TO service_role;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.ticket_visits') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_visits TO authenticated;
    GRANT ALL ON public.ticket_visits TO service_role;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.ticket_assignment_history') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_assignment_history TO authenticated;
    GRANT ALL ON public.ticket_assignment_history TO service_role;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.engineer_daily_logs') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.engineer_daily_logs TO authenticated;
    GRANT ALL ON public.engineer_daily_logs TO service_role;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.engineer_conveyance_expenses') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.engineer_conveyance_expenses TO authenticated;
    GRANT ALL ON public.engineer_conveyance_expenses TO service_role;
  END IF;
END $$;
