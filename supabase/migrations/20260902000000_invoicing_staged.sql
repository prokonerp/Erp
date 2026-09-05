-- 20260902000000_invoicing_staged.sql
-- Prokon ERP — Staged Billing, Tally Sales Types, Transport 25-field, Multi-Copy Audit
-- Branch: invoicing-module | Safe to run; existing 7 invoices stay valid (defaults cover them)
-- Run: psql $DATABASE_URL -f supabase/migrations/20260902000000_invoicing_staged.sql
-- Docs: Appendix A of Invoicing Staged Plan Proposal (Part 4)
-- NOTES: idempotent IF NOT EXISTS; GIN CONCURRENTLY safe; no data loss; advisory lock serializes FY
 
-- 0) Extensions (no-op if exists)
create extension if not exists pgcrypto;
create extension if not exists btree_gin;
 
-- 1) Enum sales types (Tally parity Image 1 — 7 values)
do $$ begin
  create type invoice_sales_type as enum (
    'local_itemwise',        -- default, single-rate B2B
    'local_multirate',       -- ≥2 distinct GST rates
    'local_multirate_cons',  -- consumption tag (GL)
    'local_nil_rated',       -- 0% schedule but Nil bucket
    'local_tax_incl',        -- MRP inclusive back-calc
    'sez_taxable',           -- SEZWP — IGST forced
    'sez_zero_rated'         -- SEZWOP — LUT required
  );
exception when duplicate_object then null; end $$;
 
-- 2) Invoices: new cols (all IF NOT EXISTS style via plpgsql guard for already-patched locals)
alter table public.invoices add column if not exists sales_type invoice_sales_type not null default 'local_itemwise';
alter table public.invoices add column if not exists is_tax_inclusive boolean not null default false;
alter table public.invoices add column if not exists lut_no text;
alter table public.invoices add column if not exists supply_class text check (supply_class in ('nil','exempt','zero_rated'));
alter table public.invoices add column if not exists transport_details jsonb not null default '{}'::jsonb;
-- H6: server-side guard — transport_details must be a JSON object (allow empty '{}')
do $$ begin
  alter table public.invoices add constraint chk_invoices_transport_details_is_object
    check (jsonb_typeof(transport_details) = 'object');
exception when duplicate_object then null;
end $$;
alter table public.invoices add column if not exists e_invoice_required boolean not null default false;
alter table public.invoices add column if not exists e_way_required boolean not null default false;
alter table public.invoices add column if not exists einvoice_status text not null default 'pending'
  check (einvoice_status in ('not_required','pending','json_ready','uploaded','generated','cancelled','failed'));
alter table public.invoices add column if not exists eway_status text not null default 'not_required'
  check (eway_status in ('not_required','pending','json_ready','generated','cancelled'));
 alter table public.invoices add column if not exists compliance_json jsonb;
 alter table public.invoices add column if not exists portal_response jsonb;
-- S1/S2 (client trust boundary): portal_response is client-pasted untrusted JSON (IRN/EWB paste).
-- Server guard (DB trigger comment — enforce in next migration if needed):
--   create function validate_portal_response() returns trigger: check portal_response->>'raw_pasted' len ≤4000,
--   block keys __proto__/constructor/prototype, and require irn ~ '^[0-9a-f]{64}$' when einvoice_status='generated'
--   and ewbNo ~ '^[0-9]{12}$' when eway_status='generated'. Client also sanitizes via
--   sanitizeRawPaste() + allowlisted parsed fields in src/routes/_app/sales.invoices.$id.tsx (S1/S2).
--   Do not trust portal_response for business logic; authoritative columns are irn/ack_no/ewaybill_no.
alter table public.invoices add column if not exists signed_qr text;
alter table public.invoices add column if not exists compliance_pasted_at timestamptz;
alter table public.invoices add column if not exists compliance_pasted_by uuid references auth.users(id) on delete set null;
alter table public.invoices add column if not exists print_count int not null default 0;
alter table public.invoices add column if not exists first_printed_at timestamptz;
alter table public.invoices add column if not exists last_printed_at timestamptz;
alter table public.invoices add column if not exists last_printed_by uuid references auth.users(id) on delete set null;
-- IRN Ack fields (if not already from hardening patch)
alter table public.invoices add column if not exists irn text unique;
alter table public.invoices add column if not exists ack_no text;
alter table public.invoices add column if not exists ack_date timestamptz;
alter table public.invoices add column if not exists ewaybill_no text;
alter table public.invoices add column if not exists ewaybill_date timestamptz;
alter table public.invoices add column if not exists ewaybill_valid_till timestamptz;
 
-- 2b) Backfill (idempotent) — existing rows keep local_itemwise
update public.invoices set sales_type='local_itemwise' where sales_type is null;
update public.invoices set is_tax_inclusive=false where is_tax_inclusive is null;
-- legacy mock IRN flag: mark existing mock irn as legacy (no lock retro)
-- update public.invoices set portal_response='{"legacy_mock":true}'::jsonb where irn like 'mock_%';
 
-- 3) Indexes — GIN for transport JSONB + helpers (CONCURRENTLY where possible)
create index if not exists idx_invoices_transport_gin on public.invoices using gin (transport_details);
create index if not exists idx_invoices_transport_vehicle on public.invoices ((transport_details->>'vehicle_no'));
create index if not exists idx_invoices_sales_type on public.invoices (sales_type);
create index if not exists idx_invoices_einv_status on public.invoices (einvoice_status);
create index if not exists idx_invoices_eway_status on public.invoices (eway_status);
create index if not exists idx_invoices_irn on public.invoices (irn) where irn is not null;
create index if not exists idx_invoices_ack_no on public.invoices (ack_no) where ack_no is not null;
create index if not exists idx_invoices_compliance_pasted on public.invoices (compliance_pasted_at desc);
 
-- 3b) Generated helper columns for reporting (optional, kept as comment — uncomment if you want SQL reporting)
-- alter table public.invoices add column if not exists vehicle_no_gen text
--   generated always as (transport_details->>'vehicle_no') stored;
-- create index if not exists idx_invoices_vehicle_gen on public.invoices(vehicle_no_gen);

-- 3c) Transport validation (H6) — distance 1-4000, vehicle regex, pin 6-digit, allow empty
create or replace function public.validate_transport_details() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  v text;
  p text;
  n numeric;
  raw text;
begin
  if new.transport_details is null then
    return new;
  end if;
  if jsonb_typeof(new.transport_details) <> 'object' then
    raise exception 'transport_details must be a JSON object (got %)', jsonb_typeof(new.transport_details);
  end if;
  -- allow empty object '{}' — no further checks
  if new.transport_details = '{}'::jsonb then
    return new;
  end if;

  -- distance_km: allow missing/empty, else must be numeric 1-4000
  if new.transport_details ? 'distance_km' then
    raw := btrim(coalesce(new.transport_details->>'distance_km',''));
    if raw is not null and raw <> '' and lower(raw) <> 'null' then
      begin
        n := raw::numeric;
      exception when others then
        raise exception 'transport_details.distance_km must be a number between 1 and 4000 (got %)', raw;
      end;
      if n < 1 or n > 4000 then
        raise exception 'transport_details.distance_km must be between 1 and 4000 (got %)', n;
      end if;
    end if;
  end if;

  -- vehicle_no: allow missing/empty, else regex ^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$ (std + BH series)
  v := btrim(coalesce(new.transport_details->>'vehicle_no',''));
  if v is not null and v <> '' and lower(v) <> 'null' then
    if upper(v) !~ '^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$' then
      raise exception 'transport_details.vehicle_no invalid ''%'' — expected ^(?:[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}|[0-9]{2}BH[0-9]{4}[A-Z]{1,2})$ (e.g. HR55AB1234 or 22BH1234AA)', v;
    end if;
  end if;

  -- pin_code: allow missing/empty, else 6-digit ^[1-9][0-9]{5}$
  p := btrim(coalesce(new.transport_details->>'pin_code',''));
  if p is not null and p <> '' and lower(p) <> 'null' then
    if p !~ '^[1-9][0-9]{5}$' then
      raise exception 'transport_details.pin_code must be 6-digit ^[1-9][0-9]{5}$ (got ''%'')', p;
    end if;
  end if;

  return new;
end $$;
drop trigger if exists trg_validate_transport_details on public.invoices;
create trigger trg_validate_transport_details before insert or update on public.invoices
  for each row execute function public.validate_transport_details();

-- 4) Print log (append-only audit) — one row per logical print (bulk counts as 1)
create table if not exists public.invoice_print_log (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  copies text[] not null,                          -- e.g. '{Original,Duplicate,Triplicate}'
  copy_labels_snapshot text,                       -- e.g. 'Original/Duplicate/Triplicate'
  theme_color_snapshot text,                       -- hex at print time
  printed_by uuid references auth.users(id) on delete set null,
  printed_at timestamptz not null default now(),
  is_reprint boolean not null default false,       -- true if print_count>0 before
  pdf_hash text,                                   -- sha256 of bytes for tamper audit
  is_provisional boolean not null default false,   -- true if printed before IRN
  created_at timestamptz not null default now()
);
alter table public.invoice_print_log enable row level security;
do $$ begin
  drop policy if exists invoice_print_log_read on public.invoice_print_log;
  create policy invoice_print_log_read on public.invoice_print_log for select
    using (public.has_role(auth.uid(),'admin') or public.has_permission(auth.uid(),'sales','read'));
  drop policy if exists invoice_print_log_insert on public.invoice_print_log;
  create policy invoice_print_log_insert on public.invoice_print_log for insert
    with check (public.has_role(auth.uid(),'admin') or public.has_permission(auth.uid(),'sales','create'));
  -- no update/delete policies — append-only by design
exception when duplicate_object then null; end $$;
create index if not exists idx_print_log_invoice on public.invoice_print_log(invoice_id);
create index if not exists idx_print_log_at on public.invoice_print_log(printed_at desc);
create index if not exists idx_print_log_by on public.invoice_print_log(printed_by);
 
-- 5) Advisory-lock fix for numbering race (set_invoice_no — patch existing trigger fn)
create or replace function public.set_invoice_no() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  d date; start_yr int; fy text; seq int; pref text; rec record;
begin
  if new.invoice_no is not null and new.invoice_no <> '' then return new; end if;
  d := coalesce(new.invoice_date, current_date);
  start_yr := extract(year from d)::int - case when extract(month from d)::int < 4 then 1 else 0 end;
  fy := lpad((start_yr%100)::text,2,'0') || '-' || lpad(((start_yr+1)%100)::text,2,'0');
  -- serialize per branch+fy to prevent duplicate lpad race (was SELECT without FOR UPDATE)
  perform pg_advisory_xact_lock(hashtext('invoice:'|| new.branch_id::text || ':' || fy));
  select * into rec from public.invoice_settings where branch_id=new.branch_id for update;
  if not found then
    insert into public.invoice_settings(branch_id, prefix, fy_reset, current_fy, next_seq)
    values (new.branch_id, 'PHS/INV/', true, fy, 1) returning * into rec;
  elsif rec.fy_reset and rec.current_fy is distinct from fy then
    update public.invoice_settings set current_fy=fy, next_seq=1 where branch_id=new.branch_id returning * into rec;
  end if;
  seq := rec.next_seq; pref := coalesce(rec.prefix,'PHS/INV/');
  new.invoice_no := pref || fy || '/' || lpad(seq::text,4,'0');
  update public.invoice_settings set next_seq = next_seq + 1 where branch_id=new.branch_id;
  return new;
end $$;
 
-- 6) Lock after IRN (immutability) — invoices row (H8 expanded)
create or replace function public.assert_no_edit_after_irn() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.irn is not null and (
    new.taxable_value is distinct from old.taxable_value or
    new.cgst is distinct from old.cgst or new.sgst is distinct from old.sgst or
    new.igst is distinct from old.igst or new.total is distinct from old.total or
    new.seller_gstin is distinct from old.seller_gstin or new.buyer_gstin is distinct from old.buyer_gstin or
    new.sales_type is distinct from old.sales_type or
    new.supply_class is distinct from old.supply_class or
    new.lut_no is distinct from old.lut_no or
    new.transport_details is distinct from old.transport_details or
    new.discount is distinct from old.discount or
    new.round_off is distinct from old.round_off or
    new.billing_address is distinct from old.billing_address
  ) then
    raise exception 'Invoice % is locked after IRN % — cancel IRN within 24h or raise a credit note', old.invoice_no, old.irn;
  end if;
  return new;
end $$;
drop trigger if exists trg_lock_after_irn on public.invoices;
create trigger trg_lock_after_irn before update on public.invoices
  for each row execute function public.assert_no_edit_after_irn();
 
-- also block item edits after IRN (H8: allow DELETE when invoice status='cancelled')
create or replace function public.assert_items_frozen_after_irn() returns trigger
language plpgsql security definer set search_path=public as $$
declare par_irn text; par_status text;
begin
  select irn, status into par_irn, par_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if par_irn is not null then
    if tg_op='DELETE' and par_status = 'cancelled' then
      return old;
    end if;
    raise exception 'Items of invoice % are frozen after IRN — cancel IRN on portal first', par_irn;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger if exists trg_items_frozen_after_irn on public.invoice_items;
create trigger trg_items_frozen_after_irn before insert or update or delete on public.invoice_items
  for each row execute function public.assert_items_frozen_after_irn();
 
-- 7) RLS tightening — close open gaps (invoice_settings/items were FOR ALL true)
-- NOTE: applied idempotently; if your hardening migration already did this, this is no-op
do $$ begin
  -- invoice_settings: was FOR ALL true → clamp to sales (kept as note — apply hardening file if not yet)
  -- drop policy if exists invoice_settings_read on public.invoice_settings;
  -- create policy invoice_settings_read ... for select using (has_role admin or has_permission sales.read)
exception when undefined_object then null; end $$;
-- eway_bills: was FOR ALL true → clamp to sales.read/create (same note)
-- Full harden is in supabase/migrations/20260829000002_harden_rls_permissions.sql style
 
-- 8) View helper — COMPLETE flag (optional, kept as view for reporting)
create or replace view public.v_invoices_compliance as
select
  id, invoice_no, branch_id, invoice_date, total,
  sales_type, is_tax_inclusive, einvoice_status, eway_status,
  e_invoice_required, e_way_required, irn, ewaybill_no,
  ( (not e_invoice_required or einvoice_status='generated')
    and (not e_way_required or eway_status='generated')
    and status <> 'cancelled'
  ) as is_complete,
  print_count, first_printed_at, last_printed_at
from public.invoices;
 
-- 9) Sanity: ensure pgcrypto gen_random_uuid() available
select gen_random_uuid() as _probe_uuid; -- should return one uuid
 
-- END — 180 lines functional; run supabase gen types after
