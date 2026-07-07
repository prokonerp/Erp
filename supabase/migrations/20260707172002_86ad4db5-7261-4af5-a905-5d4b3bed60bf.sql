
-- ============ PURCHASE ORDER MODULE ============

-- 1. Module registration
INSERT INTO public.app_modules (key, label, supports_import)
VALUES ('po', 'Purchase Orders', false)
ON CONFLICT (key) DO NOTHING;

-- 2. PO Settings (per-branch numbering)
CREATE TABLE IF NOT EXISTS public.po_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL DEFAULT 'PROKON/PO/',
  fy_reset BOOLEAN NOT NULL DEFAULT true,
  current_fy TEXT,
  next_seq INT NOT NULL DEFAULT 1,
  terms_default TEXT,
  notes_default TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_settings TO authenticated;
GRANT ALL ON public.po_settings TO service_role;
ALTER TABLE public.po_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po_settings read"  ON public.po_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "po_settings write" ON public.po_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Purchase Orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no TEXT UNIQUE,
  po_date DATE NOT NULL DEFAULT CURRENT_DATE,
  delivery_date DATE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id),

  vendor_name TEXT,
  vendor_gstin TEXT,
  vendor_address TEXT,
  vendor_contact_name TEXT,
  vendor_phone TEXT,
  vendor_email TEXT,
  vendor_state_code TEXT,
  vendor_state_name TEXT,

  buyer_name TEXT,
  buyer_gstin TEXT,
  buyer_state_code TEXT,
  buyer_state_name TEXT,
  buyer_address TEXT,

  -- Delivery
  delivery_address_type TEXT NOT NULL DEFAULT 'org' CHECK (delivery_address_type IN ('org','customer','custom')),
  delivery_address TEXT,
  customer_id UUID REFERENCES public.customers(id),
  customer_name TEXT,

  payment_terms TEXT,
  is_interstate BOOLEAN NOT NULL DEFAULT false,

  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess NUMERIC(14,2) NOT NULL DEFAULT 0,
  round_off NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_in_words TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','sent','partial','completed','cancelled')),

  notes TEXT,
  terms TEXT,

  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po read"   ON public.purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "po insert" ON public.purchase_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "po update" ON public.purchase_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "po delete" ON public.purchase_orders FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_po_touch BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Purchase Order Items
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sr_no INT NOT NULL DEFAULT 1,
  product_id UUID REFERENCES public.products(id),
  description TEXT NOT NULL,
  hsn TEXT,
  qty NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit TEXT,
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  received_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated;
GRANT ALL ON public.purchase_order_items TO service_role;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po_items all" ON public.purchase_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON public.purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_date ON public.purchase_orders(po_date DESC);

-- 5. Auto PO number trigger
CREATE OR REPLACE FUNCTION public.set_po_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s public.po_settings%ROWTYPE;
  d DATE := COALESCE(NEW.po_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.po_no IS NOT NULL AND NEW.po_no <> '' THEN
    RETURN NEW;
  END IF;

  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  SELECT * INTO s FROM public.po_settings WHERE branch_id = NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.po_settings (branch_id, prefix, fy_reset, current_fy, next_seq)
      VALUES (NEW.branch_id, 'PROKON/PO/', true, fy, 1)
      RETURNING * INTO s;
  END IF;

  IF s.fy_reset AND (s.current_fy IS NULL OR s.current_fy <> fy) THEN
    UPDATE public.po_settings SET current_fy = fy, next_seq = 1
      WHERE id = s.id RETURNING * INTO s;
  END IF;

  seq := s.next_seq;
  new_prefix := COALESCE(s.prefix, 'PROKON/PO/');

  IF s.fy_reset THEN
    NEW.po_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');
  ELSE
    NEW.po_no := new_prefix || to_char(d,'YYYY') || '/' || lpad(seq::text, 4, '0');
  END IF;

  UPDATE public.po_settings SET next_seq = next_seq + 1 WHERE id = s.id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_po_set_no BEFORE INSERT ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.set_po_no();
