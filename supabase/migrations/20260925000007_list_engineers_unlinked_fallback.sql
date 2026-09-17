-- Migration: 20260925000007_list_engineers_unlinked_fallback.sql
-- Purpose: make list_engineers() also return ACTIVE engineers who were never
--   linked to a portal login (employees.auth_user_id IS NULL), flagged with a
--   new `link_status` annotation ('linked' / 'unlinked'), so the Engineers
--   admin module no longer hides them.
--
-- WHAT WAS BROKEN:
--   list_engineers() (20260925000001 §6) required
--     public.is_field_engineer(e.auth_user_id)
--   and is_field_engineer() only matches app_users rows with the Engineer
--   role for a concrete user_id. An active engineer whose auth_user_id link
--   was never backfilled (provisioning / 20260925000003 documents the same
--   link gap for conveyance reads) evaluates to false and is invisible to
--   the admin module — rates/settlements cannot be managed for them.
--
-- PREDICATE CHOSEN + WHY:
--   Fallback leg (OR-ed, active-only):
--     e.auth_user_id IS NULL
--     AND (e.role ILIKE '%engineer%' OR e.department ILIKE '%engineer%')
--   Investigation: employees has NO designation column. The closest field is
--   `role` — free text labelled "Role / Designation" in the import UI
--   (src/routes/_app/import.tsx, example 'Service Engineer'); `department`
--   is the second free-text descriptor. Both legs require the literal
--   substring 'engineer', so office staff (role 'Admin' / 'Accounts' per live
--   backups) cannot match unless their own row literally says engineer — in
--   which case inclusion is defensible, admin-gated, and visibly flagged.
--
-- ASSUMPTIONS / LIMITATIONS (flagged):
--   1) The 5 provisioned Service Engineers are expected to carry 'engineer'
--      in role (or department). If a live engineer row has role/department
--      NULL or a non-matching value (e.g. 'technician' as in the historical
--      seed test), this fallback still misses them — by design we do NOT
--      guess wider (e.g. include ALL unlinked actives: would sweep office
--      staff into the roster). Report query in VERIFY below lists exactly
--      those invisible rows for manual role cleanup.
--   2) `link_status` is advisory: 'linked' = has auth_user_id (and passed
--      is_field_engineer); 'unlinked' = fallback leg. Admins should treat
--      'unlinked' rows as "provision a login" candidates, not as verified
--      portal users.
--   3) Added `e.active = true`: the prior body had NO active filter, so
--      inactive linked engineers were listed. They are now excluded (matches
--      get_assignable_engineers semantics). Flagging as an intentional
--      behaviour change.
--   4) Return signature gains one column (link_status). Additive for
--      `SELECT *` callers; explicit-column callers (useEngineerAdmin) are
--      unaffected. No app-code change in this migration.
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste this file → Run,
--      or: `supabase db push` from the repo root.
--   2) Verify: the post-condition block at the end RAISES on any miss, so a
--      clean apply IS the verification. Then reload the PostgREST schema
--      cache (NOTIFY pgrst, 'reload schema') before retesting the app.
--
-- PRE-FLIGHT (read-only — confirms the DROP cannot hit a dependent object).
--   Expect ZERO rows. If it returns a row, STOP: that object depends on
--   list_engineers() and the DROP below will fail with
--   "cannot drop function ... because other objects depend on it".
--   SELECT dependent_ns.nspname AS schema, dependent.relname AS dependent_object
--     FROM pg_depend d
--     JOIN pg_proc p ON p.oid = d.refobjid
--     JOIN pg_namespace pn ON pn.oid = p.pronamespace
--     LEFT JOIN pg_class dependent ON dependent.oid = d.objid
--     LEFT JOIN pg_namespace dependent_ns ON dependent_ns.oid = dependent.relnamespace
--    WHERE pn.nspname = 'public'
--      AND p.proname = 'list_engineers'
--      AND d.deptype IN ('n', 'a')
--      AND dependent.relname IS NOT NULL;
--
-- VERIFY (read-only — safe to run any time):
--   SELECT * FROM public.list_engineers() ORDER BY name;
--   -- expect: previously-listed linked engineers (link_status='linked') PLUS
--   -- active unlinked engineer-role rows (link_status='unlinked').
--   -- Still-invisible actives (role/dept lack 'engineer' — manual cleanup):
--   SELECT id, name, role, department, email
--     FROM public.employees
--    WHERE active = true
--      AND auth_user_id IS NULL
--      AND NOT (COALESCE(role,'') ILIKE '%engineer%'
--            OR COALESCE(department,'') ILIKE '%engineer%');
--
-- NOTES:
-- - Idempotent: DROP FUNCTION IF EXISTS + CREATE (apply-twice is clean — the
--   second run drops the 8-column version and recreates it identically).
--   DROP FUNCTION is REQUIRED here because the OUT-parameter row type changes
--   (7 → 8 columns); CREATE OR REPLACE alone raises 42P13. This file does NOT
--   use CREATE OR REPLACE for list_engineers — that is intentional.
--   Admin gate (has_role admin) is load-bearing — SECURITY DEFINER bypasses
--   RLS, non-admins still get zero rows.
-- - DROP FUNCTION discards the EXECUTE grant, so section 2 re-asserts it.
--   No CASCADE: a dependent object must fail loudly, never be dropped silently.
-- - `role` / `department` exist since the base employees definition, so no
--   information_schema column guard is needed; NULLs are handled by ILIKE
--   three-valued logic (NULL ILIKE … → NULL → row excluded, fail-safe).
--
-- Safety assertion (executable SQL): this file contains zero DELETE FROM /
--   TRUNCATE / DROP TABLE / DROP COLUMN. The single DROP FUNCTION IF EXISTS
--   below removes a function definition only (no table rows) and is
--   immediately recreated in the same script; the ROLLBACK statements below
--   appear only inside comments and never execute.
--
-- ROLLBACK (comments only — run manually, in this order, if reverting):
--   -- Restore 20260925000001 §6 verbatim (linked-only, no link_status).
--   -- DROP is required again: reverting also changes the OUT-parameter type.
--   DROP FUNCTION IF EXISTS public.list_engineers();
--   CREATE FUNCTION public.list_engineers()
--   RETURNS TABLE (employee_id uuid, name text, phone text, email text,
--     active boolean, auth_user_id uuid, photo_path text)
--   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
--   AS $$ SELECT e.id, e.name, e.phone, e.email, e.active, e.auth_user_id,
--     e.photo_path FROM public.employees e
--     WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
--       AND public.is_field_engineer(e.auth_user_id); $$;
--   GRANT EXECUTE ON FUNCTION public.list_engineers() TO authenticated;
--   (Then NOTIFY pgrst, 'reload schema'. The app treats link_status as
--   optional, so the badge simply stops rendering after a revert.)

-- =====================================================================
-- 1) list_engineers(): linked-field-engineer leg OR (unlinked AND
--    engineer-role/department leg), active-only, with link_status.
--
--    DROP IS REQUIRED (not cosmetic): the return type changes from 7 to 8
--    OUT columns, and CREATE OR REPLACE cannot change a function's return
--    type (42P13 "cannot change return type of existing function"). This is
--    the sequence 20260925000001's own ROLLBACK block already uses for this
--    exact function. DROP FUNCTION is NOT in the banned list (no row data is
--    touched); it does drop the EXECUTE grant, which section 2 re-asserts.
--    Deliberately NO CASCADE: if some object depends on this function we want
--    a loud failure naming it, not silent collateral drops.
-- =====================================================================
DROP FUNCTION IF EXISTS public.list_engineers();

CREATE FUNCTION public.list_engineers()
RETURNS TABLE (
  employee_id uuid,
  name text,
  phone text,
  email text,
  active boolean,
  auth_user_id uuid,
  photo_path text,
  link_status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    e.id AS employee_id,
    e.name,
    e.phone,
    e.email,
    e.active,
    e.auth_user_id,
    e.photo_path,
    CASE WHEN e.auth_user_id IS NULL THEN 'unlinked' ELSE 'linked' END AS link_status
  FROM public.employees e
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND e.active = true
    AND (
      public.is_field_engineer(e.auth_user_id)
      OR (
        e.auth_user_id IS NULL
        AND (
          e.role ILIKE '%engineer%'
          OR e.department ILIKE '%engineer%'
        )
      )
    );
$$;

-- =====================================================================
-- 2) GRANTs (mirrors 20260925000001 §8: role-guarded; a missing role on a
--    bare scratch cluster must NOTICE-skip, never abort. CREATE OR REPLACE
--    already preserves existing grants — this re-asserts them.)
-- =====================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.list_engineers() TO authenticated;
  ELSE
    RAISE NOTICE 'skipping function grant: role authenticated missing';
  END IF;
END $$;

-- =====================================================================
-- 3) Post-conditions: function exists with the link_status column, the
--    unlinked fallback leg is present, and the admin gate survived.
--    Anything missing RAISES (loud) instead of a silent NOTICE.
-- =====================================================================
DO $$ DECLARE
  missing text[] := '{}';
  fndef text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'list_engineers') THEN
    missing := missing || 'function list_engineers';
  ELSE
    SELECT pg_get_functiondef(p.oid) INTO fndef FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'list_engineers' LIMIT 1;
    IF position('link_status' in fndef) = 0 THEN
      missing := missing || 'function list_engineers missing link_status column';
    END IF;
    IF position('auth_user_id IS NULL' in fndef) = 0 THEN
      missing := missing || 'function list_engineers missing unlinked fallback leg';
    END IF;
    IF position('is_field_engineer' in fndef) = 0 THEN
      missing := missing || 'function list_engineers lost linked is_field_engineer leg';
    END IF;
    IF position('has_role' in fndef) = 0 THEN
      missing := missing || 'function list_engineers lost admin gate';
    END IF;
  END IF;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'Migration 20260925000007 post-conditions FAILED: %', array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE 'Migration 20260925000007 post-conditions OK';
END $$;

-- =====================================================================
-- 4) PostgREST schema reload — MANDATORY here (unlike a body-only change):
--    the function's OUT-parameter row type changed (7 → 8 columns), and
--    PostgREST caches the RPC result shape. Without this, the API keeps
--    serving the old shape and the app's link_status column reads null.
--    Executable by design (precedent: 20260924000001_fix_advisory_lock_
--    overload_collision.sql:105); NOTIFY is a signal, not a data write.
-- =====================================================================
NOTIFY pgrst, 'reload schema';
