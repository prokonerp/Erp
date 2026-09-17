# Engineers Console — DB Audit (static, read-only)

Scope: four migration files only (the engineers-console DB surface under review).
App surface: `src/hooks/useEngineerAdmin.ts` (`.from(...)` / `.rpc(...)` calls).

> Do NOT create a migration. Do NOT modify the DB. The SQL block in §4 is
> SELECT-only for the repo owner to paste into the Supabase SQL editor.

Migrations read:

- `supabase/migrations/20260925000001_engineer_conveyance_rates.sql` (000001)
- `supabase/migrations/20260925000002_engineer_part_custody.sql` (000002)
- `supabase/migrations/20260925000003_conveyance_integrity.sql` (000003)
- `supabase/migrations/20260925000004_fix_stock_status_enum_compare.sql` (000004)

## 1) Per-table / RPC inventory (what these four files define)

### engineer_conveyance_rates (created 000001:43-53)

- RLS enabled? Yes — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (000001:58).
- Policies in these files: **3** — `own engineer_conveyance_rates` (SELECT, own rows
  via `employees.auth_user_id`, 000001:161-168), `admin all engineer_conveyance_rates`
  (FOR ALL, 000001:169-173), `own email engineer_conveyance_rates` (SELECT fallback
  via JWT email + `employees.active`, 000003:164-177).
- Indexes in these files: **1** — `idx_engineer_conveyance_rates_employee_from`
  on `(employee_id, effective_from)` (000001:55-56); plus UNIQUE
  `engineer_conveyance_rates_one_per_day (employee_id, effective_from)` (000001:52),
  which carries its own btree index.
- App use: `.from("engineer_conveyance_rates")` in `useEngineerAdmin.ts:166,231,503,684`.

### engineer_conveyance_settlements (created 000001:70-95)

- RLS enabled? Yes (000001:100).
- Policies in these files: **3** — `own engineer_conveyance_settlements` (SELECT,
  000001:176-183), `admin all engineer_conveyance_settlements` (FOR ALL, 000001:184-188),
  `own email engineer_conveyance_settlements` (SELECT fallback, 000003:181-193).
- Indexes in these files: **1** — `idx_engineer_conveyance_settlements_employee_period`
  on `(employee_id, period_start)` (000001:97-98); plus UNIQUE
  `engineer_conveyance_settlements_one_per_period` (000001:93-94) and UNIQUE
  `reference_no` (000001:87); plus conditional EXCLUDE `no_overlapping_settlements`
  (gist, only when `btree_gist` present, 000001:116-133 — otherwise NOTICE + app-side fallback).
- App use: `.from("engineer_conveyance_settlements")` in `useEngineerAdmin.ts:216,734`.

### engineer_admin_audit (created 000001:138-147)

- RLS enabled? Yes (000001:152).
- Policies in these files: **2** — `admin select engineer_admin_audit` (SELECT,
  000001:191-194) and `admin all engineer_admin_audit` (FOR ALL, 000001:195-199).
  The two overlap: the FOR ALL already covers SELECT, so the SELECT-only policy is
  redundant (harmless; writes still gated to admin role, service-role bypasses RLS).
- Indexes in these files: **1** — `idx_engineer_admin_audit_entity` on
  `(entity, entity_id)` (000001:149-150).
- App use: none in `useEngineerAdmin.ts` (server-fn audit trail, not read by the hook).

### engineer_conveyance_expenses (NOT created here; precondition 000003:78-82 requires `20260920000001`)

- RLS enabled? **Not in these files** (expected in the earlier `20260920000001` migration).
- Policies in these files: **1** — `own email engineer_conveyance_expenses`
  (SELECT fallback, 000003:151-162).
- Indexes/constraints in these files: `client_key uuid NOT NULL` (000003:88-103) +
  UNIQUE `uq_conveyance_expense_client_key (client_key)` (000003:109-118), which
  implicitly creates its backing btree index. No standalone `CREATE INDEX` in these files.
- App use: `.from("engineer_conveyance_expenses")` in `useEngineerAdmin.ts:150,487,700`.

### engineer_daily_logs (NOT created here)

- RLS enabled? **Not in these files** (expected in an earlier migration).
- Policies in these files: **1** — `own email engineer_daily_logs`
  (SELECT fallback, 000003:140-149).
- Indexes in these files: **none**.
- App use: `.from("engineer_daily_logs")` in `useEngineerAdmin.ts:134,350,471,665`.

### employees (read-only target; NOT created here)

- RLS / policies / indexes in these files: **none**. Read by `list_engineers()`
  (000001:227), `get_engineer_material_stats()` (000004:46-50,56-61),
  `my_stock_custody()` (000004:143-145), `admin_stock_custody()` (000004:173-176)
  via `auth_user_id` / `email` / `active` lookups.
- App use: `.from("employees").select("id, documents")` in
  `useEngineerAdmin.ts:555,719` (`useEmployeeDocuments`, attention queue doc rows).

### tickets (read + trigger host; NOT created here)

- RLS / policies / indexes / grants in these files: **none**. Hosts two triggers
  created in 000002: `trg_ims_stamp_custodian_confirm` (AFTER UPDATE, 000002:281-286)
  and `trg_ims_clear_custodian_ticket_close` (AFTER UPDATE OF status → Closed,
  000002:324-329). Read by `get_engineer_material_stats()` pending-block
  (000004:73-81).
- App use: `.from("tickets")` in `useEngineerAdmin.ts:333,397,408,647`.

### ims_stock_items (custody columns; NOT created here — precondition 000002:84-91 requires `20260916000002`)

- RLS / policies in these files: **none**. New columns `custodian_set_at`,
  `custodian_cleared_at`, `custodian_cleared_by_ref` (000002:114-117).
- Indexes in these files: **1** — `idx_ims_stock_norm_serial` expression index on
  `(normalize_serial(part_serial_no))` (000002:126-127).
- Column REVOKEs (supplementary, not enforcement — see §3):
  `custodian_employee_id` revoked for `authenticated` (000002:431-438).

### RPCs

- `list_engineers()` — created 000001:207-230. `SECURITY DEFINER`, admin-gated inside
  the body (`has_role(...,'admin')`, non-admins get zero rows). Called at
  `useEngineerAdmin.ts:85` (`useEngineerRoster`, shared by overview/attention).
- `admin_stock_custody(uuid)` — created 000002:585-613, enum-fix 000004:155-183.
  `SECURITY DEFINER`, admin-gated (`RETURN` empty for non-admins). Called at
  `useEngineerAdmin.ts:590` (`useEngineerCustody`) and as a health probe at
  `useEngineerAdmin.ts:749`.
- Supporting (not called by this hook): `conveyance_rate_for()` (000001:235-245),
  `normalize_serial()` (000002:96-100), `my_stock_custody()` (000002:552-574),
  `get_engineer_material_stats()` (rewritten 000002:448-538, fixed 000004:33-123),
  trigger writers `ims_clear_custodian_on_grn_receipt`,
  `ims_stamp_custodian_on_dc_dispatch`, `ims_stamp_custodian_on_part_confirm`,
  `ims_clear_custodian_on_ticket_close`, `ims_clear_custodian_on_doc_cancel`,
  guard `guard_custodian_write()`.

## 2) Gap list — app-touched tables with NO policy/index in these four files

1. `tickets` — read at `useEngineerAdmin.ts:333,397,408,647`; zero policies, zero
   indexes, zero grants in these files (only triggers added: `000002:281-286,324-329`).
   RLS/policies must come from an earlier migration — confirm they allow the admin reads.
2. `employees` (+ `employees.documents`) — read at `useEngineerAdmin.ts:555,719`;
   zero policies, zero indexes, zero grants in these files (only read inside DEFINER
   functions: `000001:227`, `000004:46-50,143-145,173-176`). Direct client reads depend
   entirely on pre-existing `employees` policies.
3. `engineer_daily_logs` — read at `useEngineerAdmin.ts:134,350,471,665`; no
   `ENABLE RLS`, no base/admin policy, no index in these files (only the email-fallback
   SELECT policy at `000003:140-149`). Base RLS + admin-FOR-ALL must live in the earlier
   migration the hook comment assumes ("admin all engineer_daily_logs").
4. `engineer_conveyance_expenses` — read/written at `useEngineerAdmin.ts:150,487,700`;
   no `ENABLE RLS`, no base/admin policy, no standalone index in these files (only the
   email-fallback policy at `000003:151-162` plus the `client_key` UNIQUE backing index at
   `000003:109-118`). Idempotent-submit upsert depends on that UNIQUE constraint existing.
5. `ims_stock_items` — read by the custody RPCs (`000004:64-67,141-146,173-179`);
   no RLS/policy/grant changes in these files (only `idx_ims_stock_norm_serial` at
   `000002:126-127` and column REVOKEs at `000002:431-438`). Direct-client access and
   `STOCK_SELECT` scoping live outside these files.

## 3) Grants / SECURITY DEFINER notes

- `list_engineers()` and `conveyance_rate_for()` are `SECURITY DEFINER` with
  `SET search_path = public` and `GRANT EXECUTE ... TO authenticated`
  (000001:217,237,252-259). The admin gate inside `list_engineers()` is load-bearing
  (comment 000001:19-20); `conveyance_rate_for()` has **no** role gate — any
  authenticated caller can resolve any engineer's rate (read-only, low sensitivity).
- Custody writers (`ims_clear_custodian_on_grn_receipt`, `ims_stamp_custodian_on_dc_dispatch`,
  `ims_stamp_custodian_on_part_confirm`, `ims_clear_custodian_on_ticket_close`,
  `ims_clear_custodian_on_doc_cancel`) are all `SECURITY DEFINER` (run as owner) and set
  `app.custodian_write = 'on'` so the guard trigger lets them through
  (000002:148,207,248,307,359).
- `guard_custodian_write()` is deliberately `SECURITY INVOKER` (000002:400-419): as
  INVOKER `current_user` is the true caller, so direct `authenticated`/`anon` writes to
  `custodian_employee_id` raise unless the session flag is set; `service_role`/owner are
  exempt. The column `REVOKE ... FROM authenticated` (000002:431-438) is explicitly
  supplementary — a table-level UPDATE grant overrides it; the trigger is the enforcement.
- `normalize_serial()`, `get_engineer_material_stats()`, `my_stock_custody()`,
  `admin_stock_custody()` each `REVOKE ALL ... FROM PUBLIC` then
  `GRANT EXECUTE ... TO authenticated` with role-guarded `NOTICE`-skip blocks
  (000002:102-109,540-547,576-583,615-622). `admin_stock_custody()` additionally gates
  non-admins to zero rows in-body (000004:169-171).
- 000003 grants `ALL ON engineer_conveyance_expenses TO service_role` only
  (000003:208-216); table grants for rates/settlements/audit (`authenticated`
  SELECT/INSERT/UPDATE/DELETE + `ALL` to `service_role`) live in 000001:261-298 and are
  all `to_regclass`/`pg_roles`-guarded so bare scratch clusters NOTICE-skip, never abort.
  Note the audit-table grant (000001:287-298) gives `authenticated` INSERT/UPDATE/DELETE
  at the GRANT level even though the file comment says audit writes go via service-role —
  RLS (admin-only policies) is what actually restricts user traffic.
- No `GRANT` on `tickets`, `employees`, `engineer_daily_logs`, or `ims_stock_items` in
  these four files.

## 4) READ-ONLY verification SQL (paste into Supabase SQL editor — SELECT-only, zero writes)

```sql
-- READ-ONLY verification for the engineers-console DB surface.
-- Do NOT create a migration. Do NOT modify the DB. SELECT statements only.

-- 1) Row counts per app-touched table (proves tables exist + visible rows)
SELECT 'engineer_daily_logs' AS tbl, count(*) FROM public.engineer_daily_logs
UNION ALL SELECT 'engineer_conveyance_expenses', count(*) FROM public.engineer_conveyance_expenses
UNION ALL SELECT 'engineer_conveyance_rates', count(*) FROM public.engineer_conveyance_rates
UNION ALL SELECT 'engineer_conveyance_settlements', count(*) FROM public.engineer_conveyance_settlements
UNION ALL SELECT 'engineer_admin_audit', count(*) FROM public.engineer_admin_audit
UNION ALL SELECT 'employees', count(*) FROM public.employees
UNION ALL SELECT 'tickets', count(*) FROM public.tickets
UNION ALL SELECT 'ims_stock_items', count(*) FROM public.ims_stock_items;

-- 2) RLS enabled? (expect all true; daily_logs/expenses/tickets/employees/ims_stock_items
--    are enabled by earlier migrations, NOT by the four files audited here)
SELECT relname AS tbl, relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
FROM pg_class WHERE relnamespace = 'public'::regnamespace
AND relname IN ('engineer_daily_logs','engineer_conveyance_expenses','engineer_conveyance_rates',
  'engineer_conveyance_settlements','engineer_admin_audit','employees','tickets','ims_stock_items')
ORDER BY relname;

-- 3) Policies on those tables (expect: rates x3, settlements x3, expenses >=2 incl.
--    'own email ...', daily_logs >=2 incl. 'own email ...', audit x2)
SELECT tablename, policyname, roles, cmd AS for_cmd
FROM pg_policies WHERE schemaname = 'public'
AND tablename IN ('engineer_daily_logs','engineer_conveyance_expenses','engineer_conveyance_rates',
  'engineer_conveyance_settlements','engineer_admin_audit','employees','tickets','ims_stock_items')
ORDER BY tablename, policyname;

-- 4) Indexes on those tables (expect idx_engineer_conveyance_rates_employee_from,
--    idx_engineer_conveyance_settlements_employee_period, idx_engineer_admin_audit_entity,
--    idx_ims_stock_norm_serial, uq_conveyance_expense_client_key backing index)
SELECT tablename, indexname, indexdef
FROM pg_indexes WHERE schemaname = 'public'
AND tablename IN ('engineer_daily_logs','engineer_conveyance_expenses','engineer_conveyance_rates',
  'engineer_conveyance_settlements','engineer_admin_audit','employees','tickets','ims_stock_items')
ORDER BY tablename, indexname;

-- 5) RPCs exist? (expect list_engineers, conveyance_rate_for, normalize_serial,
--    get_engineer_material_stats, my_stock_custody, admin_stock_custody)
SELECT p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS args,
  CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS security
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
AND p.proname IN ('list_engineers','conveyance_rate_for','normalize_serial',
  'get_engineer_material_stats','my_stock_custody','admin_stock_custody',
  'ims_clear_custodian_on_grn_receipt','ims_stamp_custodian_on_dc_dispatch',
  'ims_stamp_custodian_on_part_confirm','ims_clear_custodian_on_ticket_close',
  'ims_clear_custodian_on_doc_cancel','guard_custodian_write')
ORDER BY p.proname;
```

## Cross-check 2026-09-18 — "not in these files" items are covered by earlier migrations

Static grep over `supabase/migrations/` (all files, not just the four above):
- `tickets` policies/indexes → 20260923000006_enable_base_rls, 20260923000003_remove_name_fallback_rls, 20260916000003_harden_ticket_verifications_rls, 20260917000003_engineer_visits_signature, 20260925000002_engineer_part_custody.
- `employees` → same RLS-hardening set + 20260925000001 (DEFINER-fn reads).
- `engineer_daily_logs` / `engineer_conveyance_expenses` → 20260920000001_engineer_conveyance_profile (base RLS + indexes) + 20260925000003 (integrity).
- `ims_stock_items` → 20260830000001_fix_ims_insert_rls, 20260923000006_enable_base_rls, 20260916000002_engineer_custody_postings.
No orphan table: every table/RPC the hooks touch has coverage somewhere in the chain. Remaining step is runtime: paste the SQL block above into the Supabase SQL editor and compare counts.
