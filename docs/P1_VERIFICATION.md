# P1 Foundation — Verification Checklist

Branch: `invoicing-module` | Migration: `supabase/migrations/20260902000000_invoicing_staged.sql` | Date: 2026-09-02

> **Scope:** P1 Foundation only (DB + types + seed). No UI, no PDF, no e-Invoice/eway portal calls.
> **Constraint:** No `supabase gen types`, no `psql`, no DB writes in this step. Verification is local-only; run migration/regen/seed manually afterwards.

---

## 1) Pre-migration state (checked 2026-09-02)

- `src/integrations/supabase/types.ts` **matches DB before migration** — no P1 columns present yet (verified via grep: `sales_type`, `is_tax_inclusive`, `lut_no`, `supply_class`, `transport_details`, `eway_status`, `compliance_json` absent; only legacy `einvoice_status`/`ewaybill_*` exist).
- New P1 fields **not yet in types.ts** — added TODO at top of file:
  ```
  // TODO(after migration): regen via supabase gen types typescript --local > src/integrations/supabase/types.ts — new fields: sales_type, is_tax_inclusive, lut_no, supply_class, transport_details, einvoice_status, eway_status, compliance_json, etc.
  ```
- `src/lib/sales.ts:10-27` already defines `SalesType` + `SALES_TYPES` (7 values) and `InvoiceRow` has optional `sales_type`, `is_tax_inclusive`, `supply_class`, `lut_no`, `transport_details` — frontend is staged for nullable post-migration defaults.

---

## 2) E1–E3 Evidence Paths — P1 Coverage

| Evidence | What P1 proves | Migration objects | Seed demo | App code |
|---|---|---|---|---|
| **E1 — SalesType 7-way branching** | All 7 Tally parity sales types persist and branch GST/tax-inclusive/supply correctly | `invoice_sales_type` enum (7 vals) + `invoices.sales_type` DEFAULT `local_itemwise`, `is_tax_inclusive` BOOL, `supply_class` CHECK(`nil/exempt/zero_rated`), `lut_no` TEXT | `scripts/seed_invoicing_demo.ts` inserts 7 rows (one per `local_itemwise` … `sez_zero_rated`), `local_tax_incl.is_tax_inclusive=true`, `local_nil_rated.supply_class='nil'`, `sez_zero_rated.supply_class='zero_rated'+lut_no` | `src/lib/sales.ts:10-64` `SALES_TYPE_META`, `IS_TAX_INCLUSIVE`, `getSupplyClassForSalesType()` |
| **E2 — Transport 25-field JSONB** | Transport details stored as JSONB, queryable via GIN, no schema migration per field | `invoices.transport_details JSONB DEFAULT '{}'`, `idx_invoices_transport_gin` (GIN), `idx_invoices_transport_vehicle ((transport_details->>'vehicle_no'))` | Each demo uses `demoTransport()` with `vehicle_no`, `transporter_name/gstin`, `transport_mode`, `distance_km`, `lr_no`, `driver_*`, `place_of_supply*` | `src/lib/sales.ts:95` `transport_details?: unknown \| null` |
| **E3 — Compliance + audit + locks** | e-Invoice/e-Way lifecycle, compliance pasting, multi-copy print audit, immutability after IRN, safe numbering | Cols: `e_invoice_required`, `e_way_required`, `einvoice_status` CHECK(`not_required/pending/json_ready/uploaded/generated/cancelled/failed`), `eway_status` CHECK(`not_required/pending/json_ready/generated/cancelled`), `compliance_json`, `portal_response`, `signed_qr`, `compliance_pasted_*`, `print_count/first_printed_at/last_printed_at`, `irn/ack_no/ack_date/ewaybill_*`; Indexes: `idx_invoices_einv_status`, `idx_invoices_eway_status`, `idx_invoices_irn`, `idx_invoices_ack_no`; Table: `invoice_print_log` (append-only, RLS admin/sales); Functions: `set_invoice_no()` advisory lock fix, `assert_no_edit_after_irn()`, `assert_items_frozen_after_irn()`; View: `v_invoices_compliance` | Demos set `einvoice_status`/`eway_status` combos (`not_required` for nil, `pending` for taxable, etc.), `compliance_json.seed_batch='p1-demo-001'`, `print_count` default 0 | `src/lib/sales.ts:122-129` `einvoice_status/einvoice_error/ewaybill_*`; future `compliance_json`/`portal_response` |

---

## 3) How to Verify — After User Runs Migration

Run these **manually** (not in this task). Requires `DATABASE_URL` (Supabase Postgres).

### 3.1 Apply migration

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260902000000_invoicing_staged.sql
# idempotent — safe to re-run
```

### 3.2 Regen types (local)

```bash
supabase gen types typescript --local > src/integrations/supabase/types.ts
# or: supabase gen types typescript --linked > src/integrations/supabase/types.ts  (if no local docker)
# then remove the TODO comment at top of types.ts
```

Verify regen:

```bash
grep -n "sales_type\|is_tax_inclusive\|lut_no\|supply_class\|transport_details\|eway_status\|compliance_json\|invoice_print_log\|invoice_sales_type" src/integrations/supabase/types.ts | head -n 30
# Expect: sales_type, is_tax_inclusive, etc. present; invoice_print_log table entry; invoice_sales_type enum
```

### 3.3 psql checks (evidence)

```sql
-- E1: enum + columns + defaults (existing 7 invoices stay local_itemwise)
SELECT typname FROM pg_type WHERE typname='invoice_sales_type';
\d invoices
SELECT sales_type, is_tax_inclusive, supply_class, count(*) FROM invoices GROUP BY 1,2,3;
SELECT enum_range(NULL::invoice_sales_type);

-- E2: transport JSONB + indexes
SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='invoices' AND column_name='transport_details';
SELECT indexname, indexdef FROM pg_indexes WHERE tablename='invoices' AND indexname LIKE 'idx_invoices_transport%';
SELECT transport_details->>'vehicle_no' as vehicle_no, sales_type FROM invoices LIMIT 5;

-- E3: compliance statuses + print log + locks + view
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='invoices' AND column_name IN ('einvoice_status','eway_status','compliance_json','portal_response','signed_qr','print_count','irn','ack_no');
SELECT * FROM invoice_print_log LIMIT 1;
SELECT * FROM v_invoices_compliance LIMIT 5;
\df+ set_invoice_no
\df+ assert_no_edit_after_irn

-- Advisory lock + sequence sanity (FY reset)
SELECT branch_id, prefix, current_fy, next_seq FROM invoice_settings LIMIT 5;
```

Expected:
- `invoice_sales_type` exists with 7 values.
- `invoices.sales_type NOT NULL DEFAULT 'local_itemwise'`, `is_tax_inclusive NOT NULL DEFAULT false`, `supply_class CHECK`, `transport_details JSONB`, `einvoice_status/eway_status` checks, `compliance_json JSONB`, `print_count int`.
- GIN index `idx_invoices_transport_gin` + `idx_invoices_transport_vehicle`.
- `invoice_print_log` table exists, RLS enabled, 3 indexes.
- Triggers `trg_lock_after_irn` on `invoices`, `trg_items_frozen_after_irn` on `invoice_items`.
- `v_invoices_compliance` view with `is_complete`.

### 3.4 Try/rollback for IRN lock (manual)

```sql
-- Should FAIL after IRN is set (immutability):
-- UPDATE invoices SET total = total + 1 WHERE irn IS NOT NULL RETURNING id;
-- INSERT INTO invoice_items (invoice_id, sr_no, description, qty, rate, line_total) VALUES ((SELECT id FROM invoices WHERE irn IS NOT NULL LIMIT 1), 99, 'test', 1, 1, 1);
```

---

## 4) Seed — Manual run only

File: `scripts/seed_invoicing_demo.ts` (created, **not executed**)

```bash
# Show expected 7 types without DB:
npx tsx -e "import('./scripts/seed_invoicing_demo.ts').then(m=>m.showExpectedSalesTypes())"

# Full seed (requires env):
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed_invoicing_demo.ts
```

Verification after seed:

```sql
SELECT sales_type, is_tax_inclusive, supply_class, lut_no, einvoice_status, eway_status, total
FROM invoices WHERE compliance_json->>'seed_batch'='p1-demo-001' ORDER BY sales_type;

SELECT count(*) FROM invoices WHERE compliance_json->>'seed_batch'='p1-demo-001'; -- expect 7
SELECT invoice_no, sales_type FROM invoices WHERE compliance_json->>'seed_batch'='p1-demo-001';
```

Cleanup (if needed):

```sql
DELETE FROM invoices WHERE compliance_json->>'seed_batch'='p1-demo-001';
-- (cascade would remove invoice_items if any)
```

---

## 5) Regen notes

- **Before migration:** `types.ts` + DB in sync (no new columns) — verified 2026-09-02.
- **After migration:** `types.ts` is **out of date** until regen. The TODO at top of `types.ts` reminds to regen. Do **not** commit stale types — regen then drop the TODO.
- **Seed file** imports from `src/lib/sales.ts` constants — if `SalesType` values change, update `EXPECTED_SALES_TYPES` in seed file too.
- **No DB writes** were performed in this task — only local files created/modified.
- **Git:** No push. Changes are local on `invoicing-module`. Verify with `git status` / `git diff`.

---

## 6) Checklist (copy for PR)

- [ ] Migration `20260902000000_invoicing_staged.sql` applied via `psql`
- [ ] `supabase gen types typescript --local > src/integrations/supabase/types.ts` run, TODO removed
- [ ] `grep sales_type src/integrations/supabase/types.ts` shows enum + columns + `invoice_print_log`
- [ ] E1: `SELECT sales_type, count(*) FROM invoices GROUP BY sales_type` includes 7 values (after seed 7)
- [ ] E2: `SELECT transport_details FROM invoices LIMIT 1` is JSONB, GIN index present
- [ ] E3: `SELECT * FROM invoice_print_log LIMIT 1` works, `v_invoices_compliance` view exists, IRN lock triggers exist
- [ ] Seed `scripts/seed_invoicing_demo.ts` run manually → 7 demo invoices visible
- [ ] `git status` shows only `src/integrations/supabase/types.ts` (TODO), `scripts/seed_invoicing_demo.ts`, `docs/P1_VERIFICATION.md`
