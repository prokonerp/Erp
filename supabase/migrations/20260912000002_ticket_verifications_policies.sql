-- Base RLS policies for ticket verification tables (permissive).
-- NOTE: superseded by 20260916000003_harden_ticket_verifications_rls.sql,
-- which DROP+CREATEs these same 8 policy names with permission-gated
-- definitions. Apply in order.
--
-- HISTORY: this file was renamed from 20260912000001_ticket_verifications_policies.sql
-- to 20260912000002_... because two files shared version 20260912000001, which
-- breaks `supabase db push` version tracking. Content is unchanged in effect.
--
-- IDEMPOTENCY: every policy is created only if it does not already exist, so
-- re-applying this file (e.g. after the rename, on a DB where the hardened
-- successor already runs) is a strict no-op and can never re-open the
-- permissive era. SAFE: zero destructive statements; no rows touched.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN.

DO $$ BEGIN
  IF to_regclass('public.ticket_customer_verifications') IS NULL
     OR to_regclass('public.ticket_equipment_verifications') IS NULL THEN
    RAISE NOTICE 'ticket_verifications_policies: verification tables missing — skipping';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_customer_verifications' AND policyname = 'auth view tcv') THEN
    CREATE POLICY "auth view tcv" ON public.ticket_customer_verifications FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_customer_verifications' AND policyname = 'auth insert tcv') THEN
    CREATE POLICY "auth insert tcv" ON public.ticket_customer_verifications FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_customer_verifications' AND policyname = 'auth update tcv') THEN
    CREATE POLICY "auth update tcv" ON public.ticket_customer_verifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_customer_verifications' AND policyname = 'auth delete tcv') THEN
    CREATE POLICY "auth delete tcv" ON public.ticket_customer_verifications FOR DELETE TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_equipment_verifications' AND policyname = 'auth view tev') THEN
    CREATE POLICY "auth view tev" ON public.ticket_equipment_verifications FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_equipment_verifications' AND policyname = 'auth insert tev') THEN
    CREATE POLICY "auth insert tev" ON public.ticket_equipment_verifications FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_equipment_verifications' AND policyname = 'auth update tev') THEN
    CREATE POLICY "auth update tev" ON public.ticket_equipment_verifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_equipment_verifications' AND policyname = 'auth delete tev') THEN
    CREATE POLICY "auth delete tev" ON public.ticket_equipment_verifications FOR DELETE TO authenticated USING (true);
  END IF;
END $$;
