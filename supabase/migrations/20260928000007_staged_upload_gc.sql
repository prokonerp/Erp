-- Migration: 20260928000007_staged_upload_gc.sql
-- Garbage-collect orphaned public raise-ticket staged uploads.
--
-- The public form stages photos under public/staged/<date>/... BEFORE the
-- ticket exists; abandons (user never submits) would pile up forever.
-- This adds a service-role-only purge function + a daily pg_cron job
-- deleting staged objects older than 7 days.
--
-- SAFE: additive only, idempotent (CREATE OR REPLACE, guarded cron),
-- deletes ONLY ticket-attachments objects under public/staged/** older
-- than 7 days — ticket/<id>/... and fresh staged files are untouched.
--
-- Rollback: SELECT cron.unschedule('staged-public-uploads-purge-daily');
--   DROP FUNCTION public.purge_staged_public_uploads();

CREATE OR REPLACE FUNCTION public.purge_staged_public_uploads()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  DELETE FROM storage.objects
   WHERE bucket_id = 'ticket-attachments'
     AND name LIKE 'public/staged/%'
     AND created_at < now() - interval '7 days';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

COMMENT ON FUNCTION public.purge_staged_public_uploads()
  IS 'Deletes orphaned public staged uploads (public/staged/**) older than 7 days. Run daily via pg_cron.';

REVOKE ALL ON FUNCTION public.purge_staged_public_uploads() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_staged_public_uploads() TO service_role;

-- Cron (same guard shape as 20260928000002_engineer_location_retention_rollup):
-- 02:30 IST = 21:00 UTC previous day (IST = UTC+5:30, no DST).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('staged-public-uploads-purge-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'staged-public-uploads-purge-daily');
    PERFORM cron.schedule(
      'staged-public-uploads-purge-daily',
      '0 21 * * *',
      $cron$ SELECT public.purge_staged_public_uploads(); $cron$
    );
  ELSE
    RAISE NOTICE 'staged_upload_gc: pg_cron missing — purge not scheduled (run purge_staged_public_uploads() manually)';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
