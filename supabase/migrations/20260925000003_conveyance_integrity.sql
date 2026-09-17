-- Migration: 20260925000003_conveyance_integrity.sql
-- Purpose: Engineer conveyance integrity — expense-submit idempotency plus an
--   own-read RLS fallback for unlinked logins.
--
-- WHAT WAS BROKEN:
--   a) Expense submit is a bare INSERT: a retry after a timeout / a double-tap
--      in the same tick inserts the row twice (two charges for one visit).
--   b) Conveyance own-read policies key ONLY on employees.auth_user_id. An
--      engineer whose login email matches employees.email but whose
--      auth_user_id link was never backfilled sees zero rows (denied loads).
--
-- WHAT THIS FILE DOES:
--   1) engineer_conveyance_expenses.client_key (uuid, NOT NULL, unique):
--      the client mints one key per form mount and the server upserts on it
--      (INSERT ... ON CONFLICT (client_key) DO NOTHING, then return the row),
--      so a retry returns the saved row instead of duplicating or throwing.
--   2) ADDS (never replaces) one SELECT fallback policy per conveyance table
--      that grants own-row SELECT also via the JWT email
--      ((auth.jwt() ->> 'email') matched against employees.email, active
--      only). Own rows only — admin policies and all write paths untouched.
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste this file → Run,
--      or: `supabase db push` from the repo root.
--   2) Verify: the post-condition block at the end RAISES on any miss, so a
--      clean apply IS the verification. Then spot-check:
--        SELECT client_key FROM public.engineer_conveyance_expenses LIMIT 1;
--        SELECT policyname FROM pg_policies
--          WHERE schemaname = 'public'
--            AND tablename = 'engineer_conveyance_expenses';
--
-- NOTES:
-- - Additive-only, idempotent (IF NOT EXISTS / information_schema +
--   pg_constraint-guarded steps, DROP POLICY IF EXISTS + CREATE). Apply-twice
--   is clean: backfill touches only NULLs, SET NOT NULL is a no-op when
--   already set, constraint/policy creation is skipped when present.
-- - (auth.jwt() ->> 'email') is the standard Supabase JWT-email accessor and
--   IS available inside RLS USING expressions (same evaluation context as
--   auth.uid()), so the email fallback below is live — no auth_user_id-only
--   downgrade was needed.
-- - The email fallback intentionally ALSO requires employees.active = true,
--   mirroring the server identity policy (fetchMyIdentityAdmin).
-- - No UPDATE/DELETE of existing rows except backfilling the new client_key
--   column this migration owns. No behavior change for uploads, logs, profile.
--
-- Safety assertion (executable SQL): this file contains zero DELETE FROM /
--   TRUNCATE / DROP TABLE / DROP COLUMN — the ROLLBACK statements below appear
--   only inside comments and never execute.
--
-- ROLLBACK (comments only — run manually, in this order, if reverting):
--   DROP POLICY IF EXISTS "own email engineer_conveyance_settlements" ON public.engineer_conveyance_settlements;
--   DROP POLICY IF EXISTS "own email engineer_conveyance_rates" ON public.engineer_conveyance_rates;
--   DROP POLICY IF EXISTS "own email engineer_conveyance_expenses" ON public.engineer_conveyance_expenses;
--   DROP POLICY IF EXISTS "own email engineer_daily_logs" ON public.engineer_daily_logs;
--   ALTER TABLE IF EXISTS public.engineer_conveyance_expenses
--     DROP CONSTRAINT IF EXISTS uq_conveyance_expense_client_key;
--   ALTER TABLE IF EXISTS public.engineer_conveyance_expenses
--     DROP COLUMN IF EXISTS client_key;
--   (Leaves all pre-existing auth_user_id / admin policies exactly as they were.)
--
-- OPTIONAL backfill (comments only — run manually ONLY after verifying the
--   emails match real owners; never auto-runs, never part of apply):
--   UPDATE public.employees e
--      SET auth_user_id = u.id
--     FROM auth.users u
--    WHERE u.email IS NOT NULL
--      AND lower(btrim(e.email)) = lower(btrim(u.email))
--      AND e.auth_user_id IS NULL
--      AND e.active = true;
--   (After backfilling, the auth_user_id policies cover the login and the
--    email fallback below becomes a dormant safety net.)

-- =====================================================================
-- 0) Precondition: 20260920000001 must be applied first. Without the
--    expenses table the column + policies below fail cryptically — raise
--    the legible error instead.
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.engineer_conveyance_expenses') IS NULL THEN
    RAISE EXCEPTION 'Migration 20260925000003 requires 20260920000001 (engineer_conveyance_expenses missing). Apply 20260920000001 first.';
  END IF;
END $$;

-- =====================================================================
-- 1a) Expense idempotency key: column (nullable first so the backfill has
--     somewhere to land on tables that already hold rows).
-- =====================================================================
ALTER TABLE public.engineer_conveyance_expenses
  ADD COLUMN IF NOT EXISTS client_key uuid;

-- =====================================================================
-- 1b) Backfill existing NULLs (only NULLs — never touches minted keys, so
--     re-apply is a no-op once every row has a key).
-- =====================================================================
UPDATE public.engineer_conveyance_expenses
   SET client_key = gen_random_uuid()
 WHERE client_key IS NULL;

-- =====================================================================
-- 1c) NOT NULL (no-op when already set — apply-twice is clean).
-- =====================================================================
ALTER TABLE public.engineer_conveyance_expenses
  ALTER COLUMN client_key SET NOT NULL;

-- =====================================================================
-- 1d) UNIQUE constraint uq_conveyance_expense_client_key (guarded — the
--     server upserts ON CONFLICT (client_key), which requires exactly this).
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_conveyance_expense_client_key'
      AND conrelid = 'public.engineer_conveyance_expenses'::regclass
  ) THEN
    ALTER TABLE public.engineer_conveyance_expenses
      ADD CONSTRAINT uq_conveyance_expense_client_key UNIQUE (client_key);
  END IF;
END $$;

COMMENT ON COLUMN public.engineer_conveyance_expenses.client_key
  IS 'Idempotency key minted by the client (one per form mount). Server upserts ON CONFLICT (client_key) DO NOTHING so retries return the saved row.';

-- =====================================================================
-- 2) RLS own-read fallback: own rows ALSO visible via verified JWT email.
--    ADDITIVE ONLY — every pre-existing auth_user_id / admin policy stays
--    exactly as it is; admin policies and all write paths untouched. Each
--    USING clause still pins employee_id to the caller''s OWN employee row
--    (active + email match), so the fallback cannot widen beyond own rows.
--    Guarded on employees.email (+ active): without the email column the
--    policies would fail — NOTICE-skip instead.
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'employees'
                AND column_name = 'email')
     AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'employees'
                AND column_name = 'active') THEN

    DROP POLICY IF EXISTS "own email engineer_daily_logs" ON public.engineer_daily_logs;
    CREATE POLICY "own email engineer_daily_logs" ON public.engineer_daily_logs
      FOR SELECT TO authenticated
      USING (
        employee_id IN (
          SELECT id FROM public.employees
          WHERE active = true
            AND email = (auth.jwt() ->> 'email')
        )
      );

    DROP POLICY IF EXISTS "own email engineer_conveyance_expenses"
      ON public.engineer_conveyance_expenses;
    CREATE POLICY "own email engineer_conveyance_expenses"
      ON public.engineer_conveyance_expenses
      FOR SELECT TO authenticated
      USING (
        employee_id IN (
          SELECT id FROM public.employees
          WHERE active = true
            AND email = (auth.jwt() ->> 'email')
        )
      );

    IF to_regclass('public.engineer_conveyance_rates') IS NOT NULL THEN
      DROP POLICY IF EXISTS "own email engineer_conveyance_rates"
        ON public.engineer_conveyance_rates;
      CREATE POLICY "own email engineer_conveyance_rates"
        ON public.engineer_conveyance_rates
        FOR SELECT TO authenticated
        USING (
          employee_id IN (
            SELECT id FROM public.employees
            WHERE active = true
              AND email = (auth.jwt() ->> 'email')
          )
        );
    ELSE
      RAISE NOTICE 'Migration 20260925000003: rates email-fallback NOT created (engineer_conveyance_rates missing — apply 20260925000001)';
    END IF;

    IF to_regclass('public.engineer_conveyance_settlements') IS NOT NULL THEN
      DROP POLICY IF EXISTS "own email engineer_conveyance_settlements"
        ON public.engineer_conveyance_settlements;
      CREATE POLICY "own email engineer_conveyance_settlements"
        ON public.engineer_conveyance_settlements
        FOR SELECT TO authenticated
        USING (
          employee_id IN (
            SELECT id FROM public.employees
            WHERE active = true
              AND email = (auth.jwt() ->> 'email')
          )
        );
    ELSE
      RAISE NOTICE 'Migration 20260925000003: settlements email-fallback NOT created (engineer_conveyance_settlements missing — apply 20260925000001)';
    END IF;

  ELSE
    RAISE NOTICE 'Migration 20260925000003: email-fallback policies NOT created (employees.email/active missing)';
  END IF;
END $$;

-- =====================================================================
-- 3) GRANTs (to_regclass + role-guarded: a missing role on a bare scratch
--    cluster must NOTICE-skip, never abort). Service-role server fns own
--    the expense write path (upsert on client_key).
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.engineer_conveyance_expenses') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      GRANT ALL ON public.engineer_conveyance_expenses TO service_role;
    ELSE
      RAISE NOTICE 'skipping service_role grant on engineer_conveyance_expenses: role missing';
    END IF;
  END IF;
END $$;

-- =====================================================================
-- 4) Post-conditions: a clean apply IS the verification. Anything missing
--    below RAISES (loud) instead of a silent NOTICE.
-- =====================================================================
DO $$ DECLARE
  missing text[] := '{}';
  pol text;
  want_policies text[] := ARRAY[
    'engineer_daily_logs|"own email engineer_daily_logs"',
    'engineer_conveyance_expenses|"own email engineer_conveyance_expenses"',
    'engineer_conveyance_rates|"own email engineer_conveyance_rates"',
    'engineer_conveyance_settlements|"own email engineer_conveyance_settlements"'
  ];
  tbl text;
  pname text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'engineer_conveyance_expenses'
                   AND column_name = 'client_key') THEN
    missing := missing || 'column engineer_conveyance_expenses.client_key';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'engineer_conveyance_expenses'
               AND column_name = 'client_key'
               AND is_nullable = 'YES') THEN
    missing := missing || 'column engineer_conveyance_expenses.client_key is nullable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'uq_conveyance_expense_client_key'
                   AND conrelid = 'public.engineer_conveyance_expenses'::regclass) THEN
    missing := missing || 'constraint uq_conveyance_expense_client_key';
  END IF;
  FOREACH pol IN ARRAY want_policies LOOP
    tbl := split_part(pol, '|', 1);
    pname := trim(both '"' from split_part(pol, '|', 2));
    IF to_regclass(('public.' || tbl)) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM pg_policies
                       WHERE schemaname = 'public'
                         AND tablename = tbl
                         AND policyname = pname) THEN
      missing := missing || ('policy ' || pname || ' on ' || tbl);
    END IF;
  END LOOP;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'Migration 20260925000003 post-conditions FAILED: %', array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE 'Migration 20260925000003 post-conditions OK';
END $$;
