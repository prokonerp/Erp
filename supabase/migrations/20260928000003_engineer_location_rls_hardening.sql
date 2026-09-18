-- Migration: 20260928000003_engineer_location_rls_hardening.sql
-- Harden engineer location RLS: cross-engineer reads become admin-only.
--
-- Background (ADR-0001 follow-up): the base migration lets
-- has_permission(uid,'engineers','read') see every engineer's pings, live
-- status, sessions, movements, and consent rows. That permission is Mainly
-- Harmless today (the Engineer role holds no 'engineers' row, so it
-- evaluates false), but 'engineers' is now a registered app module — one
-- admin checkbox in the permissions UI would silently expose every
-- engineer's live location to that role. Cross-row visibility must require
-- has_role admin; engineers always see only their own rows.
--
-- SAFE: policy replacement only (DROP IF EXISTS + CREATE), no table/DDL
-- changes, zero data writes. Idempotent. Requires 20260928000001 applied.
--
-- Rollback: re-run 20260928000001's RLS block (it is DROP IF EXISTS +
-- CREATE and restores the has_permission branches).

DO $$
BEGIN
  IF to_regclass('public.engineer_duty_sessions') IS NULL
     OR to_regclass('public.engineer_location_pings') IS NULL
     OR to_regclass('public.engineer_live_status') IS NULL
     OR to_regclass('public.engineer_daily_movements') IS NULL
     OR to_regclass('public.engineer_consent_events') IS NULL THEN
    RAISE NOTICE 'engineer_location_rls_hardening: location tables missing — run 20260928000001 first';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role') THEN
    RAISE NOTICE 'engineer_location_rls_hardening: has_role missing — RLS stays deny-all, skipping';
    RETURN;
  END IF;

  -- ---- duty sessions: own rows, or admin. No role-based see-all. ----
  DROP POLICY IF EXISTS "own duty sessions" ON public.engineer_duty_sessions;
  CREATE POLICY "own duty sessions" ON public.engineer_duty_sessions
    FOR ALL TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
    WITH CHECK (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    );

  -- ---- pings: own insert (unchanged shape), own-or-admin select. ----
  DROP POLICY IF EXISTS "pings select" ON public.engineer_location_pings;
  CREATE POLICY "pings select" ON public.engineer_location_pings
    FOR SELECT TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    );

  -- ---- live status: own upsert (unchanged), admin-only roster read. ----
  DROP POLICY IF EXISTS "live status admin read" ON public.engineer_live_status;
  CREATE POLICY "live status admin read" ON public.engineer_live_status
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));

  -- ---- daily movements: own-or-admin select. ----
  DROP POLICY IF EXISTS "movements select" ON public.engineer_daily_movements;
  CREATE POLICY "movements select" ON public.engineer_daily_movements
    FOR SELECT TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    );

  -- ---- consent: own insert (unchanged), own-or-admin select. ----
  DROP POLICY IF EXISTS "consent select" ON public.engineer_consent_events;
  CREATE POLICY "consent select" ON public.engineer_consent_events
    FOR SELECT TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    );
END $$;
