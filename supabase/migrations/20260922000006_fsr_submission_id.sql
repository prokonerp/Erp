-- Migration: 20260922000006_fsr_submission_id.sql
-- Idempotency key for Field Service Report submits.
--
-- CONTEXT: FSR submit was a plain INSERT guarded only by a client-side busy
-- flag. A retry after a timeout/ambiguous failure created a DUPLICATE FSR
-- row, and the view-only gate then locked the engineer out with 2 rows.
-- The client now generates one uuid per Report attempt
-- (see buildFsrPayload submissionId) and reuses it across retries; this
-- UNIQUE index turns the retry into a 23505 the client treats as success.
--
-- SAFE: additive only, idempotent (IF NOT EXISTS everywhere; the backfill
-- UPDATE is WHERE-guarded so re-runs touch zero rows). No rows deleted,
-- no columns dropped, no values overwritten — existing NULLs receive fresh
-- uuids, everything else is untouched.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  IF to_regclass('public.field_service_reports') IS NOT NULL THEN
    ALTER TABLE public.field_service_reports
      ADD COLUMN IF NOT EXISTS submission_id uuid;

    -- Backfill legacy rows (one uuid each). WHERE-guarded: re-runs are no-ops.
    UPDATE public.field_service_reports
    SET submission_id = gen_random_uuid()
    WHERE submission_id IS NULL;

    -- Partial UNIQUE: legacy NULLs (if any remain) never conflict with each
    -- other; every new submit carries a client-generated uuid.
    CREATE UNIQUE INDEX IF NOT EXISTS uq_fsr_submission_id
      ON public.field_service_reports (submission_id)
      WHERE submission_id IS NOT NULL;
  ELSE
    RAISE NOTICE 'fsr_submission_id: field_service_reports missing — skipping';
  END IF;
END $$;
