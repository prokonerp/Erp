-- 20260902000008_ensure_trigger_exists.sql
-- Prokon ERP — Optional companion to 20260902000007: ensures trigger exists only if missing
-- Why separate: 00007 (func-only) is the primary deadlock-free fix — run it anytime, even with traffic.
-- This file DOES take AccessExclusiveLock on public.invoices (DROP/CREATE TRIGGER), so it must be run
-- during a quiet window (pause invoicing / no concurrent INSERT/UPDATE on invoices) or it will fail fast
-- with lock_not_available (55P03) instead of deadlocking (40P01) thanks to lock_timeout + NOWAIT.
-- Idempotent: guarded by pg_trigger check — if trg_validate_invoices_gstin_lut already exists, does nothing.
-- Usage (quiet window only):
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260902000008_ensure_trigger_exists.sql
-- Pre-check:  SELECT tgname FROM pg_trigger WHERE tgrelid='public.invoices'::regclass AND tgname='trg_validate_invoices_gstin_lut';
-- Post-check: SELECT tgname FROM pg_trigger WHERE tgrelid='public.invoices'::regclass;
--             SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname='trg_validate_invoices_gstin_lut';

-- Fast-fail instead of hang: 2s lock_timeout + NOWAIT converts deadlock (40P01) into retryable 55P03
set lock_timeout = '2s';
set statement_timeout = '30s';

-- Attempt to acquire table lock without waiting — if traffic holds RowExclusiveLock, this errors with 55P03
-- Caller should retry after pausing writers. Do NOT remove NOWAIT unless you want to block up to lock_timeout.
lock table public.invoices in access exclusive mode nowait;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_validate_invoices_gstin_lut'
      and tgrelid = 'public.invoices'::regclass
      and not tgisinternal
  ) then
    -- trigger missing (e.g., 00003 never applied or manually dropped) -> create it
    -- use EXECUTE so the DO block can run DDL conditionally
    execute 'drop trigger if exists trg_validate_invoices_gstin_lut on public.invoices';
    execute 'create trigger trg_validate_invoices_gstin_lut before insert or update on public.invoices for each row execute function public.validate_invoices_gstin_and_lut()';
    raise notice 'trg_validate_invoices_gstin_lut created (was missing)';
  else
    raise notice 'trg_validate_invoices_gstin_lut already exists — skipped';
  end if;
end;
$$;
