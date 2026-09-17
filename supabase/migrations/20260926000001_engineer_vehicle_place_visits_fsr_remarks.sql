-- Migration: 20260926000001_engineer_vehicle_place_visits_fsr_remarks.sql
-- Engineer portal: vehicle_no on employees, Place-Visit list (non-charge),
-- FSR customer/engineer remarks.
--
-- HOW TO APPLY (human only — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste → Run.
--   2) VERIFY the data move first: run the whole file inside BEGIN; … ROLLBACK;
--      and check the SELECTs at the bottom. Then run for real.
--   Additive + idempotent. The only destructive step is moving Place-Visit
--   expense rows into the new table and deleting them — take a backup first.

-- =====================================================================
-- 1) employees.vehicle_no (bike / vehicle number)
-- =====================================================================
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS vehicle_no text;

-- =====================================================================
-- 2) engineer_place_visits — simple timestamp + typed note (NOT a charge)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.engineer_place_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  visited_at timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engineer_place_visits_employee_date
  ON public.engineer_place_visits (employee_id, visited_at DESC);

ALTER TABLE public.engineer_place_visits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- own rows via auth_user_id link
  DROP POLICY IF EXISTS "own engineer_place_visits" ON public.engineer_place_visits;
  CREATE POLICY "own engineer_place_visits" ON public.engineer_place_visits
    FOR SELECT TO authenticated
    USING (employee_id IN (SELECT id FROM public.employees WHERE auth_user_id = auth.uid()));

  -- admin full access
  DROP POLICY IF EXISTS "admin all engineer_place_visits" ON public.engineer_place_visits;
  CREATE POLICY "admin all engineer_place_visits" ON public.engineer_place_visits
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
END $$;

-- own-read email fallback (same shape as 20260925000003), guarded
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='employees' AND column_name='email')
     AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='employees' AND column_name='active') THEN
    DROP POLICY IF EXISTS "own email engineer_place_visits" ON public.engineer_place_visits;
    CREATE POLICY "own email engineer_place_visits" ON public.engineer_place_visits
      FOR SELECT TO authenticated
      USING (employee_id IN (
        SELECT id FROM public.employees
        WHERE active = true AND email = (auth.jwt() ->> 'email')
      ));
  ELSE
    RAISE NOTICE '20260926000001: place-visits email fallback skipped (employees.email/active missing)';
  END IF;
END $$;

-- =====================================================================
-- 3) Move existing 'Place Visit' expenses → the new list, then drop the
--    charge type. Historical amounts become notes (they were never payable).
-- =====================================================================
INSERT INTO public.engineer_place_visits (employee_id, visited_at, note)
SELECT
  employee_id,
  (expense_date::timestamp AT TIME ZONE 'Asia/Kolkata'),
  COALESCE(NULLIF(btrim(notes), ''), 'Place visit')
FROM public.engineer_conveyance_expenses
WHERE charge_type = 'Place Visit';

DELETE FROM public.engineer_conveyance_expenses WHERE charge_type = 'Place Visit';

-- Swap the charge_type CHECK to Toll/Parking only (idempotent, unnamed inline
-- constraint is located by definition).
DO $$ DECLARE cname text; BEGIN
  SELECT conname INTO cname
    FROM pg_constraint
   WHERE conrelid = 'public.engineer_conveyance_expenses'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%charge_type%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.engineer_conveyance_expenses DROP CONSTRAINT %I', cname);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.engineer_conveyance_expenses'::regclass
                    AND conname='engineer_conveyance_expenses_charge_type_check') THEN
    ALTER TABLE public.engineer_conveyance_expenses
      ADD CONSTRAINT engineer_conveyance_expenses_charge_type_check
      CHECK (charge_type IN ('Toll','Parking'));
  END IF;
END $$;

-- =====================================================================
-- 4) FSR: customer + engineer remarks
-- =====================================================================
ALTER TABLE public.field_service_reports
  ADD COLUMN IF NOT EXISTS customer_remarks text,
  ADD COLUMN IF NOT EXISTS engineer_remarks text;
