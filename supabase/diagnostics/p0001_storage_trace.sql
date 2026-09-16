-- supabase/diagnostics/p0001_storage_trace.sql
-- P0001 "database error" tracer for engineer-portal uploads to `ticket-attachments`.
--
-- HOW TO RUN (Supabase SQL editor on the LIVE project):
--   1. Open Dashboard > SQL editor on the LIVE project.
--   2. BEFORE running: find/replace every occurrence of '<TEST_ENG_EMAIL>' below
--      with the failing engineer's login email (keep the single quotes).
--      Occurrences live in seq 110, 111, 112, 114 (Section 2).
--   3. Paste this WHOLE file, press Run.
--   4. You get ONE result grid (seq, check, result) — copy ALL rows back.
--      (Single UNION ALL query on purpose: runners that show only the last
--      result set would otherwise hide every check but the final one.)
--   5. WHAT TO PASTE BACK: every row of the single grid, verbatim
--      (seq + check + result), plus the email you substituted.
--
-- NOTHING HERE WRITES. Catalog SELECTs only (pg_trigger / pg_proc /
-- pg_class / pg_policies / storage.buckets / information_schema),
-- has_table_privilege() probes, and COUNT(*) scans. No DDL, no
-- UPDATE/INSERT/DELETE, no supabase_migrations reference (that schema does
-- not exist on live), no aggregate over uuid (count(*), string_agg on text,
-- or exact joins only).
--
-- SEQ MAP: 100 triggers | 101 RLS flags | 102 policies | 103 policy-called
-- functions + RAISE | 104 bucket rows | 105 objects columns | 106-109
-- privilege probes | 110-114 engineer-link audit for '<TEST_ENG_EMAIL>'.

-- -- -- Section 1: storage tier (live-only raiser hunt) -- -- --

-- 100. Every trigger on storage.objects AND storage.buckets (one row per
-- trigger; empty = no triggers live, itself an answer). Def text carries
-- timing/event; func name + RAISE flag appended.
SELECT 100 AS seq,
       'storage triggers on objects/buckets (expect list; empty = none live)' AS check,
       (c.relname || '.' || t.tgname || ' :: ' || pg_get_triggerdef(t.oid) || ' :: func=' || p.proname || ' :: has_RAISE=' || CASE WHEN COALESCE(p.prosrc, '') LIKE '%RAISE%' THEN 'yes' ELSE 'no' END)::text AS result
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE ns.nspname = 'storage' AND c.relname IN ('objects', 'buckets')
UNION ALL
-- 101. RLS enforcement flags on storage.objects (single row; always present).
SELECT 101,
       'storage.objects RLS flags (rowsecurity/forcerowsecurity)',
       ('rowsecurity=' || c.relrowsecurity::text || ' forcerowsecurity=' || c.relforcerowsecurity::text)::text
FROM pg_class c
JOIN pg_namespace ns ON ns.oid = c.relnamespace
WHERE ns.nspname = 'storage' AND c.relname = 'objects'
UNION ALL
-- 102. Every policy on storage.objects scoped to the two buckets (one row
-- per policy; qual/with_check included so the bucket predicate is visible).
SELECT 102,
       'storage.objects policies for ticket-attachments/engineer-uploads',
       (pp.policyname || ' cmd=' || pp.cmd || ' roles=' || pp.roles::text || ' qual=' || COALESCE(pp.qual, '') || ' with_check=' || COALESCE(pp.with_check, ''))::text
FROM pg_policies pp
WHERE pp.schemaname = 'storage' AND pp.tablename = 'objects'
  AND (COALESCE(pp.qual, '') LIKE '%ticket-attachments%'
    OR COALESCE(pp.with_check, '') LIKE '%ticket-attachments%'
    OR COALESCE(pp.qual, '') LIKE '%engineer-uploads%'
    OR COALESCE(pp.with_check, '') LIKE '%engineer-uploads%'
    OR pp.policyname ILIKE '%ticket%'
    OR pp.policyname ILIKE '%engineer%')
UNION ALL
-- 103. For each public.* routine those bucket policies call: does its body
-- contain RAISE (the P0001 raiser candidate). Name-match against the
-- bucket-policy qual/with_check text from seq 102.
SELECT 103,
       'public functions called by bucket policies + RAISE flag (P0001 candidates)',
       (p.proname || ' has_RAISE=' || CASE WHEN COALESCE(p.prosrc, '') LIKE '%RAISE%' THEN 'yes' ELSE 'no' END)::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND EXISTS (
    SELECT 1 FROM pg_policies pp
    WHERE pp.schemaname = 'storage' AND pp.tablename = 'objects'
      AND (COALESCE(pp.qual, '') LIKE '%ticket-attachments%'
        OR COALESCE(pp.with_check, '') LIKE '%ticket-attachments%'
        OR COALESCE(pp.qual, '') LIKE '%engineer-uploads%'
        OR COALESCE(pp.with_check, '') LIKE '%engineer-uploads%'
        OR pp.policyname ILIKE '%ticket%'
        OR pp.policyname ILIKE '%engineer%')
      AND (COALESCE(pp.qual, '') LIKE '%' || p.proname || '%'
        OR COALESCE(pp.with_check, '') LIKE '%' || p.proname || '%')
  )
UNION ALL
-- 104. storage.buckets rows for both buckets (1-2 rows; missing row = bucket absent live).
SELECT 104,
       'storage.buckets rows (id, name, public, file_size_limit, allowed_mime_types, owner)',
       ('id=' || b.id::text || ' name=' || b.name::text || ' public=' || b.public::text || ' file_size_limit=' || b.file_size_limit::text || ' allowed_mime_types=' || b.allowed_mime_types::text || ' owner=' || b.owner::text)::text
FROM storage.buckets b
WHERE b.id IN ('ticket-attachments', 'engineer-uploads')
UNION ALL
-- 105. storage.objects column inventory (one row per column).
SELECT 105,
       'storage.objects columns (column_name + data_type)',
       (col.column_name || ' ' || col.data_type)::text
FROM information_schema.columns col
WHERE col.table_schema = 'storage' AND col.table_name = 'objects'
UNION ALL
-- 106-109. Privilege probes on storage.objects (4 single rows).
SELECT 106,
       'probe: authenticated INSERT on storage.objects',
       has_table_privilege('authenticated', 'storage.objects', 'INSERT')::text
UNION ALL
SELECT 107,
       'probe: authenticated SELECT on storage.objects',
       has_table_privilege('authenticated', 'storage.objects', 'SELECT')::text
UNION ALL
SELECT 108,
       'probe: service_role INSERT on storage.objects',
       has_table_privilege('service_role', 'storage.objects', 'INSERT')::text
UNION ALL
SELECT 109,
       'probe: service_role SELECT on storage.objects',
       has_table_privilege('service_role', 'storage.objects', 'SELECT')::text
UNION ALL
-- -- -- Section 2: engineer-link audit (substitute '<TEST_ENG_EMAIL>' first) -- -- --
-- 110. Employees row exists for the test email (count-form; 0 = unknown email).
SELECT 110,
       'employees row exists for test email (expect 1)',
       count(*)::text
FROM public.employees
WHERE email = '<TEST_ENG_EMAIL>'
UNION ALL
-- 111. auth_user_id linkage for that employee (string_agg on text; 'no row / NULL' when unlinked).
SELECT 111,
       'employees auth_user_id linked (expect uuid; NULL = unlinked)',
       COALESCE(string_agg(auth_user_id::text, ', '), 'no row / NULL')
FROM public.employees
WHERE email = '<TEST_ENG_EMAIL>'
UNION ALL
-- 112. app_users row dump for the test email (full row as JSON so whatever
-- status/role/active columns exist live are visible without naming them).
SELECT 112,
       'app_users row for test email incl status/role/active (expect row)',
       COALESCE(string_agg(to_jsonb(u)::text, ' | '), 'no app_users row')
FROM public.app_users u
WHERE u.email = '<TEST_ENG_EMAIL>'
UNION ALL
-- 113. app_users column inventory (so the real status/role/active column names are on record).
SELECT 113,
       'app_users columns (column_name + data_type)',
       (col.column_name || ' ' || col.data_type)::text
FROM information_schema.columns col
WHERE col.table_schema = 'public' AND col.table_name = 'app_users'
UNION ALL
-- 114. Assigned-ticket count for that engineer via assigned_employee_id exact join (expect >=0).
SELECT 114,
       'assigned tickets via assigned_employee_id (count)',
       count(*)::text
FROM public.tickets t
WHERE t.assigned_employee_id IN (SELECT e.id FROM public.employees e WHERE e.email = '<TEST_ENG_EMAIL>')
ORDER BY 1, 2, 3;
