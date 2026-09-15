-- Migration: 20260920000001_engineer_conveyance_profile.sql
-- Engineer portal v2: daily conveyance logs + expenses, profile photo/docs.
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste this file → Run,
--      or: `supabase db push` from the repo root.
--   2) Verify: tables engineer_daily_logs / engineer_conveyance_expenses
--      exist, employees has photo_path + documents, bucket engineer-uploads
--      exists in Storage.
--
-- NOTES:
-- - Additive-only, idempotent (IF NOT EXISTS / DROP IF EXISTS + CREATE).
-- - Engineers are read/upload-only by role design: table writes for the new
--   tables go through service-role server fns, so INSERT/UPDATE/DELETE are
--   admin-only at RLS; engineers SELECT only their OWN rows.
-- - Uploads go through the server fn (service role bypasses storage RLS);
--   signed-URL reads need the authenticated SELECT policy below.

-- =====================================================================
-- 1) engineer_daily_logs: one odometer entry per engineer per day
--    (morning + evening reading, each with its own photo).
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.engineer_daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  morning_odometer numeric,
  morning_photo_path text,
  morning_captured_at timestamptz,
  evening_odometer numeric,
  evening_photo_path text,
  evening_captured_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engineer_daily_logs_one_per_day UNIQUE (employee_id, log_date),
  CONSTRAINT engineer_daily_logs_evening_after_morning CHECK (
    morning_odometer IS NULL
    OR evening_odometer IS NULL
    OR evening_odometer >= morning_odometer
  )
);

CREATE INDEX IF NOT EXISTS idx_engineer_daily_logs_employee
  ON public.engineer_daily_logs (employee_id);
CREATE INDEX IF NOT EXISTS idx_engineer_daily_logs_date
  ON public.engineer_daily_logs (log_date);

ALTER TABLE public.engineer_daily_logs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_touch_engineer_daily_logs ON public.engineer_daily_logs;
CREATE TRIGGER trg_touch_engineer_daily_logs
  BEFORE UPDATE ON public.engineer_daily_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 2) engineer_conveyance_expenses: place visits / parking / tolls
--    (multiple rows per day allowed).
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.engineer_conveyance_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  charge_type text NOT NULL CHECK (charge_type IN ('Place Visit', 'Parking', 'Toll')),
  amount numeric NOT NULL CHECK (amount > 0),
  receipt_path text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_engineer_conveyance_expenses_employee
  ON public.engineer_conveyance_expenses (employee_id);
CREATE INDEX IF NOT EXISTS idx_engineer_conveyance_expenses_date
  ON public.engineer_conveyance_expenses (expense_date);

ALTER TABLE public.engineer_conveyance_expenses ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_touch_engineer_conveyance_expenses
  ON public.engineer_conveyance_expenses;
CREATE TRIGGER trg_touch_engineer_conveyance_expenses
  BEFORE UPDATE ON public.engineer_conveyance_expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 3) RLS: engineers read their OWN rows (auth_user_id join through
--    employees, same shape as "own employee row" 20260915000005).
--    Writes stay admin-only — the app writes via service-role server fns.
-- =====================================================================
DO $$
BEGIN
  -- daily logs
  DROP POLICY IF EXISTS "own engineer_daily_logs" ON public.engineer_daily_logs;
  CREATE POLICY "own engineer_daily_logs" ON public.engineer_daily_logs
    FOR SELECT TO authenticated
    USING (
      employee_id IN (
        SELECT id FROM public.employees WHERE auth_user_id = auth.uid()
      )
    );
  DROP POLICY IF EXISTS "admin all engineer_daily_logs" ON public.engineer_daily_logs;
  CREATE POLICY "admin all engineer_daily_logs" ON public.engineer_daily_logs
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

  -- expenses
  DROP POLICY IF EXISTS "own engineer_conveyance_expenses"
    ON public.engineer_conveyance_expenses;
  CREATE POLICY "own engineer_conveyance_expenses"
    ON public.engineer_conveyance_expenses
    FOR SELECT TO authenticated
    USING (
      employee_id IN (
        SELECT id FROM public.employees WHERE auth_user_id = auth.uid()
      )
    );
  DROP POLICY IF EXISTS "admin all engineer_conveyance_expenses"
    ON public.engineer_conveyance_expenses;
  CREATE POLICY "admin all engineer_conveyance_expenses"
    ON public.engineer_conveyance_expenses
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
END $$;

-- =====================================================================
-- 4) employees: profile photo + documents (engineer self-managed via
--    server fn; readable via the existing "own employee row" policy).
--    documents: [{ "name": "Aadhaar", "path": "engineer/…/x.jpg",
--                  "uploaded_at": "…" }]
-- =====================================================================
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS photo_path text;
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS documents jsonb NOT NULL DEFAULT '[]'::jsonb;

-- =====================================================================
-- 5) Storage bucket engineer-uploads (private; mirrors ticket-attachments
--    shape: authenticated read for signed URLs, writes via server fn).
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'engineer-uploads',
  'engineer-uploads',
  false,
  10485760,
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "Authenticated can read engineer-uploads" ON storage.objects;
CREATE POLICY "Authenticated can read engineer-uploads" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'engineer-uploads');

DROP POLICY IF EXISTS "Admins can insert engineer-uploads" ON storage.objects;
CREATE POLICY "Admins can insert engineer-uploads" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'engineer-uploads'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Admins can update engineer-uploads" ON storage.objects;
CREATE POLICY "Admins can update engineer-uploads" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'engineer-uploads'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    bucket_id = 'engineer-uploads'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Admins can delete engineer-uploads" ON storage.objects;
CREATE POLICY "Admins can delete engineer-uploads" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'engineer-uploads'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );
