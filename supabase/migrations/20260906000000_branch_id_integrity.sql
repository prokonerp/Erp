-- 20260906000000_branch_id_integrity.sql
-- Branch_id nullable integrity + updated_at trigger hardening
-- Purpose: backfill nullable branch_id columns with default branch, add trig for updated_at
-- Safe idempotent: IF NOT EXISTS, no data loss, no DROP without IF EXISTS

-- Ensure helper functions exist (touch_updated_at / update_updated_at_column)
-- Most envs have touch_updated_at; fallback to update_updated_at_column if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'touch_updated_at') THEN
    -- create minimal touch_updated_at if missing (standard pattern)
    CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger AS $f$
    BEGIN NEW.updated_at = now(); RETURN NEW; END; $f$ LANGUAGE plpgsql;
  END IF;
END $$;

-- 1) Backfill nullable branch_id columns with the first available branch (org default)
DO $$
DECLARE def_branch uuid;
BEGIN
  SELECT id INTO def_branch FROM public.branches ORDER BY created_at NULLS LAST, id LIMIT 1;
  IF def_branch IS NULL THEN
    RAISE NOTICE 'branch_id_integrity: no branch exists — skipping backfill';
    RETURN;
  END IF;

  -- quotations.branch_id (added via 20260709, nullable)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quotations' AND column_name='branch_id') THEN
    EXECUTE format('UPDATE public.quotations SET branch_id = %L WHERE branch_id IS NULL', def_branch);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_orders' AND column_name='branch_id') THEN
    EXECUTE format('UPDATE public.sales_orders SET branch_id = %L WHERE branch_id IS NULL', def_branch);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='delivery_challans' AND column_name='branch_id') THEN
    EXECUTE format('UPDATE public.delivery_challans SET branch_id = %L WHERE branch_id IS NULL', def_branch);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='grns' AND column_name='branch_id') THEN
    EXECUTE format('UPDATE public.grns SET branch_id = %L WHERE branch_id IS NULL', def_branch);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gatepasses' AND column_name='branch_id') THEN
    EXECUTE format('UPDATE public.gatepasses SET branch_id = %L WHERE branch_id IS NULL', def_branch);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='warehouses' AND column_name='branch_id') THEN
    EXECUTE format('UPDATE public.warehouses SET branch_id = %L WHERE branch_id IS NULL', def_branch);
  END IF;
END $$;

-- 2) Indexes for branch_id (perf, idempotent)
CREATE INDEX IF NOT EXISTS idx_quotations_branch ON public.quotations(branch_id);
CREATE INDEX IF NOT EXISTS idx_sales_orders_branch ON public.sales_orders(branch_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_branch2 ON public.delivery_challans(branch_id);
CREATE INDEX IF NOT EXISTS idx_grns_branch2 ON public.grns(branch_id);
CREATE INDEX IF NOT EXISTS idx_gatepasses_branch2 ON public.gatepasses(branch_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_branch2 ON public.warehouses(branch_id);

-- 3) updated_at triggers for tables that have updated_at but may lack the trigger
-- quotations
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quotations' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_quotations_updated_at ON public.quotations;
    CREATE TRIGGER trg_quotations_updated_at BEFORE UPDATE ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;
-- sales_orders
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_orders' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_sales_orders_updated_at ON public.sales_orders;
    CREATE TRIGGER trg_sales_orders_updated_at BEFORE UPDATE ON public.sales_orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;
-- delivery_challans (if has updated_at)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='delivery_challans' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_delivery_challans_updated_at ON public.delivery_challans;
    CREATE TRIGGER trg_delivery_challans_updated_at BEFORE UPDATE ON public.delivery_challans FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;
-- grns
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='grns' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_grns_updated_at ON public.grns;
    CREATE TRIGGER trg_grns_updated_at BEFORE UPDATE ON public.grns FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;
-- gatepasses
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gatepasses' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_gatepasses_updated_at ON public.gatepasses;
    CREATE TRIGGER trg_gatepasses_updated_at BEFORE UPDATE ON public.gatepasses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;
-- warehouses (already has trigger but ensure)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='warehouses' AND column_name='updated_at') THEN
    DROP TRIGGER IF EXISTS trg_warehouses_touch2 ON public.warehouses;
    CREATE TRIGGER trg_warehouses_touch2 BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;

-- 4) NOTE: we do NOT force branch_id NOT NULL yet — would break inserts where app explicitly sets branch later.
-- To enforce, run after verifying no NULLs: ALTER TABLE ... ALTER COLUMN branch_id SET NOT NULL;
-- Example (commented, enable once backfill verified):
-- ALTER TABLE public.quotations ALTER COLUMN branch_id SET NOT NULL;
-- ALTER TABLE public.sales_orders ALTER COLUMN branch_id SET NOT NULL;

COMMENT ON COLUMN public.quotations.branch_id IS 'Nullable then backfilled to default branch via 20260906000000; future hardening may SET NOT NULL. Trigger touch_updated_at ensured.';
