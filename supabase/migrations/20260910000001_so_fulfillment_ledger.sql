-- Migration: 20260910000001_so_fulfillment_ledger.sql
-- Sales Order split-delivery — fulfillment ledger (header + lines) + blocker removal + traceability links
-- Part of: SO Conversion V2 (§5.1)
-- SAFE: additive only (IF NOT EXISTS / DROP IF EXISTS), idempotent, rerunnable via psql
-- Depends on: sales_orders, delivery_challans, invoices, general_delivery_challans, branches, warehouses
-- extensions required: pgcrypto (gen_random_uuid), pg_trgm is NOT needed here

-- ═══════════════════════════════════════════════════════════════════
-- 1) Enum for conversion type
-- ═══════════════════════════════════════════════════════════════════

DO $$ BEGIN
  CREATE TYPE public.so_conversion_type AS ENUM ('tax_invoice','general_dc','proforma_invoice','delivery_challan');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 2) Conversions ledger header
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.so_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  conversion_type public.so_conversion_type NOT NULL,
  target_table text NOT NULL CHECK (target_table IN ('invoices','general_delivery_challans','delivery_challans','proforma_invoices')),
  target_id uuid NOT NULL,
  target_no text,
  status text NOT NULL DEFAULT 'draft',
  prior_fulfilled jsonb NOT NULL DEFAULT '[]'::jsonb,
  this_fulfilled  jsonb NOT NULL DEFAULT '[]'::jsonb,
  balance_after   jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_table, target_id)
);

CREATE INDEX IF NOT EXISTS idx_so_conv_so ON public.so_conversions(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_so_conv_type ON public.so_conversions(conversion_type);
CREATE INDEX IF NOT EXISTS idx_so_conv_target ON public.so_conversions(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_so_conv_created_at ON public.so_conversions(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════
-- 3) Per-line fulfillment detail (one row per SO line per conversion)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.so_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  conversion_id uuid NOT NULL REFERENCES public.so_conversions(id) ON DELETE CASCADE,
  line_index int NOT NULL CHECK (line_index >= 0),
  product_id uuid,
  ordered_qty numeric(14,3) NOT NULL CHECK (ordered_qty >= 0),
  this_qty    numeric(14,3) NOT NULL CHECK (this_qty >= 0),
  warehouse_id uuid REFERENCES public.warehouses(id),
  serial_numbers text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversion_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_so_ful_so_line ON public.so_fulfillments(sales_order_id, line_index);
CREATE INDEX IF NOT EXISTS idx_so_ful_product ON public.so_fulfillments(product_id);
CREATE INDEX IF NOT EXISTS idx_so_ful_conversion ON public.so_fulfillments(conversion_id);
CREATE INDEX IF NOT EXISTS idx_so_ful_warehouse ON public.so_fulfillments(warehouse_id);

-- ═══════════════════════════════════════════════════════════════════
-- 4) Allow multiple docs per SO: drop unique blocker, keep non-unique index
-- ═══════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS public.uq_dc_sales_order;
CREATE INDEX IF NOT EXISTS idx_dc_sales_order ON public.delivery_challans(sales_order_id);

-- ═══════════════════════════════════════════════════════════════════
-- 5) Link columns for traceability
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.so_conversions(id) ON DELETE SET NULL;
-- linked_proforma_id FK defers to 20260910000002 (proforma_invoices not yet created at this point in migration order)
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS linked_proforma_id uuid;
CREATE INDEX IF NOT EXISTS idx_invoices_conversion ON public.invoices(conversion_id);
CREATE INDEX IF NOT EXISTS idx_invoices_linked_proforma ON public.invoices(linked_proforma_id);

ALTER TABLE public.general_delivery_challans ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE SET NULL;
ALTER TABLE public.general_delivery_challans ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.so_conversions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gdc_so ON public.general_delivery_challans(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_gdc_conversion ON public.general_delivery_challans(conversion_id);

ALTER TABLE public.delivery_challans ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.so_conversions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dc_conversion ON public.delivery_challans(conversion_id);

-- ═══════════════════════════════════════════════════════════════════
-- 6) Updated-at trigger (reuse touch_updated_at if present, else create set_updated_at)
--    Plan specifies set_updated_at(); we create it idempotently and also keep
--    touch_updated_at compatibility. Both do NEW.updated_at = now().
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Keep touch_updated_at as alias for compatibility (idempotent; no DO wrapper needed — CREATE OR REPLACE is already idempotent)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $func$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $func$;

DROP TRIGGER IF EXISTS trg_so_conv_updated ON public.so_conversions;
CREATE TRIGGER trg_so_conv_updated BEFORE UPDATE ON public.so_conversions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Grants (RLS policies are in 20260910000004_rls_fulfillment.sql; keep table accessible to authenticated/service_role)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.so_conversions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.so_fulfillments TO authenticated;
GRANT ALL ON public.so_conversions TO service_role;
GRANT ALL ON public.so_fulfillments TO service_role;

-- Analyze for planner
ANALYZE public.so_conversions;
ANALYZE public.so_fulfillments;
