-- Migration: 20260910000002_proforma_invoices.sql
-- Sales Order split-delivery — Proforma Invoices table + numbering (read-only, no stock) + settings
-- Part of: SO Conversion V2 (§5.2)
-- SAFE: additive only (IF NOT EXISTS / DROP IF EXISTS), idempotent
-- Depends on: branches, customers, sales_orders, so_conversions (from 20260910000001)
-- Uses: pgcrypto (gen_random_uuid), pg_trgm (gin_trgm_ops)

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ═══════════════════════════════════════════════════════════════════
-- 1) proforma_invoices — read-only, no stock trigger
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.proforma_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_no text UNIQUE,
  proforma_date date NOT NULL DEFAULT CURRENT_DATE,
  branch_id uuid REFERENCES public.branches(id),
  customer_id uuid REFERENCES public.customers(id),
  sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  conversion_id uuid REFERENCES public.so_conversions(id) ON DELETE SET NULL,

  -- snapshots (same naming as invoices for template reuse)
  seller_name text,
  seller_gstin text,
  seller_state text,
  seller_state_code text,
  seller_address text,
  buyer_name text,
  buyer_gstin text,
  buyer_state text,
  buyer_state_code text,
  billing_address text,
  shipping_address text,
  place_of_supply text,
  place_of_supply_code text,
  is_interstate boolean DEFAULT false,
  reverse_charge boolean DEFAULT false,

  po_number text,
  po_date date,

  subtotal numeric(14,2) DEFAULT 0,
  discount numeric(14,2) DEFAULT 0,
  taxable_value numeric(14,2) DEFAULT 0,
  cgst numeric(14,2) DEFAULT 0,
  sgst numeric(14,2) DEFAULT 0,
  igst numeric(14,2) DEFAULT 0,
  cess numeric(14,2) DEFAULT 0,
  round_off numeric(14,2) DEFAULT 0,
  total numeric(14,2) DEFAULT 0,
  total_in_words text,
  shipping_charges numeric(14,2) DEFAULT 0,
  adjustment numeric(14,2) DEFAULT 0,
  tcs_percent numeric(14,2) DEFAULT 0,
  tcs_amount numeric(14,2) DEFAULT 0,
  discount_label text,
  discount_amount numeric(14,2) DEFAULT 0,

  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  prior_fulfilled jsonb NOT NULL DEFAULT '[]'::jsonb,
  this_fulfilled  jsonb NOT NULL DEFAULT '[]'::jsonb,

  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  notes text,
  terms text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid
);

CREATE INDEX IF NOT EXISTS idx_proforma_so ON public.proforma_invoices(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_proforma_branch ON public.proforma_invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_proforma_customer ON public.proforma_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_proforma_status ON public.proforma_invoices(status);
CREATE INDEX IF NOT EXISTS idx_proforma_date ON public.proforma_invoices(proforma_date DESC);
CREATE INDEX IF NOT EXISTS idx_proforma_no_trgm ON public.proforma_invoices USING gin (proforma_no gin_trgm_ops);

-- ═══════════════════════════════════════════════════════════════════
-- 2) Numbering settings (per-branch, FY-reset like sales_order_settings)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.proforma_invoice_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid UNIQUE REFERENCES public.branches(id),
  prefix text NOT NULL DEFAULT 'PHS/PI/',
  fy_reset boolean NOT NULL DEFAULT true,
  current_fy text,
  next_seq int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proforma_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proforma_invoice_settings TO authenticated;
GRANT ALL ON public.proforma_invoices TO service_role;
GRANT ALL ON public.proforma_invoice_settings TO service_role;

ALTER TABLE public.proforma_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proforma_invoice_settings ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════════════════════════
-- 3) Numbering function — mirrors set_so_no() exactly
--    FY Apr-Mar: fy = YY-YY where YY rolls Apr 1
--    Advisory lock: hashtextextended('proforma_no:'||branch)
--    Atomic upsert + fy_reset handling (next_seq reset to 2 on FY change, seq=1)
--    SECURITY DEFINER so trigger can read/update settings under tightened RLS
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_proforma_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  s public.proforma_invoice_settings%ROWTYPE;
  d DATE := COALESCE(NEW.proforma_date, CURRENT_DATE);
  start_yr INT;
  end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
  br uuid;
BEGIN
  IF NEW.proforma_no IS NOT NULL AND NEW.proforma_no <> '' THEN
    RETURN NEW;
  END IF;

  br := NEW.branch_id;

  -- FY Apr-Mar (same derivation as set_so_no)
  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  PERFORM pg_advisory_xact_lock(hashtextextended('proforma_no:' || COALESCE(br::text, 'null'), 0));

  SELECT * INTO s FROM public.proforma_invoice_settings WHERE branch_id IS NOT DISTINCT FROM br;
  IF NOT FOUND THEN
    INSERT INTO public.proforma_invoice_settings (branch_id, prefix, current_fy, next_seq)
      VALUES (br, COALESCE(s.prefix, 'PHS/PI/'), fy, 2)
      ON CONFLICT (branch_id) DO NOTHING;
    SELECT * INTO s FROM public.proforma_invoice_settings WHERE branch_id IS NOT DISTINCT FROM br;
    seq := 1;
  ELSE
    UPDATE public.proforma_invoice_settings
       SET current_fy = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN fy ELSE current_fy END,
           next_seq   = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN 2 ELSE next_seq + 1 END,
           updated_at = now()
     WHERE id = s.id
     RETURNING next_seq - CASE WHEN fy_reset AND (s.current_fy IS DISTINCT FROM fy) THEN 1 ELSE 0 END
       INTO seq;
    -- Re-fetch prefix in case it was updated concurrently
    SELECT prefix INTO new_prefix FROM public.proforma_invoice_settings WHERE id = s.id;
    s.prefix := COALESCE(new_prefix, s.prefix);
  END IF;

  new_prefix := COALESCE(s.prefix, 'PHS/PI/');
  NEW.proforma_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');
  RETURN NEW;
END
$function$;

-- ═══════════════════════════════════════════════════════════════════
-- 4) Triggers
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_proforma_no ON public.proforma_invoices;
CREATE TRIGGER trg_proforma_no BEFORE INSERT ON public.proforma_invoices FOR EACH ROW EXECUTE FUNCTION public.set_proforma_no();

DROP TRIGGER IF EXISTS trg_proforma_updated ON public.proforma_invoices;
CREATE TRIGGER trg_proforma_updated BEFORE UPDATE ON public.proforma_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_proforma_settings_touch ON public.proforma_invoice_settings;
CREATE TRIGGER trg_proforma_settings_touch BEFORE UPDATE ON public.proforma_invoice_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Back-fill FK for invoices.linked_proforma_id now that proforma_invoices exists (deferred from 00001)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_linked_proforma_id_fkey'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_linked_proforma_id_fkey
      FOREIGN KEY (linked_proforma_id) REFERENCES public.proforma_invoices(id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ANALYZE public.proforma_invoices;
ANALYZE public.proforma_invoice_settings;
