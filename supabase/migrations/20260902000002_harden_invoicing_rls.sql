-- 20260902000002_harden_invoicing_rls.sql
-- Prokon ERP — RLS hardening for invoicing-module (non-destructive)
-- Branch: invoicing-module | Safe: policy-only DDL, zero rows deleted/modified
-- Idempotent: DROP IF EXISTS + CREATE wrapped in DO $$ EXCEPTION blocks
-- Scope: invoice_settings, invoice_items, eway_bills — tighten open USING(true) to sales/admin
-- DOES NOT use DELETE FROM, TRUNCATE, or any DML that removes rows — only DDL for policies
-- Verify: cat supabase/migrations/20260902000002_harden_invoicing_rls.sql | head -n 80
-- Do NOT run supabase db push from this task — file creation only

-- =============================================================================
-- Preamble: ensure RLS remains enabled (no data change)
-- =============================================================================
alter table public.invoice_settings enable row level security;
alter table public.invoice_items enable row level security;
alter table public.eway_bills enable row level security;

-- =============================================================================
-- 1) invoice_settings — was: invoice_settings_read SELECT USING(true),
--    invoice_settings_write FOR ALL USING(true) WITH CHECK(true)
--    Replace with 4 least-privilege policies gated to admin / sales.*
-- =============================================================================

-- Drop legacy open policies (idempotent, exception-safe)
do $$ begin
  drop policy if exists "invoice_settings_read" on public.invoice_settings;
  drop policy if exists "invoice_settings_write" on public.invoice_settings;
  -- also handle any prior hardening attempt names, to stay idempotent on re-run
  drop policy if exists "invoice_settings_select" on public.invoice_settings;
  drop policy if exists "invoice_settings_insert" on public.invoice_settings;
  drop policy if exists "invoice_settings_update" on public.invoice_settings;
  drop policy if exists "invoice_settings_delete" on public.invoice_settings;
exception when others then null;
end $$;

-- SELECT: admin OR sales.read
do $$ begin
  create policy "invoice_settings_select" on public.invoice_settings
    for select to authenticated
    using (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'read')
    );
exception when duplicate_object then null;
end $$;

-- INSERT: admin OR sales.create
do $$ begin
  create policy "invoice_settings_insert" on public.invoice_settings
    for insert to authenticated
    with check (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'create')
    );
exception when duplicate_object then null;
end $$;

-- UPDATE: admin OR sales.edit (USING + WITH CHECK)
do $$ begin
  create policy "invoice_settings_update" on public.invoice_settings
    for update to authenticated
    using (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'edit')
    )
    with check (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'edit')
    );
exception when duplicate_object then null;
end $$;

-- DELETE: admin only
do $$ begin
  create policy "invoice_settings_delete" on public.invoice_settings
    for delete to authenticated
    using (
      public.has_role(auth.uid(), 'admin'::app_role)
    );
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- 2) invoice_items — was: invoice_items_all FOR ALL USING(true) WITH CHECK(true)
--    Replace with 4 policies: SELECT (admin OR sales.read), INSERT (admin OR
--    sales.create), UPDATE (admin OR sales.edit), DELETE (admin OR sales.delete)
--    No data loss — only policy DDL.
-- =============================================================================

do $$ begin
  drop policy if exists "invoice_items_all" on public.invoice_items;
  -- handle prior hardening names for idempotency on re-run
  drop policy if exists "invoice_items_select" on public.invoice_items;
  drop policy if exists "invoice_items_insert" on public.invoice_items;
  drop policy if exists "invoice_items_update" on public.invoice_items;
  drop policy if exists "invoice_items_delete" on public.invoice_items;
exception when others then null;
end $$;

-- SELECT: admin OR sales.read (parent invoice visibility is already gated via invoices RLS;
-- simplest safe predicate: sales.read — avoids leaking item rows to unauthorized users)
do $$ begin
  create policy "invoice_items_select" on public.invoice_items
    for select to authenticated
    using (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'read')
    );
exception when duplicate_object then null;
end $$;

-- INSERT: admin OR sales.create
do $$ begin
  create policy "invoice_items_insert" on public.invoice_items
    for insert to authenticated
    with check (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'create')
    );
exception when duplicate_object then null;
end $$;

-- UPDATE: admin OR sales.edit
do $$ begin
  create policy "invoice_items_update" on public.invoice_items
    for update to authenticated
    using (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'edit')
    )
    with check (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'edit')
    );
exception when duplicate_object then null;
end $$;

-- DELETE: admin OR sales.delete (also allow sales.edit to cover item replacement flows;
-- strictly admin-or-delete would be tighter — permit delete via has_permission delete only)
do $$ begin
  create policy "invoice_items_delete" on public.invoice_items
    for delete to authenticated
    using (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'delete')
    );
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- 3) eway_bills — was: eway_all FOR ALL USING(true) WITH CHECK(true)
--    Replace with 4 policies gated to sales.read / create / edit / admin delete
-- =============================================================================

do $$ begin
  drop policy if exists "eway_all" on public.eway_bills;
  drop policy if exists "eway_bills_select" on public.eway_bills;
  drop policy if exists "eway_bills_insert" on public.eway_bills;
  drop policy if exists "eway_bills_update" on public.eway_bills;
  drop policy if exists "eway_bills_delete" on public.eway_bills;
exception when others then null;
end $$;

-- SELECT: admin OR sales.read
do $$ begin
  create policy "eway_bills_select" on public.eway_bills
    for select to authenticated
    using (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'read')
    );
exception when duplicate_object then null;
end $$;

-- INSERT: admin OR sales.create
do $$ begin
  create policy "eway_bills_insert" on public.eway_bills
    for insert to authenticated
    with check (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'create')
    );
exception when duplicate_object then null;
end $$;

-- UPDATE: admin OR sales.edit
do $$ begin
  create policy "eway_bills_update" on public.eway_bills
    for update to authenticated
    using (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'edit')
    )
    with check (
      public.has_role(auth.uid(), 'admin'::app_role)
      or public.has_permission(auth.uid(), 'sales', 'edit')
    );
exception when duplicate_object then null;
end $$;

-- DELETE: admin only (eway bills are compliance records — no regular delete)
do $$ begin
  create policy "eway_bills_delete" on public.eway_bills
    for delete to authenticated
    using (
      public.has_role(auth.uid(), 'admin'::app_role)
    );
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- Safety assertions (no DML — only checks)
-- Ensure no DELETE FROM / TRUNCATE slipped in: this file contains zero such statements
-- All policies are TO authenticated; service_role bypasses RLS by design
-- =============================================================================
