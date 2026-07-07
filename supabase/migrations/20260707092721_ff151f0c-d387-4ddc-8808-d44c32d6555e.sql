-- =============================================================================
-- HEAD SALES: GST-compliant Invoicing, Payments, e-Way Bill
-- =============================================================================

-- --- Extend branches with full seller identity ---------------------------------
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS state_name TEXT,
  ADD COLUMN IF NOT EXISTS state_code TEXT,
  ADD COLUMN IF NOT EXISTS pan TEXT,
  ADD COLUMN IF NOT EXISTS cin TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account TEXT,
  ADD COLUMN IF NOT EXISTS bank_ifsc TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS upi_id TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS invoice_footer TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- --- Extend products with GST rate + stock-on-invoice flag ---------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS track_stock_on_invoice BOOLEAN NOT NULL DEFAULT false;

-- --- Extend customers with state code for GST engine ---------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS state_code TEXT;

-- =============================================================================
-- INVOICE SETTINGS (per branch)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoice_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL DEFAULT 'PHS/INV/',
  fy_reset BOOLEAN NOT NULL DEFAULT true,
  current_fy TEXT,
  next_seq INT NOT NULL DEFAULT 1,
  terms_default TEXT,
  notes_default TEXT,
  place_of_supply_default TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_settings TO authenticated;
GRANT ALL ON public.invoice_settings TO service_role;
ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_settings_read" ON public.invoice_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoice_settings_write" ON public.invoice_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_invoice_settings_updated_at BEFORE UPDATE ON public.invoice_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =============================================================================
-- INVOICES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT UNIQUE,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),

  -- captured seller snapshot (in case branch details change later)
  seller_name TEXT,
  seller_gstin TEXT,
  seller_state TEXT,
  seller_state_code TEXT,
  seller_address TEXT,

  -- captured buyer snapshot
  buyer_name TEXT,
  buyer_gstin TEXT,
  buyer_state TEXT,
  buyer_state_code TEXT,
  billing_address TEXT,
  shipping_address TEXT,
  place_of_supply TEXT,
  place_of_supply_code TEXT,

  is_interstate BOOLEAN NOT NULL DEFAULT false,
  reverse_charge BOOLEAN NOT NULL DEFAULT false,

  linked_quote_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL,
  linked_dc_ids UUID[] DEFAULT '{}',

  -- money (all in INR, rounded to 2)
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess NUMERIC(14,2) NOT NULL DEFAULT 0,
  round_off NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_in_words TEXT,

  status TEXT NOT NULL DEFAULT 'draft', -- draft | issued | partial | paid | cancelled
  cancel_reason TEXT,
  cancelled_at TIMESTAMPTZ,

  -- e-Invoice (IRN) fields
  irn TEXT,
  ack_no TEXT,
  ack_date TIMESTAMPTZ,
  qr_payload TEXT,
  einvoice_status TEXT, -- null | pending | generated | cancelled | failed
  einvoice_error TEXT,

  -- e-Way Bill
  ewaybill_no TEXT,
  ewaybill_date TIMESTAMPTZ,
  ewaybill_valid_till TIMESTAMPTZ,

  notes TEXT,
  terms TEXT,
  pdf_url TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_read" ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "invoices_delete_admin" ON public.invoices FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_invoices_date ON public.invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_branch ON public.invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =============================================================================
-- INVOICE ITEMS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  sr_no INT NOT NULL DEFAULT 1,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  hsn TEXT,
  qty NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit TEXT,
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_items_all" ON public.invoice_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);

-- =============================================================================
-- PAYMENTS RECEIVED
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS public.payment_no_seq;

CREATE TABLE IF NOT EXISTS public.payments_received (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_no TEXT UNIQUE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  mode TEXT NOT NULL DEFAULT 'bank', -- bank | cash | upi | cheque | neft | rtgs | card
  reference TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  unallocated NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments_received TO authenticated;
GRANT ALL ON public.payments_received TO service_role;
ALTER TABLE public.payments_received ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_read" ON public.payments_received FOR SELECT TO authenticated USING (true);
CREATE POLICY "payments_insert" ON public.payments_received FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "payments_update" ON public.payments_received FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "payments_delete_admin" ON public.payments_received FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_payments_received_updated_at BEFORE UPDATE ON public.payments_received
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.set_payment_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE yr TEXT := to_char(now(),'YYYY'); seq BIGINT;
BEGIN
  IF NEW.payment_no IS NULL OR NEW.payment_no = '' THEN
    seq := nextval('public.payment_no_seq');
    NEW.payment_no := 'PHS/RCPT/' || yr || '/' || lpad(seq::text, 4, '0');
  END IF;
  IF NEW.unallocated IS NULL THEN NEW.unallocated := NEW.amount; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_set_payment_no BEFORE INSERT ON public.payments_received
  FOR EACH ROW EXECUTE FUNCTION public.set_payment_no();

-- =============================================================================
-- PAYMENT ALLOCATIONS (payment ↔ invoice, many-to-many with amounts)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments_received(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay_alloc_all" ON public.payment_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_payment ON public.payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_invoice ON public.payment_allocations(invoice_id);

-- Trigger: after allocation change, refresh invoice + payment aggregates
CREATE OR REPLACE FUNCTION public.refresh_invoice_and_payment_balances()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  inv_id UUID;
  pay_id UUID;
  inv_total NUMERIC(14,2);
  paid NUMERIC(14,2);
  pay_amount NUMERIC(14,2);
  allocated NUMERIC(14,2);
BEGIN
  inv_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  pay_id := COALESCE(NEW.payment_id, OLD.payment_id);

  -- Payment side
  SELECT amount INTO pay_amount FROM public.payments_received WHERE id = pay_id;
  SELECT COALESCE(SUM(amount),0) INTO allocated FROM public.payment_allocations WHERE payment_id = pay_id;
  IF allocated > pay_amount + 0.01 THEN
    RAISE EXCEPTION 'Cannot allocate more (%) than payment amount (%)', allocated, pay_amount;
  END IF;
  UPDATE public.payments_received SET unallocated = pay_amount - allocated WHERE id = pay_id;

  -- Invoice side
  SELECT total INTO inv_total FROM public.invoices WHERE id = inv_id;
  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.payment_allocations WHERE invoice_id = inv_id;
  UPDATE public.invoices
     SET total_paid = paid,
         status = CASE
           WHEN status = 'cancelled' THEN 'cancelled'
           WHEN paid >= inv_total - 0.01 THEN 'paid'
           WHEN paid > 0 THEN 'partial'
           WHEN status IN ('draft') THEN 'draft'
           ELSE 'issued'
         END
   WHERE id = inv_id;

  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_pay_alloc_refresh
AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.refresh_invoice_and_payment_balances();

-- =============================================================================
-- E-WAY BILLS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.eway_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  transporter_name TEXT,
  transporter_id TEXT,
  vehicle_no TEXT,
  distance_km NUMERIC(8,2),
  transport_mode TEXT, -- road | rail | air | ship
  doc_type TEXT DEFAULT 'INV',
  ewb_no TEXT,
  ewb_date TIMESTAMPTZ,
  valid_till TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | generated | cancelled | failed
  payload JSONB,
  response JSONB,
  error TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eway_bills TO authenticated;
GRANT ALL ON public.eway_bills TO service_role;
ALTER TABLE public.eway_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eway_all" ON public.eway_bills FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_eway_bills_updated_at BEFORE UPDATE ON public.eway_bills
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =============================================================================
-- INVOICE NUMBER GENERATOR (per branch, FY-aware)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_invoice_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  s public.invoice_settings%ROWTYPE;
  d DATE := COALESCE(NEW.invoice_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.invoice_no IS NOT NULL AND NEW.invoice_no <> '' THEN
    RETURN NEW;
  END IF;

  -- Fiscal year (Apr-Mar)
  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  SELECT * INTO s FROM public.invoice_settings WHERE branch_id = NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.invoice_settings (branch_id, current_fy, next_seq)
      VALUES (NEW.branch_id, fy, 1)
      RETURNING * INTO s;
  END IF;

  -- FY reset
  IF s.fy_reset AND (s.current_fy IS NULL OR s.current_fy <> fy) THEN
    UPDATE public.invoice_settings
       SET current_fy = fy, next_seq = 1
     WHERE id = s.id
    RETURNING * INTO s;
  END IF;

  seq := s.next_seq;
  new_prefix := COALESCE(s.prefix, 'PHS/INV/');

  NEW.invoice_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');

  UPDATE public.invoice_settings SET next_seq = next_seq + 1 WHERE id = s.id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_set_invoice_no BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_no();

-- =============================================================================
-- Register the new sales module in the permissions system
-- =============================================================================
INSERT INTO public.app_modules (key, label, sort_order, supports_import, is_active)
VALUES ('sales', 'Sales & Invoicing', 25, false, true)
ON CONFLICT (key) DO NOTHING;
