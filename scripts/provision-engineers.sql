-- scripts/provision-engineers.sql
-- PROKON ERP — link the 5 Service Engineer portal logins to their employee rows.
--
-- ⚠️  REWRITTEN 2026-09-18 AFTER A LIVE OUTAGE. READ THIS BEFORE EDITING.
--
--   The previous version of this file created the auth users itself with a raw
--     INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, ...)
--     INSERT INTO auth.identities (user_id, identity_data, provider, provider_id)
--   Those inserts listed only a subset of columns. Postgres stored NULL in the
--   omitted nullable ones, GoTrue cannot decode a user row containing NULL in
--   those columns, and every read of those rows started returning HTTP 500:
--     * engineer sign-in        -> 500 "Database error querying schema"
--     * Admin → Users (app)     -> 500 "Database error finding users"
--     * Supabase Auth dashboard -> 500
--   Repair for the 5 affected rows (already applied / to apply):
--     supabase/repair_20260918_auth_users_null_columns.sql
--
--   THIS FILE NO LONGER WRITES TO THE auth SCHEMA. It only links an EXISTING
--   auth user (created by GoTrue, which writes every column itself) to an
--   employee row and upserts the app_users profile.
--
-- CANONICAL WAY TO CREATE THE AUTH USER (do this FIRST, one per engineer):
--   * In-app:  Admin → Roles & Users → "Provision login" on the employee row
--              (server fn provisionEngineerLogin — Admin API, strong-password
--              validation, password_history, forced first-login rotation)
--   * Script:  node scripts/create-users.mjs   (Admin API, preserved UUIDs)
--   * Then run THIS file only if the employee link is still missing.
--
-- HOW TO RUN (Supabase Dashboard → SQL Editor, live project)
--   1. Create the auth users with one of the two paths above.
--   2. Paste this file, press Run. Run as ONE batch.
--   3. Check the trailing verification SELECT (expect 5 rows, linked=true).
--
-- WHAT IT DOES
--   employees.email set → app_users upsert (Engineer role, active) →
--   employees.auth_user_id link → post-link verification per row.
--
-- SAFETY ASSERTION (keep this true on every edit)
--   * zero INSERT / UPDATE / DELETE against auth.users or auth.identities
--   * zero DROP / TRUNCATE / ALTER TABLE
--   * no password is set, hashed or stored here — ever
--   * no DELETE of unrelated rows; re-running is a no-op for linked engineers
--   * SCOPE: only the 5 Service Engineers named below
--
-- See docs/ENGINEER_PORTAL.md → "Portal login provisioning" for the full rule.

DO $$
DECLARE
  v_engineer_role_id uuid;
  r           RECORD;
  v_emp_id    uuid;
  v_emp_name  text;
  v_email     text;
  v_uid       uuid;
  v_missing   text[] := ARRAY[]::text[];
BEGIN
  SELECT id INTO v_engineer_role_id FROM public.app_roles WHERE name = 'Engineer';
  IF v_engineer_role_id IS NULL THEN
    RAISE EXCEPTION 'Engineer role not found — apply migration 20260915000003_engineer_role_seed.sql first';
  END IF;

  -- name → email mapping (first-initial+last-initial@eng.prokonhitech.com)
  FOR r IN
    SELECT * FROM (VALUES
      ('Desraj',          'desraj@eng.prokonhitech.com'),
      ('Pankaj Vohra',    'pv@eng.prokonhitech.com'),
      ('Krishna Sharma',  'ks@eng.prokonhitech.com'),
      ('Rameshwar Singh', 'rs@eng.prokonhitech.com'),
      ('Vipin Chhonker',  'vc@eng.prokonhitech.com')
    ) AS m(emp_name, emp_email)
  LOOP
    -- 1) employee must exist, be active, and have no login yet
    SELECT e.id, e.name INTO v_emp_id, v_emp_name
    FROM public.employees e
    WHERE e.name = r.emp_name AND e.active = true AND e.auth_user_id IS NULL;
    IF v_emp_id IS NULL THEN
      RAISE NOTICE 'skip %: not found, inactive, or already linked', r.emp_name;
      CONTINUE;
    END IF;
    v_email := lower(r.emp_email);

    -- 2) employees master email (provisioning rule: email must be set first)
    UPDATE public.employees SET email = v_email WHERE id = v_emp_id;

    -- 3) FIND-ONLY. The auth user must already exist, created by GoTrue.
    SELECT u.id INTO v_uid FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;
    IF v_uid IS NULL THEN
      RAISE NOTICE 'MISSING auth user for % — provision it via Admin → Roles & Users → "Provision login" (or scripts/create-users.mjs), then re-run this file',
        v_email;
      v_missing := v_missing || (v_emp_name || ' <' || v_email || '>');
      CONTINUE;
    END IF;

    -- 4) app_users upsert (Engineer role, active). Password state is owned by
    --    the provisioning path — this file deliberately does not touch it.
    INSERT INTO public.app_users (user_id, name, email, role_id, status)
    VALUES (v_uid, v_emp_name, v_email, v_engineer_role_id, 'active')
    ON CONFLICT (user_id) DO UPDATE
      SET role_id = EXCLUDED.role_id,
          status  = 'active';

    -- 5) link employee → auth user
    UPDATE public.employees SET auth_user_id = v_uid WHERE id = v_emp_id;

    -- 6) verify link (mirrors the app's post-link check)
    PERFORM 1 FROM public.employees WHERE id = v_emp_id AND auth_user_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'link verification failed for % (%)', v_emp_name, v_uid;
    END IF;
    RAISE NOTICE 'linked % (%) OK', v_emp_name, v_uid;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE WARNING 'NO auth user exists for: %. Create the login in the app first (Admin → Roles & Users → "Provision login").',
      array_to_string(v_missing, ', ');
  END IF;
END $$;

-- ── Verification (expect 5 rows, all linked / Engineer / active) ──
SELECT e.name, e.email, (e.auth_user_id IS NOT NULL) AS linked,
       r.name AS app_role, au.status, au.must_change_password
FROM public.employees e
LEFT JOIN public.app_users au ON au.user_id = e.auth_user_id
LEFT JOIN public.app_roles r ON r.id = au.role_id
WHERE e.name IN ('Desraj','Pankaj Vohra','Krishna Sharma','Rameshwar Singh','Vipin Chhonker')
ORDER BY e.name;
