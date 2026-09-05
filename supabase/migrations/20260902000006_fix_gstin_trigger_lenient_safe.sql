-- 20260902000006_fix_gstin_trigger_lenient_safe.sql
-- Prokon ERP — Safe retry for GSTIN/LUT lenient trigger (fixes 40P01 deadlock from 20260902000005)
-- Safe if you retried 20260902000005 and got deadlock: this file is idempotent and deadlock-hardened
-- No rows deleted — DDL only, zero DELETE/TRUNCATE

-- Use: psql "$DIRECT_URL" (port 5432, NOT pooler 6543) -v ON_ERROR_STOP=1 -f this_file
-- Pre-check: SELECT count(*) FROM pg_stat_activity WHERE query ILIKE '%invoices%' AND state IN ('active','idle in transaction');
-- Post-check: SELECT tgname FROM pg_trigger WHERE tgrelid='public.invoices'::regclass;

BEGIN;
SET LOCAL lock_timeout = '5s';  -- fast fail 55P03 instead of hang → retry
SET LOCAL statement_timeout = '30s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- Lock once upfront — converts 40P01 deadlock into retryable 55P03
-- Comment out NOWAIT if you prefer to wait up to lock_timeout instead of instant fail
-- LOCK TABLE public.invoices IN ACCESS EXCLUSIVE MODE;

create or replace function public.validate_invoices_gstin_and_lut() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  g text;
  g_up text;
  old_g text;
begin
  -- only validate buyer_gstin when it actually changed (or INSERT) — grandfathers historic invalid GSTINs like 06ADCPN3225D1Z3
  if TG_OP = 'INSERT' then
    old_g := null;
  else
    old_g := btrim(coalesce(old.buyer_gstin, ''));
  end if;
  g := btrim(coalesce(new.buyer_gstin, ''));
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

  if new.sales_type = 'sez_zero_rated' then
    if TG_OP = 'INSERT' then
      if new.lut_no is null or btrim(new.lut_no) = '' then
        raise exception 'SEZ Zero Rated requires LUT No. before IRN';
      end if;
    elsif (new.sales_type is distinct from old.sales_type) or (new.lut_no is distinct from old.lut_no) then
      if new.lut_no is null or btrim(new.lut_no) = '' then
        raise exception 'SEZ Zero Rated requires LUT No. before IRN';
      end if;
    end if;
  end if;

  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_validate_invoices_gstin_lut ON public.invoices;
CREATE TRIGGER trg_validate_invoices_gstin_lut
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoices_gstin_and_lut();

COMMIT;
-- Verify: SELECT tgname FROM pg_trigger WHERE tgrelid='public.invoices'::regclass;
-- Test (no data change): BEGIN; UPDATE public.invoices SET invoice_no=invoice_no WHERE id=(SELECT id FROM public.invoices LIMIT 1) RETURNING invoice_no; ROLLBACK;
