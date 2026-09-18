-- Migration: 20260927000001_engineer_day_admin_review.sql
-- Per-day admin review state on engineer_daily_logs (Eng-Ops conveyance).
--
-- HOW TO APPLY (human only — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste the whole file → Run.
--   2) Run it a second time: the second run must succeed with zero errors
--      (idempotency check) before treating the apply as good.
--
-- Additive + idempotent. Adds four admin-review columns with safe defaults;
-- never updates, deletes, or backfills existing business data beyond the
-- column DEFAULT. RLS is untouched on purpose: engineers hold SELECT-only on
-- this table (20260920000001 "own engineer_daily_logs"), admins hold FOR ALL
-- (20260920000001 "admin all engineer_daily_logs"), and every admin write
-- goes through the gated setEngineerDayReview server fn — so no new policy
-- or trigger is required to keep admin_* columns admin-only.

-- =====================================================================
-- 1) Admin review columns
-- =====================================================================
ALTER TABLE public.engineer_daily_logs
  ADD COLUMN IF NOT EXISTS admin_status text NOT NULL DEFAULT 'Pending';

ALTER TABLE public.engineer_daily_logs
  ADD COLUMN IF NOT EXISTS admin_remarks text;

ALTER TABLE public.engineer_daily_logs
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;

ALTER TABLE public.engineer_daily_logs
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

COMMENT ON COLUMN public.engineer_daily_logs.admin_status
  IS 'Eng-Ops day review: Pending | Paid | Flagged. Set only via the admin-gated setEngineerDayReview server fn.';
COMMENT ON COLUMN public.engineer_daily_logs.admin_remarks
  IS 'Eng-Ops remark for the day review (required when Flagged).';
COMMENT ON COLUMN public.engineer_daily_logs.reviewed_by
  IS 'Auth user id of the admin who last set the day review.';
COMMENT ON COLUMN public.engineer_daily_logs.reviewed_at
  IS 'Timestamp of the last day-review change.';

-- =====================================================================
-- 2) Status CHECK (guarded — safe to run twice)
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.engineer_daily_logs'::regclass
       AND conname = 'engineer_daily_logs_admin_status_check'
  ) THEN
    ALTER TABLE public.engineer_daily_logs
      ADD CONSTRAINT engineer_daily_logs_admin_status_check
      CHECK (admin_status IN ('Pending', 'Paid', 'Flagged'));
  END IF;
END $$;

-- =====================================================================
-- 3) Partial index for the Eng-Ops "needs review" scan
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_engineer_daily_logs_admin_review
  ON public.engineer_daily_logs (employee_id, admin_status)
  WHERE admin_status <> 'Pending';

-- =====================================================================
-- 4) Verify (read-only — raises NOTICE, never throws)
-- =====================================================================
DO $$ DECLARE
  missing text[] := '{}';
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['admin_status', 'admin_remarks', 'reviewed_by', 'reviewed_at'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'engineer_daily_logs'
         AND column_name = c
    ) THEN
      missing := missing || c;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.engineer_daily_logs'::regclass
       AND conname = 'engineer_daily_logs_admin_status_check'
  ) THEN
    missing := missing || 'constraint engineer_daily_logs_admin_status_check';
  END IF;
  IF array_length(missing, 1) > 0 THEN
    RAISE NOTICE '20260927000001 post-check MISSING: %', array_to_string(missing, ', ');
  ELSE
    RAISE NOTICE '20260927000001 post-check OK: admin review columns + check present';
  END IF;
END $$;
