-- 20260902000009_allow_draft_gstin.sql
-- Allow Draft invoices to save even with checksum-invalid GSTIN; only block Issue
-- Non-destructive: CREATE OR REPLACE, no rows deleted

create or replace function public.validate_invoices_gstin_and_lut() returns trigger
language plpgsql security definer set search_path = public as $$
declare g text; g_up text; old_g text;
begin
  -- Only enforce GSTIN/LUT when moving to issued/pending (not for draft)
  -- Draft is a working copy — you can save with bad GSTIN and fix before Issue
  if new.status = 'draft' then
    return new;
  end if;

  if TG_OP = 'INSERT' then old_g := null; else old_g := btrim(coalesce(old.buyer_gstin, '')); end if;
  g := btrim(coalesce(new.buyer_gstin, ''));
  if g <> '' and (TG_OP = 'INSERT' or g is distinct from old_g) then
    g_up := upper(g);
    if g_up <> 'URP' then
      if g_up !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$' then
        raise exception 'Buyer GSTIN format invalid: %', g;
      end if;
      if not public.validate_gstin_checksum(g_up) then
        raise exception 'Buyer GSTIN checksum invalid: % — correct customer GSTIN before Issue (or save as Draft)', g;
      end if;
    end if;
  end if;

  if new.sales_type = 'sez_zero_rated' then
    if TG_OP = 'INSERT' then
      if new.lut_no is null or btrim(new.lut_no) = '' then
        raise exception 'SEZ Zero Rated requires LUT No. before Issue';
      end if;
    elsif (new.sales_type is distinct from old.sales_type) or (new.lut_no is distinct from old.lut_no) then
      if new.lut_no is null or btrim(new.lut_no) = '' then
        raise exception 'SEZ Zero Rated requires LUT No. before Issue';
      end if;
    end if;
  end if;

  return new;
end;
$$;
