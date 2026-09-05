-- 20260902000005_fix_gstin_trigger_lenient.sql
-- Prokon ERP — Fix GSTIN/LUT trigger to be lenient for existing rows (non-destructive)
-- Problem: 20260902000003 validated buyer_gstin on EVERY UPDATE, so fixing invoice_no on a row with historic invalid GSTIN (06ADCPN3225D1Z3) was blocked.
-- Fix: grandfather existing invalid GSTINs — only validate when buyer_gstin IS DISTINCT FROM OLD (or INSERT). Same for LUT — only when sales_type or lut_no changes.
-- No rows deleted/modified — DDL only, idempotent CREATE OR REPLACE.

create or replace function public.validate_invoices_gstin_and_lut() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  g text;
  g_up text;
  old_g text;
begin
  -- ── S3 GSTIN checksum gate (buyer_gstin) — lenient: only when changed or INSERT ──
  -- Allow existing invalid GSTIN to stay if you are not touching it (e.g., fixing invoice_no)
  if TG_OP = 'INSERT' then
    old_g := null;
  else
    old_g := btrim(coalesce(old.buyer_gstin, ''));
  end if;
  g := btrim(coalesce(new.buyer_gstin, ''));
  -- only validate if g is new/distinct from old
  if g <> '' and (TG_OP = 'INSERT' or g is distinct from old_g) then
    g_up := upper(g);
    if g_up <> 'URP' then
      if g_up !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' then
        raise exception 'Buyer GSTIN format invalid: %', g;
      end if;
      if not public.validate_gstin_checksum(g_up) then
        raise exception 'Buyer GSTIN checksum invalid: %', g;
      end if;
    end if;
  end if;

  -- ── M3 LUT gate (sez_zero_rated) — lenient: only when sales_type or lut_no changes ──
  if new.sales_type = 'sez_zero_rated' then
    -- on INSERT, lut must exist; on UPDATE, only check if sales_type or lut_no changed
    if TG_OP = 'INSERT' then
      if new.lut_no is null or btrim(new.lut_no) = '' then
        raise exception 'SEZ Zero Rated requires LUT No. before IRN';
      end if;
    else
      if (new.sales_type is distinct from old.sales_type) or (new.lut_no is distinct from old.lut_no) then
        if new.lut_no is null or btrim(new.lut_no) = '' then
          raise exception 'SEZ Zero Rated requires LUT No. before IRN';
        end if;
      end if;
      -- if neither changed, grandfather existing row (even if lut is null) to allow invoice_no fixes
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_invoices_gstin_lut on public.invoices;
create trigger trg_validate_invoices_gstin_lut
  before insert or update on public.invoices
  for each row execute function public.validate_invoices_gstin_and_lut();
