-- supabase/diagnostics/p0001_storage_trace.sql
-- P0001 "database error" tracer for engineer-portal uploads to `ticket-attachments`.
--
-- HOW TO RUN (Supabase SQL editor on the LIVE project):
--   1. Open Dashboard > SQL editor on the LIVE project.
--   2. BEFORE running: find/replace every occurrence of '<TEST_ENG_EMAIL>' below
--      with the failing engineer's login email (keep the single quotes).
--      Occurrences live in seq 110, 111, 112, 114 (Section 2).
--      Seq 115-116 are substitution-free fallbacks (recent rows) — no edit needed.
--   3. Paste this WHOLE file, press Run.
--   4. You get ONE result grid (seq, check, result) — copy ALL rows back.
--      (Single UNION ALL query on purpose: runners that show only the last
--      result set would otherwise hide every check but the final one.)
--   5. WHAT TO PASTE BACK: every row of the single grid, verbatim
--      (seq + check + result), plus the email you substituted.
--
-- NOTHING HERE WRITES. Catalog SELECTs only (pg_trigger / pg_proc /
-- pg_class / pg_policies / pg_tables / pg_attrdef / pg_attribute /
-- pg_constraint / storage.buckets / information_schema),
-- has_table_privilege() probes, and COUNT(*) scans. No DDL, no
-- UPDATE/INSERT/DELETE, no supabase_migrations reference (that schema does
-- not exist on live), no aggregate over uuid (count(*), string_agg on text,
-- or exact joins only).
--
-- SEQ MAP: 100 triggers | 101 RLS flags | 102 policies | 103 policy-called
-- functions + RAISE | 104 bucket rows | 105 objects columns | 106-109
-- privilege probes | 110-114 engineer-link audit for '<TEST_ENG_EMAIL>' |
-- 115-116 recent-row fallbacks (no substitution) | 120 storage RAISE
-- inventory | 121 triggers on other storage tables | 122 version/multipart
-- tables | 123 defaults, 124 generated/nullable, 125 checks/not-null.

-- -- -- Section 1: storage tier (live-only raiser hunt) -- -- --

-- 100. Every trigger on storage.objects AND storage.buckets (one row per
-- trigger; empty = no triggers live, itself an answer). Def text carries
-- timing/event; func name + RAISE flag appended.
SELECT 100 AS seq,
       'storage triggers on objects/buckets (expect list; empty = none live)' AS check,
       (c.relname || '.' || t.tgname || ' :: ' || pg_get_triggerdef(t.oid) || ' :: func=' || p.proname || ' :: has_RAISE=' || CASE WHEN COALESCE(p.prosrc, pg_get_functiondef(p.oid), '') LIKE '%RAISE%' THEN 'yes' ELSE 'no' END)::text AS result
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
       (p.proname || ' has_RAISE=' || CASE WHEN COALESCE(p.prosrc, pg_get_functiondef(p.oid), '') LIKE '%RAISE%' THEN 'yes' ELSE 'no' END)::text
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
-- Schema-proof: whole row as jsonb — survives owner vs owner_id drift across
-- storage releases (a hardcoded column list would ERROR the entire tracer).
SELECT 104,
       'storage.buckets rows (full row as json — schema-proof)',
       to_jsonb(b)::text
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
UNION ALL
-- -- -- Section 2b: substitution-free fallbacks (signal even when '<TEST_ENG_EMAIL>' is untouched) -- -- --
-- 115. Five most recent employees rows (full row as json; id-ordered, schema-proof).
-- Parenthesised so its own ORDER BY/LIMIT applies to this branch only.
(SELECT 115,
       'employees 5 most recent (full row as json — no substitution needed)',
       to_jsonb(e)::text
FROM public.employees e
ORDER BY e.id DESC LIMIT 5)
UNION ALL
-- 116. Five most recent app_users rows (full row as json; created_at proven live by seq 113).
(SELECT 116,
       'app_users 5 most recent (full row as json — no substitution needed)',
       to_jsonb(u)::text
FROM public.app_users u
ORDER BY u.created_at DESC LIMIT 5)
UNION ALL
-- -- -- Section 3: unchecked storage surfaces (v1 cleared objects/buckets triggers+policies+privileges) -- -- --
-- 120. Prime-suspect inventory: EVERY storage-schema function whose body
-- contains RAISE (one row per function; schema.name + 200-char excerpt
-- around the FIRST RAISE via strpos/substring; empty = no raiser in storage).
SELECT 120,
       'storage functions containing RAISE (schema.name + 200-char excerpt around first RAISE)',
       (n.nspname || '.' || p.proname || ' :: excerpt=' || substring(COALESCE(p.prosrc, pg_get_functiondef(p.oid), '') from GREATEST(strpos(COALESCE(p.prosrc, pg_get_functiondef(p.oid), ''), 'RAISE') - 50, 1) for 200))::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'storage'
  AND COALESCE(p.prosrc, pg_get_functiondef(p.oid), '') LIKE '%RAISE%'
UNION ALL
-- 121. Triggers on ALL storage-schema tables EXCEPT objects/buckets (table
-- named per row; timing/event via pg_get_triggerdef; owning func + RAISE
-- flag; expect rows for s3_multipart_uploads/_parts if triggers exist there).
SELECT 121,
       'storage triggers on tables OTHER than objects/buckets (table.trigger :: def :: func :: has_RAISE)',
       (c.relname || '.' || t.tgname || ' :: ' || pg_get_triggerdef(t.oid) || ' :: func=' || p.proname || ' :: has_RAISE=' || CASE WHEN COALESCE(p.prosrc, pg_get_functiondef(p.oid), '') LIKE '%RAISE%' THEN 'yes' ELSE 'no' END)::text
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE ns.nspname = 'storage'
  AND c.relname NOT IN ('objects', 'buckets')
UNION ALL
-- 122. Storage tables matching %version% / %multipart% / %iceberg%
-- (schemaname.tablename from pg_tables; expect >=1 row on versioned-objects releases).
SELECT 122,
       'storage tables matching %version%/%multipart%/%iceberg% (schemaname.tablename)',
       (t.schemaname || '.' || t.tablename)::text
FROM pg_tables t
WHERE t.schemaname = 'storage'
  AND (t.tablename LIKE '%version%' OR t.tablename LIKE '%multipart%' OR t.tablename LIKE '%iceberg%')
UNION ALL
-- 123a. Column defaults on storage.objects, verbatim via pg_attrdef/pg_get_expr
-- (one row per defaulted column; any storage.*/public.* call shows verbatim).
SELECT 123,
       'storage.objects column defaults (column + pg_attrdef expr verbatim)',
       (a.attname || ' default=' || pg_get_expr(d.adbin, d.adrelid))::text
FROM pg_attrdef d
JOIN pg_class c ON c.oid = d.adrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
WHERE ns.nspname = 'storage' AND c.relname = 'objects'
UNION ALL
-- 123b. Generated expressions + nullability per column via information_schema
-- (one row per column; generated=<none> when not generated).
SELECT 124,
       'storage.objects generated/nullable (column + default/generated/nullable)',
       (col.column_name || ' default=' || COALESCE(col.column_default, '<none>') || ' generated=' || COALESCE(col.is_generated, '<none>') || ' nullable=' || col.is_nullable)::text
FROM information_schema.columns col
WHERE col.table_schema = 'storage' AND col.table_name = 'objects'
UNION ALL
-- 123c. NOT NULL / CHECK constraints on storage.objects, verbatim via
-- pg_get_constraintdef (one row per constrained column; <table> when
-- table-level; any storage.*/public.* call shows verbatim).
SELECT 125,
       'storage.objects check/not-null constraints (column + pg_constraintdef verbatim)',
       (COALESCE(a.attname, '<table>') || ' ' || con.contype::text || ' ' || con.conname || ' expr=' || pg_get_constraintdef(con.oid))::text
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = c.relnamespace
LEFT JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY (con.conkey)
WHERE ns.nspname = 'storage' AND c.relname = 'objects'
  AND con.contype IN ('c', 'n')
ORDER BY 1, 2, 3;
