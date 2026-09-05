-- 20260908000000_customers_branch.sql
-- Branch-aware customers: one legal entity (same GSTIN) may operate from
-- multiple branches. Adds customers.branch_id -> branches(id) (nullable:
-- NULL = "global / all branches", back-compat for existing rows) and
-- branch-scoped uniqueness so the SAME GST / company+phone is allowed in
-- DIFFERENT branches while still blocked within the same branch / among
-- global rows.
--
-- NOTE: applied manually via Supabase Dashboard SQL Editor (no Docker ->
-- `supabase db push` unavailable).

-- 1) Add branch reference (nullable, on-delete set null)
alter table public.customers
  add column if not exists branch_id uuid references public.branches(id) on delete set null;

-- 2) Lookup indexes
create index if not exists idx_customers_branch on public.customers(branch_id);
create index if not exists idx_customers_branch_gst on public.customers(branch_id, gst) where gst is not null;
create index if not exists idx_customers_branch_company_phone on public.customers(branch_id, company, phone);

-- 3) Branch-scoped uniqueness.
--    - Same GST allowed in different (non-null) branches.
--    - NULL branch rows form the "global" set: two globals with same GST
--      still conflict (desired) — that is the pre-existing duplicate case.
--    - URP sentinel and dup_exempt (sanctioned duplicates) are excluded.
create unique index if not exists uq_customers_gst_per_branch
  on public.customers(branch_id, gst)
  where gst is not null and gst <> '' and gst <> 'URP' and coalesce(dup_exempt, false) = false;

create unique index if not exists uq_customers_company_phone_per_branch
  on public.customers(branch_id, company, phone)
  where company is not null and phone is not null and company <> '' and phone <> ''
    and coalesce(dup_exempt, false) = false;

-- 4) Planner stats
analyze public.customers;

-- ROLLBACK (if ever needed):
--   drop index if exists uq_customers_company_phone_per_branch;
--   drop index if exists uq_customers_gst_per_branch;
--   drop index if exists idx_customers_branch_company_phone;
--   drop index if exists idx_customers_branch_gst;
--   drop index if exists idx_customers_branch;
--   alter table public.customers drop column branch_id;
