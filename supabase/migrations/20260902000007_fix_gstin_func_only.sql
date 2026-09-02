-- 20260902000007_fix_gstin_func_only.sql
-- Prokon ERP — Minimal deadlock-free fix: replaces ONLY the trigger function (no trigger DDL)
-- Why deadlock-free: CREATE OR REPLACE FUNCTION only takes AccessExclusiveLock on pg_proc (the function
--   object itself), NOT on public.invoices. Trigger DDL on public.invoices takes
--   AccessExclusiveLock on the TABLE which deadlocks (40P01) / lock_not_available (55P03) with
--   concurrent INSERT/UPDATE that hold RowExclusiveLock on invoices. This file avoids that entirely
--   so it is safe even with concurrent invoicing traffic — no quiet window needed.
--   Only pg_proc is locked, so no deadlock even with concurrent traffic.
-- Usage: paste this SINGLE statement into Supabase SQL Editor (single-statement paste), OR:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260902000007_fix_gstin_func_only.sql
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -c "$(cat supabase/migrations/20260902000007_fix_gstin_func_only.sql)"
--   Both pooler (6543) and direct (5432) are safe for this file since no table lock is taken.
-- Idempotent: CREATE OR REPLACE FUNCTION is idempotent; safe to re-run any number of times.
-- Contains: single DDL only — no transaction wrapper, no trigger DDL, no table lock — just one statement.
-- Effect: new logic grandfathers old invalid GSTIN — validates buyer_gstin only when it IS DISTINCT FROM OLD (or INSERT),
--   and validates LUT only when sales_type or lut_no changed (or INSERT). Allows fixing invoice_no on rows like 06ADCPN3225D1Z3.

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
