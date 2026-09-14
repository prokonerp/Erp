-- Migration: 20260917000003_engineer_visits_signature.sql
-- Engineer visits (one row per ticket) + customer signature columns on FSR.
-- SAFE: additive-only, idempotent (IF NOT EXISTS / DROP IF EXISTS + CREATE),
-- zero destructive statements. No backfill UPDATEs, no ALTER of existing tables.

-- =====================================================================
-- 1) public.ticket_visits: one visit row per ticket (arrival/departure)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.ticket_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid UNIQUE NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  engineer_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  engineer_name text,
  engineer_phone text,
  arrival_at timestamptz,
  departure_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for per-ticket visit lookup. Idempotent.
CREATE INDEX IF NOT EXISTS idx_ticket_visits_ticket
  ON public.ticket_visits (ticket_id);

ALTER TABLE public.ticket_visits ENABLE ROW LEVEL SECURITY;

-- Keep updated_at fresh on UPDATE. Idempotent.
DROP TRIGGER IF EXISTS trg_touch_ticket_visits ON public.ticket_visits;
CREATE TRIGGER trg_touch_ticket_visits
  BEFORE UPDATE ON public.ticket_visits
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 2) RLS: permission-gated (tickets module), same shape as
--    20260916000003_harden_ticket_verifications_rls.sql.
--    Wrapped in DO block: skips if has_role/has_permission helpers missing.
--    Fail-closed: when helpers are missing the block RETURNS early, so no
--    permissive policy is created and the table stays deny-all under RLS.
-- =====================================================================
DO $$
BEGIN
  -- Fail-closed guard: deny-all (RLS enabled, no policies) when helpers missing.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_permission') THEN
    RAISE NOTICE 'ticket_visits_rls: helpers missing — skipping';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "auth view ticket_visits" ON public.ticket_visits;
  CREATE POLICY "auth view ticket_visits" ON public.ticket_visits
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'read')
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth insert ticket_visits" ON public.ticket_visits;
  CREATE POLICY "auth insert ticket_visits" ON public.ticket_visits
    FOR INSERT TO authenticated
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth update ticket_visits" ON public.ticket_visits;
  CREATE POLICY "auth update ticket_visits" ON public.ticket_visits
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth delete ticket_visits" ON public.ticket_visits;
  CREATE POLICY "auth delete ticket_visits" ON public.ticket_visits
    FOR DELETE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
END $$;

-- =====================================================================
-- 3) FSR customer signature (storage path + capture timestamp)
-- =====================================================================
ALTER TABLE public.field_service_reports
  ADD COLUMN IF NOT EXISTS customer_signature_path text;
ALTER TABLE public.field_service_reports
  ADD COLUMN IF NOT EXISTS signature_captured_at timestamptz;
