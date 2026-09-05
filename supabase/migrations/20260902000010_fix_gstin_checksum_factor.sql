-- 20260902000010_fix_gstin_checksum_factor.sql
-- Prokon ERP — Fix GSTIN checksum initial factor 2 → 1 (NIC mod-36 spec)
-- Scope: DDL only — CREATE OR REPLACE FUNCTION, no data deletion, idempotent
-- Reason: gstin_checksum_char must start factor=1 (alternate 1↔2), not 2
-- Fixes: 20260902000003_gstin_lut_hardening.sql factor int := 2 (incorrect)
-- Apply: supabase db push  OR  psql -f this file  OR  SQL Editor paste
-- Verify: select public.validate_gstin_checksum('07AABCU9603R1ZX');
-- Do NOT run DELETE/TRUNCATE — DDL only

-- =============================================================================
-- 1) Corrected GSTIN checksum char (PL/pgSQL port of src/lib/india.ts)
-- Charset: 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ; factor toggles 1↔2 ; sum = Σ (floor(prod/36)+prod%36)
-- =============================================================================

create or replace function public.gstin_checksum_char(gstin14 text) returns text
language plpgsql immutable as $$
declare
  s text;
  charset text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  factor int := 1; -- NIC GSTIN mod-36: start factor 1 (alternate 1↔2) — was incorrectly 2
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

-- =============================================================================
-- 2) Wrapper unchanged (re-applied for completeness — ensures DB matches source)
-- =============================================================================

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

-- No trigger change — existing trg_validate_invoices_gstin_lut continues to use corrected function.
-- Idempotent: CREATE OR REPLACE only; safe to re-run.
