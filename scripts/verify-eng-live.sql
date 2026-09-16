-- scripts/verify-eng-live.sql
-- Read-only post-apply verification for the engineering-module migrations.
--
-- HOW TO RUN (Supabase SQL editor):
--   1. Open the Supabase dashboard SQL editor on the LIVE project.
--   2. Paste this WHOLE file, press Run.
--   3. You get ONE result grid (seq, check, result) — copy ALL rows.
--      (Single UNION ALL query on purpose: runners that show only the last
--      result set would otherwise hide every check but the final one.)
--   4. NOTHING here writes: only SELECTs against catalog views
--      (pg_policies / pg_constraint / pg_enum / information_schema),
--      has_table_privilege() probes, and COUNT(*) residue scans. No DDL,
--      no UPDATE/INSERT/DELETE, no SET that persists.
--
-- EXPECTED vs ACTION (per check label):
--   label                                                        | must show | if not, do this
--   -------------------------------------------------------------|-----------|-----------------------------------------------
--   duplicate 12000001 versions                                  | Dashboard | no tracking schema on live — confirm via Dashboard > Database > Migrations
--   hardened version 12000002                                   | Dashboard | same as above
--   anon INSERT policy on storage.objects                        | 0         | Wave-0 hole open — apply 20260922000001
--   storage INSERT policies                                      | auth rows | apply 20260922000001/22000002, re-check
--   hardened tcv policies present                                | rows      | apply 20260912000002
--   grant: authenticated INSERT on field_service_reports         | true      | apply 20260922000002
--   enum ims_transfer_status has cancelled                       | 1         | apply 20260922000003
--   backfill residue: unmatched / ambiguous                      | 0 / 0     | A3 data task — link/fix names; A5 GATE: do NOT apply name-fallback removal while >0 without user sign-off
--   tickets fully unassigned (NULL/NULL)                         | any       | info — assignment data task, not a migration incident
--   engineers with NULL auth_user_id                             | 0 (*)     | identity-link data task; (*) some unlinked service rows may be intentional — confirm with admin
--   constraint validation status (6 rows)                        | all true  | A4 data task — run the report query from the matching migration NOTICE, fix rows, re-run migration
--   orphan counts (3 FK checks)                                  | 0         | same as above — orphan rows block VALIDATE by design (never fails the push)
--   CHECK violation counts (3 checks)                            | 0         | same as above
--   RLS FK-only (5 checks)                                       | FK-only   | 'STILL HAS name leg' = apply 20260923000003; 'MISSING!' = policy absent entirely
--   engineer-uploads SELECT count                                | >=1       | owned by 20260922000004 — re-apply it, never hand-edit storage.objects (needs supabase_storage_admin)
--   grn/dc columns on tickets                                    | absent/list | 'absent' before B1 ships; column list after
--   grn/dc FK validation                                         | no rows pre-B1; rows+true after | B1 data task once 20260923000004 exists
--   M1 stock RPC guards (3 rows)                                 | 3 guarded | apply 20260923000005; a missing row = overload unguarded
--   M3/M4 reads scoped (2 rows)                                  | scoped    | 'PERMISSIVE!' = apply 20260923000007
--   M6 history INSERT admin-only                                 | admin-only| otherwise apply 20260923000007
--   storage SELECT engineer-uploads count (owns 20260922000004)   | >=1       | re-apply 20260922000004, never hand-edit storage.objects (needs supabase_storage_admin)
--   storage INSERT ticket-attachments inventory                   | rows      | apply 20260922000004, re-check
--   storage.buckets both buckets                                  | 2 rows    | apply 20260922000004, re-check id/name/public/limit
--   storage.objects force RLS flag                                | false     | drift — 20260922000004 owns storage.objects state, re-apply it, never ALTER by hand
--   storage.objects user triggers                                 | 0         | drift — drop the trigger, re-apply 20260922000004 if policies changed
--   20260923000004 grn/dc columns present                         | 2         | apply 20260923000004 (B1)
--   20260923000008 password functions present                     | 2         | apply 20260923000008
--   password fn proconfig search_path                             | public, extensions | apply 20260923000008, never ALTER FUNCTION by hand
--
-- Every check emits exactly >=1 row EXCEPT: grn/dc FK rows (absent before B1
-- ships — expected) and tcv/storage multi-row lists (one row per policy).

-- -- -- A2 apply-state (from ENGINEER_VERIFICATION.md section 0, verbatim core) -- -- --

SELECT 1 AS seq,
       'duplicate 12000001 versions (see Dashboard > Migrations)' AS check,
       'NOT CHECKABLE IN SQL — no supabase_migrations schema on live' AS result
UNION ALL
SELECT 2,
       'hardened version 12000002 applied (see Dashboard > Migrations)',
       'NOT CHECKABLE IN SQL — no supabase_migrations schema on live'
UNION ALL
-- 3. Anon storage hole closed (expect 0)
SELECT 3,
       'anon INSERT policy on storage.objects (expect 0)',
       count(*)::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname = 'Public can upload ticket attachments'
UNION ALL
-- 4. Authenticated INSERT remains, anon gone (one row per INSERT policy)
SELECT 4,
       'storage INSERT policies (expect authenticated only, no anon)',
       policyname || ' roles=' || roles::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'INSERT'
UNION ALL
-- 5. Hardened verification policies in force (one row per policy)
SELECT 5,
       'hardened tcv policies present (expect rows)',
       policyname
FROM pg_policies WHERE tablename = 'ticket_customer_verifications'
UNION ALL
-- 6. Engineer tables granted (expect true)
SELECT 6,
       'grant: authenticated INSERT on field_service_reports (expect true)',
       has_table_privilege('authenticated', 'public.field_service_reports', 'INSERT')::text
UNION ALL
-- 7. cancelled enum value present (expect 1; count-form so a missing value still prints a row)
SELECT 7,
       'enum ims_transfer_status has cancelled (expect 1)',
       count(*)::text
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'ims_transfer_status' AND e.enumlabel = 'cancelled'
UNION ALL
-- -- -- A3 backfill residue (20260923000001 gate diagnostic; A5 ships only when 0/0) -- -- --
-- 8. Unmatched: FK still NULL, name matches NO employee (expect 0)
SELECT 8,
       'backfill residue: unmatched name (expect 0, A3/A5 gate)',
       count(*)::text
FROM public.tickets t
WHERE t.assigned_employee_id IS NULL
  AND t.assigned_engineer_name IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.name = t.assigned_engineer_name)
UNION ALL
-- 9. Ambiguous: FK still NULL, name matches >1 employee (expect 0, never auto-guessed)
SELECT 9,
       'backfill residue: ambiguous name (expect 0, A3/A5 gate)',
       count(*)::text
FROM public.tickets t
WHERE t.assigned_employee_id IS NULL
  AND t.assigned_engineer_name IS NOT NULL
  AND (SELECT count(*) FROM public.employees e WHERE e.name = t.assigned_engineer_name) > 1
UNION ALL
-- 10. Fully unassigned (info only)
SELECT 10,
       'tickets fully unassigned NULL/NULL (info only)',
       count(*)::text
FROM public.tickets t
WHERE t.assigned_employee_id IS NULL AND t.assigned_engineer_name IS NULL
UNION ALL
-- 11. Identity link gap (expect 0; confirm intentional service rows with admin)
SELECT 11,
       'engineers with NULL auth_user_id (expect 0)',
       count(*)::text
FROM public.employees WHERE auth_user_id IS NULL
UNION ALL
-- -- -- A4 constraint validation status (20260923000002: six NOT VALID -> VALIDATE) -- -- --
-- 12. Validation flags (expect convalidated = true on all six; one row per constraint)
SELECT 12,
       'constraint validation status (expect true)',
       conname || '=' || convalidated::text
FROM pg_constraint
WHERE conname IN ('fk_tickets_assigned_employee', 'fk_tah_assigned_by',
                  'fk_employees_auth_user', 'chk_ticket_visits_departure_after_arrival',
                  'chk_tah_time_order', 'chk_daily_logs_odometer_nonneg')
UNION ALL
-- 13-15. Orphan FK counts (expect 0; any orphan blocks VALIDATE by design)
SELECT 13,
       'orphan fk_tickets_assigned_employee (expect 0)',
       count(*)::text
FROM public.tickets t LEFT JOIN public.employees e ON e.id = t.assigned_employee_id
WHERE t.assigned_employee_id IS NOT NULL AND e.id IS NULL
UNION ALL
SELECT 14,
       'orphan fk_tah_assigned_by (expect 0)',
       count(*)::text
FROM public.ticket_assignment_history h LEFT JOIN auth.users u ON u.id = h.assigned_by
WHERE h.assigned_by IS NOT NULL AND u.id IS NULL
UNION ALL
SELECT 15,
       'orphan fk_employees_auth_user (expect 0)',
       count(*)::text
FROM public.employees e LEFT JOIN auth.users u ON u.id = e.auth_user_id
WHERE e.auth_user_id IS NOT NULL AND u.id IS NULL
UNION ALL
-- 16-18. CHECK violation counts (expect 0)
SELECT 16,
       'violations chk_ticket_visits_departure_after_arrival (expect 0)',
       count(*)::text
FROM public.ticket_visits
WHERE departure_at IS NOT NULL AND arrival_at IS NOT NULL AND departure_at < arrival_at
UNION ALL
SELECT 17,
       'violations chk_tah_time_order (expect 0)',
       count(*)::text
FROM public.ticket_assignment_history
WHERE assigned_at IS NULL OR (unassigned_at IS NOT NULL AND unassigned_at < assigned_at)
UNION ALL
SELECT 18,
       'violations chk_daily_logs_odometer_nonneg (expect 0)',
       count(*)::text
FROM public.engineer_daily_logs
WHERE (morning_odometer IS NOT NULL AND morning_odometer < 0)
   OR (evening_odometer IS NOT NULL AND evening_odometer < 0)
UNION ALL
-- -- -- A5 RLS name-fallback removal (20260923000003: policies FK-only) -- -- --
-- 19-23. Driver-join so a MISSING policy prints 'MISSING!' instead of vanishing.
SELECT 19,
       'RLS FK-only: auth view tickets (expect FK-only)',
       CASE WHEN p.policyname IS NULL THEN 'MISSING!'
            WHEN p.qual LIKE '%assigned_engineer_name%' OR COALESCE(p.with_check, '') LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END
FROM (VALUES ('auth view tickets', 'tickets')) v(policyname, tablename)
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = v.tablename AND p.policyname = v.policyname
UNION ALL
SELECT 20,
       'RLS FK-only: auth update tvis (expect FK-only)',
       CASE WHEN p.policyname IS NULL THEN 'MISSING!'
            WHEN p.qual LIKE '%assigned_engineer_name%' OR COALESCE(p.with_check, '') LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END
FROM (VALUES ('auth update tvis', 'ticket_visits')) v(policyname, tablename)
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = v.tablename AND p.policyname = v.policyname
UNION ALL
SELECT 21,
       'RLS FK-only: auth update tcv (expect FK-only)',
       CASE WHEN p.policyname IS NULL THEN 'MISSING!'
            WHEN p.qual LIKE '%assigned_engineer_name%' OR COALESCE(p.with_check, '') LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END
FROM (VALUES ('auth update tcv', 'ticket_customer_verifications')) v(policyname, tablename)
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = v.tablename AND p.policyname = v.policyname
UNION ALL
SELECT 22,
       'RLS FK-only: auth update tev (expect FK-only)',
       CASE WHEN p.policyname IS NULL THEN 'MISSING!'
            WHEN p.qual LIKE '%assigned_engineer_name%' OR COALESCE(p.with_check, '') LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END
FROM (VALUES ('auth update tev', 'ticket_equipment_verifications')) v(policyname, tablename)
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = v.tablename AND p.policyname = v.policyname
UNION ALL
SELECT 23,
       'RLS FK-only: auth select assignment_history (expect FK-only)',
       CASE WHEN p.policyname IS NULL THEN 'MISSING!'
            WHEN p.qual LIKE '%assigned_engineer_name%' OR COALESCE(p.with_check, '') LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END
FROM (VALUES ('auth select assignment_history', 'ticket_assignment_history')) v(policyname, tablename)
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = v.tablename AND p.policyname = v.policyname
UNION ALL
-- 24. engineer-uploads SELECT untouched (owned by 20260922000004; count-form so absence still prints)
SELECT 24,
       'engineer-uploads SELECT present, untouched (expect >=1)',
       count(*)::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
  AND policyname ILIKE '%engineer%'
UNION ALL
-- -- -- B1 grn_id/dc_id FK (20260923000004 — guarded: reports n/a until the columns exist) -- -- --
-- 25. Column presence ('absent' before B1 ships, column list after)
SELECT 25,
       'grn/dc columns on tickets (absent before B1)',
       COALESCE(string_agg(column_name, ', '), 'absent')
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name IN ('grn_id', 'dc_id')
UNION ALL
-- 26. Any ticket-FK constraint mentioning grn/dc + its validation flag (no rows before B1 — expected)
SELECT 26,
       'grn/dc FK validation on tickets (no rows before B1)',
       conname || '=' || convalidated::text
FROM pg_constraint
WHERE conrelid = 'public.tickets'::regclass
  AND (conname ILIKE '%grn%' OR conname ILIKE '%dc%')
UNION ALL
-- -- -- M-batch (20260923000005-08): guard + scope checks -- -- --
-- 27. M1: all three stock RPCs carry the entry guard (expect 3 'guarded' rows; a missing row = unguarded overload live)
SELECT 27,
       'M1 stock RPC guards present (expect 3 guarded rows)',
       p.proname || '=' || CASE WHEN p.prosrc LIKE '%Only stock editors may call%' THEN 'guarded' ELSE 'UNGUARDED!' END
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('ims_add_qty', 'ims_deduct_qty', 'invoice_cancel_restore_pooled')
UNION ALL
-- 28. M3/M4: timeline + visits SELECT scoped to assigned (expect 2 'scoped' rows)
SELECT 28,
       'M3/M4 reads scoped (expect scoped)',
       v.policyname || '=' || CASE WHEN p.policyname IS NULL THEN 'MISSING!'
            WHEN p.qual LIKE '%assigned_employee_id%' THEN 'scoped' ELSE 'PERMISSIVE!' END
FROM (VALUES ('auth view tact', 'ticket_activities'), ('auth view ticket_visits', 'ticket_visits')) v(policyname, tablename)
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = v.tablename AND p.policyname = v.policyname
UNION ALL
-- 29. M6: assignment-history INSERT admin-only (expect admin-only)
SELECT 29,
       'M6 history INSERT admin-only (expect admin-only)',
       CASE WHEN p.policyname IS NULL THEN 'MISSING!'
            WHEN p.with_check LIKE '%has_role%' AND p.with_check NOT LIKE '%has_permission%' THEN 'admin-only' ELSE 'NOT-TIGHTENED!' END
FROM (VALUES ('auth insert assignment_history', 'ticket_assignment_history')) v(policyname, tablename)
LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = v.tablename AND p.policyname = v.policyname
UNION ALL
-- -- -- Task E storage-tier drift (20260922000004 owns ALL storage.objects state; never hand-edit) -- -- --
-- 30. engineer-uploads SELECT count (expect >=1; count-form so absence still prints a row)
SELECT 30,
       'storage SELECT engineer-uploads owned by 20260922000004 (expect >=1, never hand-edit)',
       count(*)::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
  AND (policyname ILIKE '%engineer%' OR qual LIKE '%engineer-uploads%')
UNION ALL
-- 31. ticket-attachments INSERT inventory (one row per policy; no rows = 20260922000004 missing)
SELECT 31,
       'storage INSERT ticket-attachments policies (expect rows)',
       policyname || ' roles=' || roles::text
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'INSERT'
  AND (policyname ILIKE '%ticket%' OR qual LIKE '%ticket-attachments%' OR COALESCE(with_check, '') LIKE '%ticket-attachments%')
UNION ALL
-- 32. Both buckets present with flags (one row per bucket; expect 2 rows)
SELECT 32,
       'storage.buckets both buckets (expect 2 rows)',
       'id=' || id || ' name=' || name || ' public=' || public::text || ' limit=' || COALESCE(file_size_limit::text, 'NULL')
FROM storage.buckets
WHERE id IN ('engineer-uploads', 'ticket-attachments')
UNION ALL
-- 33. Force-RLS off so storage admins bypass (expect false)
SELECT 33,
       'storage.objects force RLS (expect false)',
       relforcerowsecurity::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'storage' AND c.relname = 'objects'
UNION ALL
-- 34. No user triggers on storage.objects (expect 0; count-form so drift still prints)
SELECT 34,
       'storage.objects user triggers (expect 0)',
       count(*)::text
FROM pg_trigger
WHERE tgrelid = 'storage.objects'::regclass AND NOT tgisinternal
UNION ALL
-- 35. 20260923000004 headline object: grn/dc columns on tickets (expect 2)
SELECT 35,
       '20260923000004 grn/dc columns present (expect 2)',
       count(*)::text
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name IN ('grn_id', 'dc_id')
UNION ALL
-- 36. 20260923000008 headline objects: password functions present (expect 2)
SELECT 36,
       '20260923000008 password functions present (expect 2)',
       count(*)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('record_password_history', 'check_password_reuse')
UNION ALL
-- 37. Password function search_path locked down (one row per function; expect public, extensions)
SELECT 37,
       'password fn proconfig search_path (expect public, extensions)',
       p.proname || ' proconfig=' || COALESCE(array_to_string(p.proconfig, ', '), 'NULL')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('record_password_history', 'check_password_reuse')
ORDER BY 1, 2, 3;
