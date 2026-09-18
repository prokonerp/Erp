-- =====================================================================
-- supabase/repair_20260918_auth_users_null_columns.sql   (v2 — 2026-09-18b)
-- PROKON ERP — repair the 5 engineer auth rows GoTrue cannot read.
-- =====================================================================
--
-- v2 CHANGELOG (why v1 was not enough — read before running)
--   v1 fixed the NULL scalar columns of auth.users and the rows started
--   decoding: GET /auth/v1/admin/users went 500 -> 200 with all 14 users.
--   But GET /auth/v1/admin/users/{id} and sign-in still 500'd for the 5
--   engineers. Those two endpoints are the ones that also load identities, so
--   the remaining damage is in auth.identities — and v1's column filter
--   deliberately excluded timestamp columns, which is wrong for exactly two of
--   them: GoTrue's Identity/User structs hold `created_at` and `updated_at` as
--   NON-pointer time.Time values, so a NULL there is undecodable, while every
--   other timestamp (invited_at, *_sent_at, banned_until, deleted_at,
--   last_sign_in_at, phone_confirmed_at) is a pointer and must stay NULL.
--   v2 therefore:
--     * audits users AND identities with NO type filter (nothing can hide),
--     * fills created_at / updated_at on both tables,
--     * fills auth.identities.created_at/updated_at from the parent user's
--       created_at (semantically right: the identity was born with the user),
--     * repairs a generated auth.identities.email that is NULL because
--       identity_data carries no email,
--     * keeps every benign timestamp NULL.
--
-- SYMPTOM (user-reported 2026-09-18)
--   Signing in as any @eng.prokonhitech.com engineer shows the browser console
--   "Failed to load resource: the server responded with a status of 500" on
--   POST /auth/v1/token?grant_type=password. Admin → Users is broken by the
--   same rows. No app code runs — the request dies inside Supabase Auth.
--
-- EVIDENCE (service-role READS against the live project, zero writes)
--   before v1: POST token -> 500 "Database error querying schema"
--              GET /admin/users -> 500 "Database error finding users"
--              GET /admin/users/{id} -> 500 "Database error loading user" (5 engineers only)
--   after  v1: GET /admin/users -> 200, 14 users  (auth.users rows are healthy)
--              GET /admin/users/{id} and POST token -> still 500  => identities
--   POST token with an unknown email -> 400 invalid_credentials in every state
--     (the query is fine; it is the ROW DECODE that fails.)
--
-- ROOT CAUSE
--   scripts/provision-engineers.sql created the 5 engineer logins with raw
--   INSERTs into auth.users and auth.identities that listed only a subset of
--   columns. Postgres stored NULL in the omitted nullable ones; GoTrue scans
--   them into non-pointer Go struct fields, so any one NULL makes the row
--   undecodable. Users created through the GoTrue Admin API are complete,
--   because GoTrue writes every column itself.
--
-- HOW TO RUN (Supabase Dashboard → SQL Editor, live project)
--   Section 0  read-only audit  → names every NULL on users and identities (run FIRST)
--   Section 1  the repair       → prints one NOTICE per column/row fixed
--   Section 2  post-check       → must return 0 rows
--   Then: node scripts/diagnose-portal-logins.mjs 'desraj@eng.prokonhitech.com:<pw>'
--
-- SAFETY
--   * Only data-writing statements: UPDATE auth.users / auth.identities setting a
--     NULL column to its own DEFAULT (or the type-appropriate literal) for the
--     5 engineer rows, plus one targeted identity_data fix. Zero DELETE /
--     TRUNCATE / DROP / ALTER TABLE / GRANT / REVOKE / CREATE FUNCTION.
--   * Byte-for-byte scoped to 5 users (email list ∪ probed ids).
--   * Generated columns (auth.users.confirmed_at, auth.identities.email) are
--     never written directly; the identity email is repaired through its source
--     column identity_data instead.
--   * encrypted_password is never auto-filled — a NULL there means "no password",
--     and the honest fix is to set one through the Admin API.
--   * Each column update runs in its own sub-transaction: a constraint conflict
--     is reported and skipped instead of aborting the repair.
--   * Idempotent: a second run reports 0 fixes.
-- =====================================================================


-- =====================================================================
-- SECTION 0 — READ-ONLY AUDIT  (run first; paste the output if you want me to confirm)
-- =====================================================================

-- 0a) auth.users: EVERY NULL column, no type filter (nothing can hide).
SELECT u.id, u.email,
       (SELECT string_agg(t.key, ', ' ORDER BY t.key)
          FROM jsonb_each_text(to_jsonb(u)) AS t(key, value)
         WHERE t.value IS NULL) AS all_null_columns
FROM auth.users u
WHERE lower(u.email) IN (
        'desraj@eng.prokonhitech.com','pv@eng.prokonhitech.com',
        'ks@eng.prokonhitech.com','rs@eng.prokonhitech.com',
        'vc@eng.prokonhitech.com')
ORDER BY u.email;

-- 0b) auth.identities: one row per identity, EVERY NULL column + the fields GoTrue needs.
SELECT u.email, i.id AS identity_id, i.provider_id, i.provider,
       i.created_at, i.updated_at, i.email AS generated_email,
       (SELECT string_agg(t.key, ', ' ORDER BY t.key)
          FROM jsonb_each_text(to_jsonb(i)) AS t(key, value)
         WHERE t.value IS NULL) AS all_null_columns
FROM auth.users u
LEFT JOIN auth.identities i ON i.user_id = u.id
WHERE lower(u.email) IN (
        'desraj@eng.prokonhitech.com','pv@eng.prokonhitech.com',
        'ks@eng.prokonhitech.com','rs@eng.prokonhitech.com',
        'vc@eng.prokonhitech.com')
ORDER BY u.email;
-- Expect, after v1: created_at and updated_at NULL here — that is what still
-- breaks GET /admin/users/{id} and sign-in.

-- 0c) blast radius: any OTHER auth.identities row with a NULL created_at/updated_at
SELECT i.user_id, u.email, i.id AS identity_id, i.created_at, i.updated_at
FROM auth.identities i
LEFT JOIN auth.users u ON u.id = i.user_id
WHERE i.created_at IS NULL OR i.updated_at IS NULL
ORDER BY u.email;

-- 0d) password presence/format (a NULL or non-bcrypt value is a separate problem)
SELECT u.email, length(u.encrypted_password) AS pw_len,
       left(u.encrypted_password, 4) AS pw_prefix,      -- expect $2a$ / $2b$
       u.email_confirmed_at IS NOT NULL AS email_confirmed
FROM auth.users u
WHERE lower(u.email) IN (
        'desraj@eng.prokonhitech.com','pv@eng.prokonhitech.com',
        'ks@eng.prokonhitech.com','rs@eng.prokonhitech.com',
        'vc@eng.prokonhitech.com')
ORDER BY u.email;


-- =====================================================================
-- SECTION 1 — THE REPAIR
-- =====================================================================
DO $$
DECLARE
  v_emails text[] := ARRAY[
    'desraj@eng.prokonhitech.com',
    'pv@eng.prokonhitech.com',
    'ks@eng.prokonhitech.com',
    'rs@eng.prokonhitech.com',
    'vc@eng.prokonhitech.com'
  ];
  v_ids     uuid[];
  tgt       RECORD;
  c         RECORD;
  v_fill    text;
  v_fb      text;
  v_rows    int;
  v_total   int := 0;
  v_skipped int := 0;
BEGIN
  SELECT array_agg(DISTINCT u.id) INTO v_ids
  FROM auth.users u
  WHERE lower(u.email) = ANY (v_emails)
     OR u.id = ANY (ARRAY[
          '15407cea-eff7-4de0-85bc-622be91baa3f',  -- desraj@eng.prokonhitech.com
          '392fb189-9c93-4708-ab72-2ac56ba150d1',  -- pv@eng.prokonhitech.com
          '75b4b455-06d3-4d5d-8ce3-42e446f337af',  -- ks@eng.prokonhitech.com
          '850e3579-99d9-4c8c-bbfa-37bb272950fe',  -- rs@eng.prokonhitech.com
          'a59e143c-b2a1-42ea-9d81-2b8a952ec38c'   -- vc@eng.prokonhitech.com
        ]::uuid[]);

  IF v_ids IS NULL THEN
    RAISE EXCEPTION 'No engineer auth.users rows matched — aborting, nothing changed.';
  END IF;
  RAISE NOTICE 'targeting % auth.users row(s)', array_length(v_ids, 1);

  -- ── 1a) identities whose identity_data carries no email ────────────────
  -- The generated auth.identities.email column is derived from
  -- identity_data->>'email'; when that key is missing the generated value is
  -- NULL and GoTrue's Identity.Email (a plain string) fails to scan.
  EXECUTE $q$
    UPDATE auth.identities i
       SET identity_data = i.identity_data || jsonb_build_object('email', lower(u.email))
      FROM auth.users u
     WHERE u.id = i.user_id
       AND lower(u.email) = ANY ($1)
       AND (i.identity_data ->> 'email') IS NULL
  $q$ USING v_emails;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    RAISE NOTICE '  identities: filled missing identity_data.email on % row(s)', v_rows;
    v_total := v_total + v_rows;
  END IF;

  -- ── 1b) identities timestamps from the parent user ─────────────────────
  -- created_at/updated_at are non-pointer time.Time in GoTrue's Identity, so
  -- NULL breaks the decode. The identity was born with its user: copy that.
  UPDATE auth.identities i
     SET created_at = COALESCE(i.created_at, u.created_at, now()),
         updated_at = COALESCE(i.updated_at, u.created_at, now())
    FROM auth.users u
   WHERE u.id = i.user_id
     AND u.id = ANY (v_ids)
     AND (i.created_at IS NULL OR i.updated_at IS NULL);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    RAISE NOTICE '  identities: set created_at/updated_at on % row(s) from parent user', v_rows;
    v_total := v_total + v_rows;
  END IF;

  -- ── 1c) catalogue-driven fill of every remaining NULL GoTrue cannot decode ──
  -- Scalar columns: any of them. Timestamps: ONLY created_at / updated_at — every
  -- other timestamp in these tables is a pointer in GoTrue and must stay NULL.
  FOR tgt IN
    SELECT * FROM (VALUES
      ('auth', 'users',      'id = ANY($1)'),
      ('auth', 'identities', 'user_id = ANY($1)')
    ) AS v(sch, tbl, where_expr)
  LOOP
    RAISE NOTICE '--- %.% ---', tgt.sch, tgt.tbl;

    FOR c IN
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = tgt.sch
        AND table_name   = tgt.tbl
        AND is_nullable  = 'YES'
        AND is_generated = 'NEVER'
        AND column_name <> 'encrypted_password'
        AND (
              data_type IN ('text','character varying','boolean','smallint','integer','bigint','jsonb','uuid')
              OR (data_type LIKE 'timestamp%' AND column_name IN ('created_at','updated_at'))
            )
      ORDER BY column_name
    LOOP
      IF c.column_name = 'instance_id' THEN
        v_fill := quote_literal('00000000-0000-0000-0000-000000000000') || '::uuid';
      ELSIF c.column_default IS NOT NULL AND c.column_default NOT ILIKE '%nextval%' THEN
        v_fill := c.column_default;
      ELSE
        v_fill := CASE
                    WHEN c.data_type = 'text'              THEN quote_literal('')
                    WHEN c.data_type = 'character varying' THEN quote_literal('')
                    WHEN c.data_type = 'boolean'           THEN 'false'
                    WHEN c.data_type = 'jsonb'             THEN quote_literal('{}') || '::jsonb'
                    WHEN c.data_type = 'uuid'              THEN 'gen_random_uuid()'
                    WHEN c.data_type LIKE 'timestamp%'     THEN 'now()'
                    ELSE '0'
                  END;
      END IF;

      BEGIN
        EXECUTE format('UPDATE %I.%I SET %I = %s WHERE %s AND %I IS NULL',
                       tgt.sch, tgt.tbl, c.column_name, v_fill, tgt.where_expr, c.column_name)
          USING v_ids;
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_rows > 0 THEN
          RAISE NOTICE '  fixed %: % row(s)  ->  %', c.column_name, v_rows, v_fill;
          v_total := v_total + v_rows;
        END IF;

      EXCEPTION
        WHEN unique_violation THEN
          -- uniquely indexed column where '' collides (token columns): retry with
          -- a per-row unique, unguessable value — same meaning as "no token".
          v_fb := CASE
                    WHEN c.data_type = 'uuid' THEN 'gen_random_uuid()'
                    WHEN c.data_type LIKE 'timestamp%' THEN 'now()'
                    ELSE 'replace(gen_random_uuid()::text, ''-'', '''')'
                  END;
          BEGIN
            EXECUTE format('UPDATE %I.%I SET %I = %s WHERE %s AND %I IS NULL',
                           tgt.sch, tgt.tbl, c.column_name, v_fb, tgt.where_expr, c.column_name)
              USING v_ids;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            RAISE NOTICE '  fixed % (unique-safe fallback): % row(s)', c.column_name, v_rows;
            v_total := v_total + v_rows;
          EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE '  SKIPPED %: %', c.column_name, SQLERRM;
            v_skipped := v_skipped + 1;
          END;

        WHEN OTHERS THEN
          RAISE NOTICE '  SKIPPED %: %', c.column_name, SQLERRM;
          v_skipped := v_skipped + 1;
      END;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'TOTAL row/column fixes: %, skipped columns: %', v_total, v_skipped;
  IF v_total = 0 THEN
    RAISE NOTICE 'nothing to fix — rows were already complete (or already repaired).';
  END IF;
END $$;


-- =====================================================================
-- SECTION 2 — POST-CHECK (expect 0 rows)
-- =====================================================================

-- 2a) auth.users: any NULL in a column GoTrue cannot decode
WITH fillable AS (
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'auth' AND table_name = 'users'
    AND is_nullable = 'YES' AND is_generated = 'NEVER'
    AND column_name <> 'encrypted_password'
    AND (data_type IN ('text','character varying','boolean','smallint','integer','bigint','jsonb','uuid')
         OR (data_type LIKE 'timestamp%' AND column_name IN ('created_at','updated_at')))
)
SELECT u.id, u.email,
       (SELECT string_agg(t.key, ', ' ORDER BY t.key)
          FROM jsonb_each_text(to_jsonb(u)) AS t(key, value)
         WHERE t.value IS NULL AND t.key IN (SELECT column_name FROM fillable)) AS still_undecodable
FROM auth.users u
WHERE u.id IN (SELECT auth_user_id FROM public.employees WHERE auth_user_id IS NOT NULL)
  AND EXISTS (SELECT 1 FROM jsonb_each_text(to_jsonb(u)) AS t(key, value)
               WHERE t.value IS NULL AND t.key IN (SELECT column_name FROM fillable));

-- 2b) auth.identities: same check + the fields GoTrue needs present
WITH fillable AS (
  SELECT column_name FROM information_schema.columns
  WHERE table_schema = 'auth' AND table_name = 'identities'
    AND is_nullable = 'YES' AND is_generated = 'NEVER'
    AND (data_type IN ('text','character varying','boolean','smallint','integer','bigint','jsonb','uuid')
         OR (data_type LIKE 'timestamp%' AND column_name IN ('created_at','updated_at')))
)
SELECT u.email, i.id AS identity_id, i.provider_id, i.created_at, i.updated_at,
       (SELECT string_agg(t.key, ', ' ORDER BY t.key)
          FROM jsonb_each_text(to_jsonb(i)) AS t(key, value)
         WHERE t.value IS NULL AND t.key IN (SELECT column_name FROM fillable)) AS still_undecodable
FROM auth.users u
LEFT JOIN auth.identities i ON i.user_id = u.id
WHERE lower(u.email) IN (
        'desraj@eng.prokonhitech.com','pv@eng.prokonhitech.com',
        'ks@eng.prokonhitech.com','rs@eng.prokonhitech.com',
        'vc@eng.prokonhitech.com')
ORDER BY u.email;
-- Expect 5 rows, all with identity_id / provider_id / created_at / updated_at
-- populated and an EMPTY still_undecodable.

-- 2c) informational: benign NULLs that are EXPECTED to remain (pointers in GoTrue)
--     invited_at, confirmation_sent_at, email_change_sent_at, recovery_sent_at,
--     phone_change_sent_at, reauthentication_sent_at, banned_until, deleted_at,
--     phone_confirmed_at, last_sign_in_at -> all correct as NULL.


-- =====================================================================
-- SECTION 3 — PROOF (no SQL needed)
--   node scripts/diagnose-portal-logins.mjs 'desraj@eng.prokonhitech.com:<pw>'
--   expect: every check PASS, exit code 0.
--     auth: list users   -> 200, 14 users
--     auth: read user    -> 200 for all 5 engineers
--     auth: sign-in      -> 200 + session
-- =====================================================================

-- =====================================================================
-- SOURCE FIX — never create these rows from SQL again
--   scripts/provision-engineers.sql is LINK-ONLY now. Canonical path for a new
--   portal login is the GoTrue Admin API, which writes a complete row:
--     * in-app: Admin → Roles & Users → "Provision login"  (provisionEngineerLogin)
--     * script: scripts/create-users.mjs (Admin API, preserved UUIDs)
--   Rule codified as Prokon Erp coding standard STD-001 (never write the auth
--   schema from SQL); see docs/ENGINEER_PORTAL.md.
-- =====================================================================
