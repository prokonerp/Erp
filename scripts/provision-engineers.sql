-- scripts/provision-engineers.sql
-- PROKON ERP — Provision portal logins for the 5 Service Engineers.
--
-- HOW TO RUN (Supabase Dashboard → SQL Editor, live project):
--   1. Copy THIS file. Make ONE edit in your pasted copy: type the shared
--      engineer password between the quotes on the v_pw line below.
--      NEVER commit the edited file — the committed version has NULL here.
--   2. Paste the whole thing, press Run. Run as ONE batch.
--   3. Check the trailing verification SELECT (expect 5 rows, linked=true).
--
-- WHAT IT DOES (mirrors the app's own provisionEngineerLogin, idempotent):
--   employees.email set → auth.users find-or-create (bcrypt, confirmed) +
--   auth.identities email row → password_history insert (bcrypt bf/12, same
--   format as the app's record_password_history RPC — which is itself broken
--   on live, see step-5 note; fix its search_path separately) +
--   app_users upsert (Engineer role, active, must_change_password=false per
--   admin decision: engineers keep the shared password, no forced rotation)
--   → employees.auth_user_id link.
--
-- SCOPE: ONLY the 5 Service Engineers below. Aarti / Baldev / Daksh (and all
-- other users) are NOT touched by any statement here.
-- SAFE: no DELETE / DROP / UPDATE of unrelated rows. Re-running skips
-- already-linked engineers (no-op); only still-unlinked engineers are hashed.
--
-- Pre-flight: pgcrypto for crypt()/gen_salt().
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  -- !!! Type the shared engineer password between SINGLE quotes below
  -- !!! (like this: 'password' — NOT double quotes "like this").
  -- !!! Nothing else needs editing. (NULL + length check = the guard.)
  v_pw text := NULL;
  v_engineer_role_id uuid;
  r RECORD;
  v_emp_id uuid;
  v_emp_name text;
  v_email text;
  v_uid uuid;
BEGIN
  IF v_pw IS NULL OR length(v_pw) < 8 THEN
    RAISE EXCEPTION 'Set v_pw above to the shared engineer password (min 8 chars) before running this script';
  END IF;

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

    -- 3) auth.users find-or-create (LINK path mirrors updateUserById)
    SELECT u.id INTO v_uid FROM auth.users u WHERE lower(u.email) = v_email LIMIT 1;
    IF v_uid IS NULL THEN
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
        'authenticated', 'authenticated', v_email,
        crypt(v_pw, gen_salt('bf', 10)),
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now()
      )
      RETURNING id INTO v_uid;
      RAISE NOTICE 'created auth user % -> %', v_email, v_uid;
    ELSE
      UPDATE auth.users
      SET encrypted_password = crypt(v_pw, gen_salt('bf', 10)),
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          updated_at         = now()
      WHERE id = v_uid;
      RAISE NOTICE 'existing auth user % (%): password synced', v_email, v_uid;
    END IF;

    -- 4) auth.identities email row (GoTrue needs it for sign-in;
    --    provider_id = user uuid, matching the auth Admin API convention)
    INSERT INTO auth.identities (user_id, identity_data, provider, provider_id)
    VALUES (v_uid, jsonb_build_object('sub', v_uid::text, 'email', v_email), 'email', v_uid::text)
    ON CONFLICT (provider, provider_id) DO NOTHING;

    -- 5) password history — bcrypt format IDENTICAL to the app's own
    --    record_password_history RPC: password_hash = crypt(pw, gen_salt bf/12).
    --    NOTE: inserted directly instead of calling that RPC, because the RPC
    --    is broken on live — it pins SET search_path TO 'public' while pgcrypto
    --    lives in extensions, so gen_salt() is unresolvable inside it (42883).
    --    The app swallows that failure client-side; here we fail loud instead.
    --    To fix the RPC itself (recommended, separate run):
    --      ALTER FUNCTION public.record_password_history(uuid, text)
    --        SET search_path TO 'public, extensions';
    --      ALTER FUNCTION public.check_password_reuse(uuid, text)
    --        SET search_path TO 'public, extensions';
    INSERT INTO public.password_history (user_id, password_hash)
    VALUES (v_uid, crypt(v_pw, gen_salt('bf', 12)));

    -- 6) app_users upsert (Engineer role; no forced rotation per admin decision)
    INSERT INTO public.app_users
      (user_id, name, email, role_id, status, password_changed_at, must_change_password)
    VALUES (v_uid, v_emp_name, v_email, v_engineer_role_id, 'active', now(), false)
    ON CONFLICT (user_id) DO UPDATE
      SET role_id = EXCLUDED.role_id,
          status  = 'active',
          must_change_password = false,
          password_changed_at  = now();

    -- 7) link employee → auth user
    UPDATE public.employees SET auth_user_id = v_uid WHERE id = v_emp_id;

    -- 8) verify link (mirrors the app's post-link check)
    PERFORM 1 FROM public.employees WHERE id = v_emp_id AND auth_user_id = v_uid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'link verification failed for % (%)', v_emp_name, v_uid;
    END IF;
    RAISE NOTICE 'linked % (%) OK', v_emp_name, v_uid;
  END LOOP;
END $$;

-- ── Verification (expect 5 rows, all linked / Engineer / active) ──
SELECT e.name, e.email, (e.auth_user_id IS NOT NULL) AS linked,
       r.name AS app_role, au.status, au.must_change_password
FROM public.employees e
LEFT JOIN public.app_users au ON au.user_id = e.auth_user_id
LEFT JOIN public.app_roles r ON r.id = au.role_id
WHERE e.name IN ('Desraj','Pankaj Vohra','Krishna Sharma','Rameshwar Singh','Vipin Chhonker')
ORDER BY e.name;
