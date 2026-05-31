-- Quotations: Zoho-style fields
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS reference_no text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS salesperson text,
  ADD COLUMN IF NOT EXISTS project_name text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS shipping_address text,
  ADD COLUMN IF NOT EXISTS place_of_supply text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_charges numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_off numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_notes text,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Customers: state + split addresses for auto GST
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS shipping_address text;

-- Terms templates
CREATE TABLE IF NOT EXISTS public.quote_terms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  body text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_terms_templates TO authenticated;
GRANT ALL ON public.quote_terms_templates TO service_role;
ALTER TABLE public.quote_terms_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view qtt" ON public.quote_terms_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth ins qtt" ON public.quote_terms_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth upd qtt" ON public.quote_terms_templates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth del qtt" ON public.quote_terms_templates FOR DELETE TO authenticated USING (true);

-- CRM settings (single row)
CREATE TABLE IF NOT EXISTS public.crm_settings (
  id integer PRIMARY KEY DEFAULT 1,
  business_state text NOT NULL DEFAULT 'Haryana',
  business_gstin text,
  default_terms text NOT NULL DEFAULT '',
  default_customer_notes text NOT NULL DEFAULT 'Thanks for your business.',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_settings_singleton CHECK (id = 1)
);
GRANT SELECT, INSERT, UPDATE ON public.crm_settings TO authenticated;
GRANT ALL ON public.crm_settings TO service_role;
ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view crms" ON public.crm_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth ins crms" ON public.crm_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth upd crms" ON public.crm_settings FOR UPDATE TO authenticated USING (true);

INSERT INTO public.crm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Seed a couple of default terms templates
INSERT INTO public.quote_terms_templates (name, body, is_default, sort_order)
SELECT 'Standard', E'1. Prices are exclusive of GST as applicable.\n2. Payment: 100% advance along with PO.\n3. Delivery: Within 2-3 weeks from receipt of PO & payment.\n4. Warranty: As per manufacturer''s standard warranty.\n5. This quotation is valid for 15 days from the date of issue.', true, 0
WHERE NOT EXISTS (SELECT 1 FROM public.quote_terms_templates);

INSERT INTO public.quote_terms_templates (name, body, is_default, sort_order)
SELECT 'AMC', E'1. AMC charges are exclusive of GST.\n2. Covers 4 preventive maintenance visits per year.\n3. Spare parts/batteries are NOT included.\n4. Payment: 100% advance.\n5. Validity: 15 days.', false, 1
WHERE NOT EXISTS (SELECT 1 FROM public.quote_terms_templates WHERE name = 'AMC');