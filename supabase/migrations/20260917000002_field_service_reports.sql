-- Migration: 20260917000002_field_service_reports.sql
-- Field Service Reports: APPEND-ONLY per-ticket reports. Multiple rows per ticket
-- allowed — each submit = new row, history preserved, never overwritten.
-- SAFE: additive-only, idempotent (IF NOT EXISTS / DROP IF EXISTS + CREATE),
-- zero destructive statements. No backfill UPDATEs, no ALTER of existing tables.

-- =====================================================================
-- 1) public.field_service_reports: append-only per-ticket report rows
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.field_service_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  -- Phase 1 readings (app enforces required; mains voltages NOT NULL):
  mains_voltage_ln numeric NOT NULL,
  mains_voltage_ne numeric NOT NULL,
  -- Dynamic battery records: [{charge_vdc, discharge_vdc}, ...] (count = array length, 0 = none)
  battery_readings jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Phase 2 load record:
  ac_provided boolean NOT NULL DEFAULT false,
  dg_provided boolean NOT NULL DEFAULT false,
  environment_duty boolean NOT NULL DEFAULT false,
  ups_location text NOT NULL CHECK (ups_location IN ('Computer Room', 'Electrical Room', 'Network Room', 'Other')),
  -- Dynamic device records (0..N rows; empty array = none at site):
  -- pc_details: [{monitor_size_in, qty}, ...]
  pc_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- printer_details: [{rating_w, qty}, ...]
  printer_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- scanner_details: [{rating_w, qty}, ...]
  scanner_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Phase 3 power condition:
  power_failures_count integer,
  power_failures_duration_min numeric,
  load_on_dg_percent numeric,
  dg_set boolean NOT NULL DEFAULT false,
  dg_set_capacity_kva numeric,
  amf_panel boolean NOT NULL DEFAULT false,
  operate_non_business_hours boolean NOT NULL DEFAULT false,
  operate_holidays boolean NOT NULL DEFAULT false,
  -- Audit:
  engineer_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  engineer_name text,
  engineer_phone text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for per-ticket history lookup (newest first). Idempotent.
CREATE INDEX IF NOT EXISTS idx_fsr_ticket
  ON public.field_service_reports (ticket_id, submitted_at DESC);

ALTER TABLE public.field_service_reports ENABLE ROW LEVEL SECURITY;

-- Keep updated_at fresh on UPDATE. Idempotent.
DROP TRIGGER IF EXISTS trg_touch_fsr ON public.field_service_reports;
CREATE TRIGGER trg_touch_fsr
  BEFORE UPDATE ON public.field_service_reports
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
    RAISE NOTICE 'field_service_reports_rls: helpers missing — skipping';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "auth view fsr" ON public.field_service_reports;
  CREATE POLICY "auth view fsr" ON public.field_service_reports
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'read')
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth insert fsr" ON public.field_service_reports;
  CREATE POLICY "auth insert fsr" ON public.field_service_reports
    FOR INSERT TO authenticated
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth update fsr" ON public.field_service_reports;
  CREATE POLICY "auth update fsr" ON public.field_service_reports
    FOR UPDATE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

  DROP POLICY IF EXISTS "admin delete fsr" ON public.field_service_reports;
  CREATE POLICY "admin delete fsr" ON public.field_service_reports
    FOR DELETE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
END $$;
