-- 20260907000000_quotations_search_speed.sql
-- Fix quotation search slowness: denormalize customer company + trigram indexes + composite RLS-friendly indexes
-- SAFE: additive only, no drops without IF EXISTS

-- Ensure pg_trgm exists (used by 20260824 perf_masters_picker)
create extension if not exists pg_trgm;

-- 1) Denormalized customer company for single-table ilike without JOIN
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS customer_company text;

-- Backfill from customers (one-time, idempotent)
UPDATE public.quotations q
SET customer_company = c.company
FROM public.customers c
WHERE c.id = q.customer_id
  AND (q.customer_company IS NULL OR q.customer_company <> c.company);

-- 2) Trigram indexes for fast ILIKE %term% (leading wildcard)
CREATE INDEX IF NOT EXISTS idx_quotations_quote_no_trgm
  ON public.quotations USING gin (quote_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quotations_subject_trgm
  ON public.quotations USING gin (subject gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quotations_reference_no_trgm
  ON public.quotations USING gin (reference_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_quotations_customer_company_trgm
  ON public.quotations USING gin (customer_company gin_trgm_ops);

-- 3) B-tree / composite indexes for RLS + ordering + status filter
-- RLS is owner_id = auth.uid(), so index on owner_id helps
CREATE INDEX IF NOT EXISTS idx_quotations_owner_id
  ON public.quotations (owner_id);
CREATE INDEX IF NOT EXISTS idx_quotations_owner_created
  ON public.quotations (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_status
  ON public.quotations (status);
CREATE INDEX IF NOT EXISTS idx_quotations_created_at
  ON public.quotations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotations_customer_id
  ON public.quotations (customer_id);
-- Composite for default pipeline view (latest + created_at)
CREATE INDEX IF NOT EXISTS idx_quotations_is_latest_created
  ON public.quotations (is_latest, created_at DESC) WHERE is_latest = true;

-- 4) Helper functions to keep customer_company in sync
CREATE OR REPLACE FUNCTION public.sync_quotation_customer_company()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    SELECT company INTO NEW.customer_company FROM public.customers WHERE id = NEW.customer_id;
  ELSE
    NEW.customer_company := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_quotation_customer_company ON public.quotations;
CREATE TRIGGER trg_sync_quotation_customer_company
  BEFORE INSERT OR UPDATE OF customer_id ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.sync_quotation_customer_company();

-- Propagate customer company changes to quotations (async after update)
CREATE OR REPLACE FUNCTION public.propagate_customer_company_to_quotations()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.company IS DISTINCT FROM OLD.company THEN
    UPDATE public.quotations SET customer_company = NEW.company WHERE customer_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_propagate_customer_company ON public.customers;
CREATE TRIGGER trg_propagate_customer_company
  AFTER UPDATE OF company ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.propagate_customer_company_to_quotations();

-- 5) Analyze for planner
ANALYZE public.quotations;
ANALYZE public.customers;

COMMENT ON COLUMN public.quotations.customer_company IS 'Denormalized customers.company for fast single-table ILIKE search (no JOIN). Kept in sync via triggers on quotations/customer.';
