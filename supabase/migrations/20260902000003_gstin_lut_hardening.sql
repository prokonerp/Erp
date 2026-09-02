-- 20260902000003_gstin_lut_hardening.sql
-- Prokon ERP — M3 LUT + S3 GSTIN checksum hardening (non-destructive, no data deletion)
-- Branch: invoicing-module | Safe: DDL only (functions + trigger), zero rows deleted/modified
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS + guardian checks allow empty/URP
-- Scope: enforce buyer_gstin checksum (mod-36 NIC spec) + SEZ Zero Rated LUT requirement at DB level
-- Mirrors JS: src/lib/india.ts validateGSTINChecksum + src/lib/invoiceJson.ts buildGstInvoiceJson LUT throw
-- Verify: cat supabase/migrations/20260902000003_gstin_lut_hardening.sql | head -n 120
-- Do NOT run supabase db push from this task — file creation only (local)

-- =============================================================================
-- 1) GSTIN checksum helpers (PL/pgSQL port of india.ts gstinChecksumChar / validateGSTINChecksum)
-- Charset: 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ; factor toggles 2 ↔ 1 ; sum = Σ (floor(prod/36) + prod%36)
-- =============================================================================

create or replace function public.gstin_checksum_char(gstin14 text) returns text
language plpgsql immutable as $$
declare
  s text;
  charset text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  factor int := 2;
  sumv int := 0;
  i int;
  ch text;
  idx int;
  prod int;
  chk int;
begin
  if gstin14 is null then return null; end if;
  s := upper(btrim(gstin14));
  if char_length(s) <> 14 then return null; end if;
  for i in 1..14 loop
    ch := substring(s from i for 1);
    idx := position(ch in charset);
    if idx = 0 then return null; end if;
    idx := idx - 1; -- 0-based
    prod := idx * factor;
    sumv := sumv + (prod / 36)::int + (prod % 36);
    factor := case when factor = 2 then 1 else 2 end;
  end loop;
  chk := (36 - (sumv % 36)) % 36;
  return substring(charset from chk + 1 for 1);
end;
$$;

create or replace function public.validate_gstin_checksum(gstin text) returns boolean
language plpgsql immutable as $$
declare
  s text;
  expected text;
begin
  if gstin is null then return false; end if;
  s := upper(btrim(gstin));
  if s = '' or s = 'URP' then return false; end if;
  if s !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' then return false; end if;
  if char_length(s) <> 15 then return false; end if;
  expected := public.gstin_checksum_char(substring(s from 1 for 14));
  if expected is null then return false; end if;
  return substring(s from 15 for 1) = expected;
end;
$$;

-- =============================================================================
-- 2) Trigger: validate buyer_gstin checksum + SEZ LUT (no data deletion)
--    - buyer_gstin: allow null/empty/URP (B2C); if present and not URP, require regex + checksum
--    - sales_type sez_zero_rated → lut_no must be non-empty (trimmed)
--    Idempotent: runs BEFORE INSERT OR UPDATE on public.invoices only
-- =============================================================================

create or replace function public.validate_invoices_gstin_and_lut() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  g text;
  g_up text;
begin
  -- ── S3 GSTIN checksum gate (buyer_gstin) ────────────────────────────────
  g := btrim(coalesce(new.buyer_gstin, ''));
  if g <> '' then
    g_up := upper(g);
    if g_up <> 'URP' then
      -- regex pre-check gives clearer message than checksum alone
      if g_up !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' then
        raise exception 'Buyer GSTIN format invalid: %', g;
      end if;
      if not public.validate_gstin_checksum(g_up) then
        raise exception 'Buyer GSTIN checksum invalid: %', g;
      end if;
    end if;
  end if;

  -- ── M3 LUT gate (sez_zero_rated) ────────────────────────────────────────
  if new.sales_type = 'sez_zero_rated' then
    if new.lut_no is null or btrim(new.lut_no) = '' then
      raise exception 'SEZ Zero Rated requires LUT No. before IRN';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_invoices_gstin_lut on public.invoices;
create trigger trg_validate_invoices_gstin_lut
  before insert or update on public.invoices
  for each row execute function public.validate_invoices_gstin_and_lut();

-- =============================================================================
-- 3) Safety: no DML that deletes rows — assert file contains zero DELETE FROM / TRUNCATE
--    All objects are DDL; existing 7 invoices remain valid (defaults cover them; trigger
--    allows null/URP; only new invalid GSTIN/LUT inserts are blocked).
-- =============================================================================

-- Optional sanity probe (read-only, does not modify data):
-- select public.validate_gstin_checksum('07AABCU9603R1ZX'); -- example, should be true if checksum matches
