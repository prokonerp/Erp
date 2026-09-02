-- 20260902000001_fix_h10_supply_class_guard.sql
-- H10 fix: nil vs zero conflation — enforce supply_class consistency at DB level
-- Existing constraint in 20260902000000 only checks value in ('nil','exempt','zero_rated')
-- This adds sales_type ↔ supply_class alignment guard (allows null supply_class for generic types)

create or replace function public.validate_sales_type_supply_class() returns trigger
language plpgsql as $$
begin
  -- supply_class must be one of allowed values if present (redundant with CHECK but keeps message clear)
  if new.supply_class is not null and new.supply_class not in ('nil','exempt','zero_rated') then
    raise exception 'supply_class must be nil, exempt, or zero_rated (got %)', new.supply_class;
  end if;

  -- nil-rated → must be supply_class = 'nil'
  if new.sales_type = 'local_nil_rated' and new.supply_class is distinct from 'nil' then
    raise exception 'H10 guard: sales_type=local_nil_rated requires supply_class=''nil'' (got %)', coalesce(new.supply_class,'NULL');
  end if;

  -- sez zero-rated → must be supply_class = 'zero_rated'
  if new.sales_type = 'sez_zero_rated' and new.supply_class is distinct from 'zero_rated' then
    raise exception 'H10 guard: sales_type=sez_zero_rated requires supply_class=''zero_rated'' (got %)', coalesce(new.supply_class,'NULL');
  end if;

  -- reverse: if supply_class = 'nil' then sales_type must be local_nil_rated
  if new.supply_class = 'nil' and new.sales_type is distinct from 'local_nil_rated' then
    raise exception 'H10 guard: supply_class=''nil'' requires sales_type=local_nil_rated (got sales_type=%)', new.sales_type;
  end if;

  -- if supply_class = 'zero_rated' then sales_type must be sez_zero_rated (allow future exempt? no)
  if new.supply_class = 'zero_rated' and new.sales_type is distinct from 'sez_zero_rated' then
    raise exception 'H10 guard: supply_class=''zero_rated'' requires sales_type=sez_zero_rated (got sales_type=%)', new.sales_type;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_sales_type_supply_class on public.invoices;
create trigger trg_validate_sales_type_supply_class
  before insert or update on public.invoices
  for each row execute function public.validate_sales_type_supply_class();

-- Optional: backfill sanity — warn if existing rows violate (should be 0)
-- do $$ declare r record; begin for r in select invoice_no, sales_type, supply_class from public.invoices where (sales_type='local_nil_rated' and supply_class is distinct from 'nil') or (sales_type='sez_zero_rated' and supply_class is distinct from 'zero_rated') loop raise warning 'H10 existing violation: % sales_type=% supply_class=%', r.invoice_no, r.sales_type, r.supply_class; end loop; end $$;
