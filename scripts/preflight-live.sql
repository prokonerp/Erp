-- =============================================================================
-- scripts/preflight-live.sql — READ-ONLY live-state preflight.
--
-- RUN: Supabase Dashboard → SQL editor (LIVE project) → paste this WHOLE file
--      → Run. You get ONE result grid; copy all rows.
--
-- SAFETY: SELECT-only. No DDL, no INSERT/UPDATE/DELETE, no ALTER, no SET that
--         persists, no NOTIFY. Reading this file cannot change your database.
--
-- HOW TO USE: every row whose `result` differs from `expected` names the
-- migration to apply (the `apply` column). Apply in the order listed in
-- docs/ENGINEER_VERIFICATION.md §0 and docs/runbooks/engineer-location.md,
-- then re-run this file to confirm.
--
-- Do NOT apply 20260821000000_bootstrap_base_schema.sql to live — that file
-- is for fresh/rebuild only (it is a guarded no-op here).
-- =============================================================================

WITH r AS (
  SELECT
    -- 1. base schema present (defines what "live" means)
    (SELECT to_regclass('public.app_users') IS NOT NULL)                AS base_schema,
    (SELECT to_regprocedure('public.has_role(uuid,public.app_role)') IS NOT NULL) AS has_role,
    -- 2. engineer core
    (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'engineer\_%') AS engineer_tables,
    (SELECT to_regclass('public.ticket_customer_verifications') IS NOT NULL
        AND to_regclass('public.ticket_equipment_verifications') IS NOT NULL) AS tcv_tables,
    (SELECT count(*) FROM pg_policies WHERE tablename='ticket_customer_verifications')  AS tcv_policies,
    (SELECT to_regprocedure('public.list_engineers()') IS NOT NULL)     AS list_engineers,
    (SELECT has_table_privilege('authenticated','public.field_service_reports','INSERT')) AS fsr_insert_grant,
    (SELECT to_regclass('public.ticket_visits') IS NOT NULL)            AS ticket_visits,
    -- 3. enum + storage hole
    (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
       WHERE t.typname='ims_transfer_status' AND e.enumlabel='cancelled') AS enum_cancelled,
    (SELECT count(*) FROM pg_policies
       WHERE schemaname='storage' AND tablename='objects' AND cmd='INSERT'
         AND policyname='Public can upload ticket attachments')          AS anon_insert_policy,
    (SELECT count(*) FROM pg_policies
       WHERE schemaname='storage' AND tablename='objects' AND cmd='INSERT'
         AND roles::text LIKE '%authenticated%')                          AS storage_insert_policies,
    (SELECT to_regclass('public.tickets') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name='tickets'
                       AND column_name='grn_id'))                         AS tickets_grn_col,
    -- 4. location tracking
    (SELECT count(*) FROM pg_tables
       WHERE schemaname='public' AND tablename IN
         ('engineer_location_pings','engineer_live_status','engineer_duty_sessions',
          'engineer_consent_events','engineer_gate_overrides','engineer_daily_movements')) AS location_tables,
    (SELECT count(*) FROM pg_publication_tables
       WHERE pubname='supabase_realtime' AND tablename='engineer_live_status')            AS location_realtime,
    (SELECT count(*) FROM cron.job WHERE jobname LIKE 'engineer-%')                        AS location_cron,
    (SELECT count(*) FROM pg_extension WHERE extname='pg_cron')                         AS has_pgcron,
    -- 5. schema drift fixed by the bootstrap (informational on live)
    (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='customers' AND column_name='city')      AS customers_city,
    (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='grns' AND column_name='general_dc_id')  AS grns_general_dc,
    -- 6. data gates (must be 0 before the validate / name-fallback migrations)
    (SELECT count(*) FROM public.tickets t LEFT JOIN public.employees e ON e.id=t.assigned_employee_id
       WHERE t.assigned_employee_id IS NOT NULL AND e.id IS NULL)                          AS orphan_ticket_assignees,
    (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace
       AND contype IN ('f','c') AND NOT convalidated)                                      AS unvalidated_constraints,
    -- 7. the three migrations that DROP data (column or rows) — are they behind us?
    (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='customers' AND column_name='branch_id')  AS col_customers_branch_id,
    (SELECT count(*) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='field_service_reports'
         AND column_name='front_indication')                                                AS col_fsr_front_indication,
    (SELECT to_regclass('public.engineer_place_visits') IS NOT NULL)                         AS place_visits_table,
    (SELECT count(*) FROM public.engineer_conveyance_expenses
       WHERE charge_type = 'Place Visit')                                                    AS leftover_place_visit_rows,
    -- 8. public-form rate-limit RPC (required before enabling strict mode)
    (SELECT to_regprocedure('public.check_public_rate_limit(text,integer,integer)') IS NOT NULL) AS rate_limit_rpc
)
SELECT * FROM (
  SELECT 1  AS seq, 'base schema present (app_users)'            AS check, base_schema::text            AS result,
         't' AS expected, 'informational — if false this is not the live project' AS apply FROM r
  UNION ALL SELECT 2,  'has_role(uuid,app_role) exists',            has_role::text,            't', 'informational (base function)' FROM r
  UNION ALL SELECT 3,  'engineer_* tables',                         engineer_tables::text,     '13', '20260915/20260916/20260921/20260922/20260925/20260928 series' FROM r
  UNION ALL SELECT 4,  'ticket verification tables exist',          tcv_tables::text,          't', '20260912000000' FROM r
  UNION ALL SELECT 5,  'ticket_customer_verifications policies',    tcv_policies::text,        '>=1', '20260912000002 (then 20260916000003 hardens)' FROM r
  UNION ALL SELECT 6,  'list_engineers() exists',                   list_engineers::text,      't', '20260925000001 then 20260925000007' FROM r
  UNION ALL SELECT 7,  'grant: authenticated INSERT field_service_reports', fsr_insert_grant::text, 't', '20260922000002' FROM r
  UNION ALL SELECT 8,  'ticket_visits table exists',                ticket_visits::text,       't', '20260917000003' FROM r
  UNION ALL SELECT 9,  'enum ims_transfer_status has cancelled',    enum_cancelled::text,      '1', '20260922000003' FROM r
  UNION ALL SELECT 10, 'anon INSERT policy on storage.objects',     anon_insert_policy::text,  '0', '20260922000001 must DROP it' FROM r
  UNION ALL SELECT 11, 'storage INSERT policies (authenticated)',   storage_insert_policies::text, '>=2', '20260922000001 / 20260922000004' FROM r
  UNION ALL SELECT 12, 'tickets.grn_id column present',             tickets_grn_col::text,     't', '20260923000004' FROM r
  UNION ALL SELECT 13, 'location tables (6 expected)',              location_tables::text,     '6', '20260928000001' FROM r
  UNION ALL SELECT 14, 'realtime: engineer_live_status published',  location_realtime::text,   '1', '20260928000001' FROM r
  UNION ALL SELECT 15, 'pg_cron extension installed',              has_pgcron::text,          '1', 'Supabase has it by default; if 0, jobs below stay unscheduled' FROM r
  UNION ALL SELECT 16, 'cron jobs engineer-*',                      location_cron::text,       '3', '20260928000002 / 20260928000004 / 20260928000007 (needs pg_cron)' FROM r
  UNION ALL SELECT 17, 'customers.city column (drift)',             customers_city::text,      '>=0', 'informational — bootstrap only; harmless if 0' FROM r
  UNION ALL SELECT 18, 'grns.general_dc_id column',                 grns_general_dc::text,     '>=0', 'informational — 20260828000000' FROM r
  UNION ALL SELECT 19, 'GATE: orphan ticket assignees',             orphan_ticket_assignees::text, '0', 'MUST be 0 before 20260923000003 (name-fallback removal)' FROM r
  UNION ALL SELECT 20, 'GATE: unvalidated FK/CHECK constraints',    unvalidated_constraints::text, '0', 'MUST be 0 before 20260923000002 (validate) completes clean' FROM r
  UNION ALL SELECT 21, 'customers.branch_id still exists',          col_customers_branch_id::text, '0', 'if 1 -> 20260908000001 NOT applied yet (it DROPs this column)' FROM r
  UNION ALL SELECT 22, 'field_service_reports.front_indication still exists', col_fsr_front_indication::text, '0', 'if 1 -> 20260919000001 NOT applied yet (it DROPs this column)' FROM r
  UNION ALL SELECT 23, 'engineer_place_visits table exists',        place_visits_table::text,  't', 'if f -> 20260926000001 NOT applied yet (moves then deletes Place Visit rows)' FROM r
  UNION ALL SELECT 24, 'leftover Place Visit expense rows',         leftover_place_visit_rows::text, '0', 'if >0 -> 20260926000001 not applied; its rows are COPIED to engineer_place_visits first' FROM r
  UNION ALL SELECT 25, 'check_public_rate_limit RPC exists',        rate_limit_rpc::text,      't', 'if t you may set PUBLIC_RATE_LIMIT_FAIL_CLOSED=1; 20260928000006' FROM r
) x
ORDER BY seq;
