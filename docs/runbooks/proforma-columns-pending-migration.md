# Runbook — proforma_invoices pending migration (20260913000002)

**Symptom:** converting a Sales Order → Proforma fails with
`POST /rest/v1/proforma_invoices 400` → `Could not find the 'contact_email' column of
'proforma_invoices' in the schema cache`.

**Root cause:** `createProformaFromSO` (src/lib/documentFlow.writers.ts) always sends 7
print carry-through columns (`payment_terms, salesperson, contact_person, contact_email,
contact_mobile, delivery_timeline, sales_type`). They are defined in
`supabase/migrations/20260913000002_add_proforma_missing_fields.sql` (committed in the
WIP bundle `da8297a4`) but **were never applied to live project `cqjmcfwsrljxhixzfgpk`**
(proof: the 2026-09-14 backup's `proforma_invoices` row has none of the 7).

No code change fixes this — the migration must be applied. Harness rule: the agent never
writes to Supabase; the user runs every step below.

## Steps (run in Supabase SQL Editor)

### 1. Apply the migration

Open `supabase/migrations/20260913000002_add_proforma_missing_fields.sql` and run its
contents (idempotent `ADD COLUMN IF NOT EXISTS`, additive only, existing rows get NULL):

```sql
ALTER TABLE public.proforma_invoices
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS salesperson text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_mobile text,
  ADD COLUMN IF NOT EXISTS delivery_timeline text,
  ADD COLUMN IF NOT EXISTS sales_type text;
```

### 2. Reload the PostgREST schema cache

Same session, immediately after step 1 (makes the reload deterministic):

```sql
NOTIFY pgrst, 'reload schema';
```

### 3. Verify (expected: 7 rows)

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='proforma_invoices'
  AND column_name IN ('payment_terms','salesperson','contact_person','contact_email',
                      'contact_mobile','delivery_timeline','sales_type');
```

- Before: **0 rows**. After: **7 rows**.

### 4. App check (no redeploy needed)

In the app: Sales Order → Convert → Proforma. Expect a created draft; open it and confirm
the print view shows the carried contact/terms fields (they come from the SO, which already
stores `contact_email` etc.).

If step 4 still fails, re-run step 3 — a stale cache is the only other cause.

## Post-apply checklist

- [ ] `supabase migration list` (or Dashboard → Database → Migrations) shows
      `20260913000002` applied.
- [ ] Advisors: `supabase db advisors` (CLI ≥ v2.81.3) — expect clean; this migration only
      adds nullable `text` columns (no index/RLS/policy impact).
- [ ] App console shows **no** `[proforma] schema drift` warnings (the write funnel now
      drops unknown payload columns with a warning instead of hard-failing — if you see
      the warning, a migration is still pending).

## Rollback

Not needed: the change is additive (`ADD COLUMN … IF NOT EXISTS`, no data rewritten).
To revert anyway: `ALTER TABLE public.proforma_invoices DROP COLUMN IF EXISTS <col>;`
for each of the 7, then `NOTIFY pgrst, 'reload schema';`.
