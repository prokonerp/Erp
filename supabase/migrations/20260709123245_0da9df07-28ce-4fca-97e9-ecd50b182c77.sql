
-- 1. Sales order sequence settings (per-branch, FY-reset like invoice/PO)
CREATE TABLE IF NOT EXISTS public.sales_order_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID,
  prefix TEXT NOT NULL DEFAULT 'PHS/SO/',
  fy_reset BOOLEAN NOT NULL DEFAULT true,
  current_fy TEXT,
  next_seq INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_order_settings TO authenticated;
GRANT ALL ON public.sales_order_settings TO service_role;
ALTER TABLE public.sales_order_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "so_settings authenticated read"  ON public.sales_order_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "so_settings authenticated write" ON public.sales_order_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "so_settings authenticated update" ON public.sales_order_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "so_settings authenticated delete" ON public.sales_order_settings FOR DELETE TO authenticated USING (true);

-- 2. Sales orders table
CREATE TABLE IF NOT EXISTS public.sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  so_no TEXT UNIQUE,
  so_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  expected_delivery DATE,
  branch_id UUID,
  customer_id UUID,
  seller_name TEXT,
  seller_gstin TEXT,
  seller_state TEXT,
  seller_state_code TEXT,
  seller_address TEXT,
  buyer_name TEXT,
  buyer_gstin TEXT,
  buyer_state TEXT,
  buyer_state_code TEXT,
  billing_address TEXT,
  shipping_address TEXT,
  place_of_supply TEXT,
  place_of_supply_code TEXT,
  is_interstate BOOLEAN DEFAULT false,
  reverse_charge BOOLEAN DEFAULT false,
  contact_person TEXT,
  contact_email TEXT,
  contact_mobile TEXT,
  salesperson TEXT,
  payment_terms TEXT,
  delivery_timeline TEXT,
  po_number TEXT,
  po_date DATE,
  subtotal NUMERIC(14,2) DEFAULT 0,
  discount NUMERIC(14,2) DEFAULT 0,
  taxable_value NUMERIC(14,2) DEFAULT 0,
  cgst NUMERIC(14,2) DEFAULT 0,
  sgst NUMERIC(14,2) DEFAULT 0,
  igst NUMERIC(14,2) DEFAULT 0,
  cess NUMERIC(14,2) DEFAULT 0,
  round_off NUMERIC(14,2) DEFAULT 0,
  total NUMERIC(14,2) DEFAULT 0,
  total_in_words TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  terms TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_quote_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_orders_customer_idx ON public.sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS sales_orders_quote_idx ON public.sales_orders(linked_quote_id);
CREATE INDEX IF NOT EXISTS sales_orders_status_idx ON public.sales_orders(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_orders TO authenticated;
GRANT ALL ON public.sales_orders TO service_role;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_orders authenticated read"   ON public.sales_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "sales_orders authenticated insert" ON public.sales_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "sales_orders authenticated update" ON public.sales_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sales_orders authenticated delete" ON public.sales_orders FOR DELETE TO authenticated USING (true);

-- 3. Numbering trigger
CREATE OR REPLACE FUNCTION public.set_so_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  s public.sales_order_settings%ROWTYPE;
  d DATE := COALESCE(NEW.so_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.so_no IS NOT NULL AND NEW.so_no <> '' THEN RETURN NEW; END IF;

  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  SELECT * INTO s FROM public.sales_order_settings WHERE branch_id IS NOT DISTINCT FROM NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.sales_order_settings (branch_id, current_fy, next_seq)
      VALUES (NEW.branch_id, fy, 1) RETURNING * INTO s;
  END IF;

  IF s.fy_reset AND (s.current_fy IS NULL OR s.current_fy <> fy) THEN
    UPDATE public.sales_order_settings SET current_fy = fy, next_seq = 1
      WHERE id = s.id RETURNING * INTO s;
  END IF;

  seq := s.next_seq;
  new_prefix := COALESCE(s.prefix, 'PHS/SO/');
  NEW.so_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');
  UPDATE public.sales_order_settings SET next_seq = next_seq + 1 WHERE id = s.id;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_set_so_no ON public.sales_orders;
CREATE TRIGGER trg_set_so_no BEFORE INSERT ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_so_no();

DROP TRIGGER IF EXISTS trg_so_touch_updated ON public.sales_orders;
CREATE TRIGGER trg_so_touch_updated BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_so_settings_touch ON public.sales_order_settings;
CREATE TRIGGER trg_so_settings_touch BEFORE UPDATE ON public.sales_order_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Parent references on existing tables
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS converted_to_so_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quotation_id  UUID REFERENCES public.quotations(id)   ON DELETE SET NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dc_sales_order_idx ON public.delivery_challans(sales_order_id);
CREATE INDEX IF NOT EXISTS invoices_so_idx ON public.invoices(sales_order_id);
