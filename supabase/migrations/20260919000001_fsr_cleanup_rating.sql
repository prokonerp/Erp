-- Migration: 20260919000001_fsr_cleanup_rating.sql
-- FSR v2 cleanup: drop the removed Phase 1A Front Indication payload and add
-- the compulsory 1-10 overall rating.
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Open the Supabase dashboard for this project → SQL editor.
--   2) Paste this file and Run, or: `supabase db push` from the repo root.
--   3) Verify: SELECT column_name FROM information_schema.columns
--      WHERE table_name = 'field_service_reports'
--      AND column_name IN ('front_indication', 'rating');
--      → front_indication gone, rating present.
--
-- NOTES:
-- - front_indication DROP is destructive by design (product decision: the
--   Phase 1A section is removed from the form, printout, and admin view).
--   Old report rows lose their front-indication JSON. Back up first if the
--   business needs history:
--     CREATE TABLE backup_fsr_front_indication_20260919 AS
--     SELECT id, ticket_id, front_indication FROM public.field_service_reports;
-- - rating is NULLABLE at the DB level on purpose: legacy rows predate the
--   field and a NOT NULL constraint would fail. The app enforces required
--   1-10 on every new submit (see ratingSchema in src/lib/fieldServiceReport.ts).
-- - part_replacements.old_barcode needs no DDL: it lives inside the
--   part_replacements jsonb array; new submits simply stop writing the key.
-- - Idempotent: DROP IF EXISTS / ADD IF NOT EXISTS + guarded CHECK.

-- 1) Drop the Front Indication payload column.
ALTER TABLE public.field_service_reports
  DROP COLUMN IF EXISTS front_indication;

-- 2) Add the overall rating (1-10). Nullable (legacy rows), range-checked.
ALTER TABLE public.field_service_reports
  ADD COLUMN IF NOT EXISTS rating integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'field_service_reports_rating_check'
      AND conrelid = 'public.field_service_reports'::regclass
  ) THEN
    ALTER TABLE public.field_service_reports
      ADD CONSTRAINT field_service_reports_rating_check
      CHECK (rating IS NULL OR (rating >= 1 AND rating <= 10));
  END IF;
END $$;
