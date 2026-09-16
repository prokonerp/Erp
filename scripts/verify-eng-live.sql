-- scripts/verify-eng-live.sql
-- Read-only post-apply verification for the engineering-module migrations.
--
-- HOW TO RUN (Supabase SQL editor):
--   1. Open the Supabase dashboard SQL editor on the LIVE project.
--   2. Paste this WHOLE file, press Run.
--   3. Read every row. NOTHING here writes: only SELECTs against catalog
--      views (pg_policies / pg_constraint / pg_enum / information_schema),
--      has_table_privilege() probes, and COUNT(*) residue scans. No DDL,
--      no UPDATE/INSERT/DELETE, no SET that persists.
--
-- EXPECTED vs ACTION (per check label):
--   label                                                        | must show | if not, do this
--   -------------------------------------------------------------|-----------|-----------------------------------------------
--   duplicate 12000001 versions                                  | 0         | A2 apply incomplete — apply 20260912000002
--   anon INSERT policy on storage.objects                        | 0         | Wave-0 hole open — apply 20260922000001
--   storage INSERT policies (authenticated remains)              | >=1 auth  | apply 20260922000001/22000002, re-check
--   hardened tcv policies present                                | >=1 row   | apply 20260912000002
--   grant: authenticated INSERT on field_service_reports         | true      | apply 20260922000002
--   enum ims_transfer_status has cancelled                    | 1 row     | apply 20260922000003
--   backfill residue: unmatched name                             | 0         | A3 data task — link/fix names, re-run backfill; A5 GATE: do NOT apply name-fallback removal while >0 without user sign-off
--   backfill residue: ambiguous name                             | 0         | same as above (ambiguous names are never auto-guessed)
--   tickets fully unassigned (NULL/NULL, info only)              | any       | info — assignment data task, not a migration incident
--   engineers with NULL auth_user_id                             | 0 (*)     | identity-link data task (A3 context); (*) some unlinked service rows may be intentional — confirm with admin
--   constraint validation status (6 rows)                        | all true  | A4 data task — run the report query from the matching migration NOTICE (§2 of 20260923000002...), fix rows, re-run migration
--   orphan counts (3 FK checks)                                  | 0         | same as above — orphan rows block VALIDATE by design (never fails the push)
--   CHECK violation counts (3 checks)                            | 0         | same as above
--   RLS FK-only: 4 rewritten policies                            | no-name-leg | A5 not applied (or regressed) — apply 20260923000003
--   engineer-uploads SELECT present (untouched)                  | >=1 row   | owned by 20260922000004 — re-apply it, never hand-edit storage.objects (needs supabase_storage_admin)
--   grn/dc columns + FK status (B1, guarded)                     | n/a or validated | B1 data task once 20260923000004 exists
--
-- Every check prints (check, result). Multi-row checks repeat the label.

-- -- -- A2 apply-state (from ENGINEER_VERIFICATION.md section 0, verbatim core) -- -- --

-- 1. Which of the duplicate-version files actually applied? (expect 0)
SELECT 'duplicate 12000001 versions (expect 0)' AS check,
       count(*)::text AS result
FROM supabase_migrations WHERE version LIKE '20260912000001%';

-- 2. Single hardened version in force (expect exactly 1 row: 20260912000002)
SELECT 'hardened version 12000002 applied (expect 1)' AS check,
       count(*)::text AS result
FROM supabase_migrations WHERE version IN ('20260912000001', '20260912000002');

-- 3. Anon storage hole closed BEFORE/AFTER #1 (expect 0)
SELECT 'anon INSERT policy on storage.objects (expect 0)' AS check,
       count(*)::text AS result
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname = 'Public can upload ticket attachments';

-- 4. Anon INSERT gone; authenticated INSERT remains (expect >=1 authenticated row, 0 anon rows)
SELECT 'storage INSERT policies (expect authenticated only, no anon)' AS check,
       policyname AS result, roles AS roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'INSERT';

-- 5. Hardened verification policies in force
SELECT 'hardened tcv policies present (expect rows)' AS check,
       policyname AS result
FROM pg_policies WHERE tablename = 'ticket_customer_verifications';

-- 6. Engineer tables granted
SELECT 'grant: authenticated INSERT on field_service_reports (expect true)' AS check,
       has_table_privilege('authenticated', 'public.field_service_reports', 'INSERT')::text AS result;

-- 7. cancelled enum value present (type is public.ims_transfer_status)
SELECT 'enum ims_transfer_status has cancelled (expect 1 row)' AS check,
       enumlabel AS result
FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
WHERE t.typname = 'ims_transfer_status' AND e.enumlabel = 'cancelled';

-- -- -- A3 backfill residue (20260923000001 gate diagnostic; A5 ships only when 0/0) -- -- --

-- 8. Unmatched: FK still NULL, name matches NO employee (expect 0)
SELECT 'backfill residue: unmatched name (expect 0, A3/A5 gate)' AS check,
       count(*)::text AS result
FROM public.tickets t
WHERE t.assigned_employee_id IS NULL
  AND t.assigned_engineer_name IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.name = t.assigned_engineer_name);

-- 9. Ambiguous: FK still NULL, name matches >1 employee (expect 0, never auto-guessed)
SELECT 'backfill residue: ambiguous name (expect 0, A3/A5 gate)' AS check,
       count(*)::text AS result
FROM public.tickets t
WHERE t.assigned_employee_id IS NULL
  AND t.assigned_engineer_name IS NOT NULL
  AND (SELECT count(*) FROM public.employees e WHERE e.name = t.assigned_engineer_name) > 1;

-- 10. Fully unassigned (info only — neither leg; assignment data task, not a migration incident)
SELECT 'tickets fully unassigned NULL/NULL (info only)' AS check,
       count(*)::text AS result
FROM public.tickets t
WHERE t.assigned_employee_id IS NULL AND t.assigned_engineer_name IS NULL;

-- 11. Identity link gap: engineers with no auth user (expect 0; confirm intentional service rows with admin)
SELECT 'engineers with NULL auth_user_id (expect 0)' AS check,
       count(*)::text AS result
FROM public.employees WHERE auth_user_id IS NULL;

-- -- -- A4 constraint validation status (20260923000002: six NOT VALID -> VALIDATE) -- -- --

-- 12. Validation flags (expect convalidated = true on all six)
SELECT 'constraint validation status (expect true)' AS check,
       conname AS result, convalidated::text AS validated
FROM pg_constraint
WHERE conname IN ('fk_tickets_assigned_employee', 'fk_tah_assigned_by',
                  'fk_employees_auth_user', 'chk_ticket_visits_departure_after_arrival',
                  'chk_tah_time_order', 'chk_daily_logs_odometer_nonneg')
ORDER BY conname;

-- 13-15. Orphan FK counts (expect 0; any orphan blocks VALIDATE by design)
SELECT 'orphan fk_tickets_assigned_employee (expect 0)' AS check,
       count(*)::text AS result
FROM public.tickets t LEFT JOIN public.employees e ON e.id = t.assigned_employee_id
WHERE t.assigned_employee_id IS NOT NULL AND e.id IS NULL;

SELECT 'orphan fk_tah_assigned_by (expect 0)' AS check,
       count(*)::text AS result
FROM public.ticket_assignment_history h LEFT JOIN auth.users u ON u.id = h.assigned_by
WHERE h.assigned_by IS NOT NULL AND u.id IS NULL;

SELECT 'orphan fk_employees_auth_user (expect 0)' AS check,
       count(*)::text AS result
FROM public.employees e LEFT JOIN auth.users u ON u.id = e.auth_user_id
WHERE e.auth_user_id IS NOT NULL AND u.id IS NULL;

-- 16-18. CHECK violation counts (expect 0)
SELECT 'violations chk_ticket_visits_departure_after_arrival (expect 0)' AS check,
       count(*)::text AS result
FROM public.ticket_visits
WHERE departure_at IS NOT NULL AND arrival_at IS NOT NULL AND departure_at < arrival_at;

SELECT 'violations chk_tah_time_order (expect 0)' AS check,
       count(*)::text AS result
FROM public.ticket_assignment_history
WHERE assigned_at IS NULL OR (unassigned_at IS NOT NULL AND unassigned_at < assigned_at);

SELECT 'violations chk_daily_logs_odometer_nonneg (expect 0)' AS check,
       count(*)::text AS result
FROM public.engineer_daily_logs
WHERE (morning_odometer IS NOT NULL AND morning_odometer < 0)
   OR (evening_odometer IS NOT NULL AND evening_odometer < 0);

-- -- -- A5 RLS name-fallback removal (20260923000003: 4 policies FK-only) -- -- --

-- 19-22. Rewritten policies must carry NO assigned_engineer_name leg (expect 'FK-only')
SELECT 'RLS FK-only: auth view tickets (expect FK-only)' AS check,
       CASE WHEN qual LIKE '%assigned_engineer_name%' OR with_check LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END AS result
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tickets' AND policyname = 'auth view tickets';

SELECT 'RLS FK-only: auth update tvis (expect FK-only)' AS check,
       CASE WHEN qual LIKE '%assigned_engineer_name%' OR with_check LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END AS result
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_visits' AND policyname = 'auth update tvis';

SELECT 'RLS FK-only: auth update tcv (expect FK-only)' AS check,
       CASE WHEN qual LIKE '%assigned_engineer_name%' OR with_check LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END AS result
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_customer_verifications' AND policyname = 'auth update tcv';

SELECT 'RLS FK-only: auth update tev (expect FK-only)' AS check,
       CASE WHEN qual LIKE '%assigned_engineer_name%' OR with_check LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END AS result
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_equipment_verifications' AND policyname = 'auth update tev';

-- Assignment-history SELECT rewritten (was USING(true); FK-only legs reference employee/ticket link)
SELECT 'RLS FK-only: auth select assignment_history (expect FK-only)' AS check,
       CASE WHEN qual LIKE '%assigned_engineer_name%' OR with_check LIKE '%assigned_engineer_name%'
            THEN 'STILL HAS name leg — apply 20260923000003' ELSE 'FK-only' END AS result
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ticket_assignment_history' AND policyname = 'auth select assignment_history';

-- 23. engineer-uploads SELECT untouched (owned by 20260922000004; expect rows)
SELECT 'engineer-uploads SELECT present, untouched (expect rows)' AS check,
       policyname AS result
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
  AND policyname ILIKE '%engineer%';

-- -- -- B1 grn_id/dc_id FK (20260923000004 — guarded: reports n/a until the columns exist) -- -- --

-- 24. Column presence (expect 'absent' before B1 ships, column list after)
SELECT 'grn/dc columns on tickets (absent before B1)' AS check,
       COALESCE(string_agg(column_name, ', '), 'absent') AS result
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'tickets' AND column_name IN ('grn_id', 'dc_id');

-- 25. Any ticket-FK constraint mentioning grn/dc + its validation flag (expect no rows before B1)
SELECT 'grn/dc FK validation on tickets (no rows before B1)' AS check,
       conname AS result, convalidated::text AS validated
FROM pg_constraint
WHERE conrelid = 'public.tickets'::regclass
  AND (conname ILIKE '%grn%' OR conname ILIKE '%dc%');
