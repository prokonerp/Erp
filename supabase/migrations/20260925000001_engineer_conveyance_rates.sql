-- Migration: 20260925000001_engineer_conveyance_rates.sql
-- Purpose: Engineers admin module Task B0-2 — per-engineer conveyance rates,
--   monthly settlement periods, and an admin audit log, plus helper fns
--   (list_engineers, conveyance_rate_for) for the admin UI / server fns.
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste this file → Run,
--      or: `supabase db push` from the repo root.
--   2) Verify: tables engineer_conveyance_rates /
--      engineer_conveyance_settlements / engineer_admin_audit exist,
--      functions list_engineers() / conveyance_rate_for() exist.
--
-- NOTES:
-- - Additive-only, idempotent (IF NOT EXISTS / DROP IF EXISTS + CREATE,
--   CREATE OR REPLACE, to_regclass-guarded GRANT/seed blocks).
-- - Engineers are read-only by role design on rates + settlements (SELECT own
--   rows only); admin writes go through service-role server fns. Audit rows
--   are written by service-role server fns (bypasses RLS); admins SELECT only.
-- - list_engineers() is SECURITY DEFINER (bypasses RLS), so the admin gate
--   inside the function body is load-bearing — non-admins get zero rows.
--
-- Safety assertion (executable SQL): this file contains zero DELETE FROM /
--   TRUNCATE / DROP TABLE / DROP COLUMN — the ROLLBACK statements below appear
--   only inside comments and never execute.
--
-- ROLLBACK (comments only — run manually, in this order, if reverting):
--   DROP FUNCTION IF EXISTS public.conveyance_rate_for(uuid, date);
--   DROP FUNCTION IF EXISTS public.list_engineers();
--   ALTER TABLE IF EXISTS public.engineer_conveyance_settlements
--     DROP CONSTRAINT IF EXISTS no_overlapping_settlements;
--   DROP TRIGGER IF EXISTS trg_touch_engineer_conveyance_settlements
--     ON public.engineer_conveyance_settlements;
--   DROP TRIGGER IF EXISTS trg_touch_engineer_conveyance_rates
--     ON public.engineer_conveyance_rates;
--   DROP TABLE IF EXISTS public.engineer_admin_audit;
--   DROP TABLE IF EXISTS public.engineer_conveyance_settlements;
--   DROP TABLE IF EXISTS public.engineer_conveyance_rates;
--   (Leaves btree_gist installed; leaves the 'engineers' app_modules row.)

-- =====================================================================
-- 1) engineer_conveyance_rates: per-engineer Rs/km, effective-dated
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.engineer_conveyance_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  rate_per_km numeric(12,2) NOT NULL CHECK (rate_per_km > 0),
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engineer_conveyance_rates_one_per_day UNIQUE (employee_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_engineer_conveyance_rates_employee_from
  ON public.engineer_conveyance_rates USING btree (employee_id, effective_from);

ALTER TABLE public.engineer_conveyance_rates ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_touch_engineer_conveyance_rates
  ON public.engineer_conveyance_rates;
CREATE TRIGGER trg_touch_engineer_conveyance_rates
  BEFORE UPDATE ON public.engineer_conveyance_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 2) engineer_conveyance_settlements: one payout row per engineer period
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.engineer_conveyance_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  computed_km numeric(10,1),
  rate_per_km numeric(12,2),
  computed_amount numeric(12,2),
  flat_expenses numeric(12,2) NOT NULL DEFAULT 0,
  adjusted_amount numeric(12,2),
  adjustment_reason text,
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  approved_by uuid,
  approved_at timestamptz,
  locked_at timestamptz,
  locked_by uuid,
  reference_no text UNIQUE,
  paid_at timestamptz,
  payment_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engineer_conveyance_settlements_one_per_period
    UNIQUE (employee_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_engineer_conveyance_settlements_employee_period
  ON public.engineer_conveyance_settlements USING btree (employee_id, period_start);

ALTER TABLE public.engineer_conveyance_settlements ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_touch_engineer_conveyance_settlements
  ON public.engineer_conveyance_settlements;
CREATE TRIGGER trg_touch_engineer_conveyance_settlements
  BEFORE UPDATE ON public.engineer_conveyance_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 3) Overlap guard: no two settlement periods may overlap per engineer.
--    Needs btree_gist (uuid = needs gist opclass). Falls back to the app
--    server fn when the extension is unavailable.
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'btree_gist')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'no_overlapping_settlements'
         AND conrelid = 'public.engineer_conveyance_settlements'::regclass
     ) THEN
    ALTER TABLE public.engineer_conveyance_settlements
      ADD CONSTRAINT no_overlapping_settlements
      EXCLUDE USING gist (
        employee_id WITH =,
        daterange(period_start, period_end, '[]') WITH &&
      );
  ELSE
    RAISE NOTICE 'no_overlapping_settlements not enforced by DDL — overlap validation falls back to the app server fn';
  END IF;
END $$;

-- =====================================================================
-- 4) engineer_admin_audit: append-only admin action log (service-role writes)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.engineer_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engineer_admin_audit_entity
  ON public.engineer_admin_audit USING btree (entity, entity_id);

ALTER TABLE public.engineer_admin_audit ENABLE ROW LEVEL SECURITY;

-- =====================================================================
-- 5) RLS: admin FOR ALL everywhere; engineers SELECT own rates/settlement
--    rows; audit is admin-SELECT-only (writes via service-role server fns).
-- =====================================================================
DO $$
BEGIN
  -- rates
  DROP POLICY IF EXISTS "own engineer_conveyance_rates" ON public.engineer_conveyance_rates;
  CREATE POLICY "own engineer_conveyance_rates" ON public.engineer_conveyance_rates
    FOR SELECT TO authenticated
    USING (
      employee_id IN (
        SELECT id FROM public.employees WHERE auth_user_id = auth.uid()
      )
    );
  DROP POLICY IF EXISTS "admin all engineer_conveyance_rates" ON public.engineer_conveyance_rates;
  CREATE POLICY "admin all engineer_conveyance_rates" ON public.engineer_conveyance_rates
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

  -- settlements
  DROP POLICY IF EXISTS "own engineer_conveyance_settlements" ON public.engineer_conveyance_settlements;
  CREATE POLICY "own engineer_conveyance_settlements" ON public.engineer_conveyance_settlements
    FOR SELECT TO authenticated
    USING (
      employee_id IN (
        SELECT id FROM public.employees WHERE auth_user_id = auth.uid()
      )
    );
  DROP POLICY IF EXISTS "admin all engineer_conveyance_settlements" ON public.engineer_conveyance_settlements;
  CREATE POLICY "admin all engineer_conveyance_settlements" ON public.engineer_conveyance_settlements
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

  -- audit: admin SELECT only
  DROP POLICY IF EXISTS "admin select engineer_admin_audit" ON public.engineer_admin_audit;
  CREATE POLICY "admin select engineer_admin_audit" ON public.engineer_admin_audit
    FOR SELECT TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
  DROP POLICY IF EXISTS "admin all engineer_admin_audit" ON public.engineer_admin_audit;
  CREATE POLICY "admin all engineer_admin_audit" ON public.engineer_admin_audit
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
END $$;

-- =====================================================================
-- 6) list_engineers(): admin-gated roster for the Engineers admin UI.
--    SECURITY DEFINER bypasses RLS, so the has_role gate below is
--    load-bearing — non-admins get zero rows.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.list_engineers()
RETURNS TABLE (
  employee_id uuid,
  name text,
  phone text,
  email text,
  active boolean,
  auth_user_id uuid,
  photo_path text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    e.id AS employee_id,
    e.name,
    e.phone,
    e.email,
    e.active,
    e.auth_user_id,
    e.photo_path
  FROM public.employees e
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.is_field_engineer(e.auth_user_id);
$$;

-- =====================================================================
-- 7) conveyance_rate_for(): latest effective rate on/before a date
-- =====================================================================
CREATE OR REPLACE FUNCTION public.conveyance_rate_for(_employee_id uuid, _on_date date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT rate_per_km
  FROM public.engineer_conveyance_rates
  WHERE employee_id = _employee_id
    AND effective_from <= _on_date
  ORDER BY effective_from DESC
  LIMIT 1;
$$;

-- =====================================================================
-- 8) GRANTs (mirrors 20260922000002 to_regclass-guarded pattern).
--    Every grant is additionally role-guarded: a missing role (e.g. a bare
--    scratch cluster without service_role) must NOTICE-skip, never abort.
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.list_engineers() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.conveyance_rate_for(uuid, date) TO authenticated;
  ELSE
    RAISE NOTICE 'skipping function grants: role authenticated missing';
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.engineer_conveyance_rates') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.engineer_conveyance_rates TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      GRANT ALL ON public.engineer_conveyance_rates TO service_role;
    ELSE
      RAISE NOTICE 'skipping service_role grant on engineer_conveyance_rates: role missing';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.engineer_conveyance_settlements') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.engineer_conveyance_settlements TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      GRANT ALL ON public.engineer_conveyance_settlements TO service_role;
    ELSE
      RAISE NOTICE 'skipping service_role grant on engineer_conveyance_settlements: role missing';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.engineer_admin_audit') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.engineer_admin_audit TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      GRANT ALL ON public.engineer_admin_audit TO service_role;
    ELSE
      RAISE NOTICE 'skipping service_role grant on engineer_admin_audit: role missing';
    END IF;
  END IF;
END $$;

-- =====================================================================
-- 9) Seed: Engineers entry in the app-modules registry
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.app_modules') IS NOT NULL THEN
    INSERT INTO public.app_modules (key, label, sort_order, supports_import, is_active)
    VALUES ('engineers', 'Engineers', 92, false, true)
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
