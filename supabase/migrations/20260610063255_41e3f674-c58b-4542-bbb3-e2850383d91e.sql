
-- Extend products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS tax_rate numeric,
  ADD COLUMN IF NOT EXISTS serial_tracking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS serial_mode text NOT NULL DEFAULT 'Manual',
  ADD COLUMN IF NOT EXISTS warranty_applicable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warranty_type text,
  ADD COLUMN IF NOT EXISTS warranty_duration integer,
  ADD COLUMN IF NOT EXISTS warranty_unit text DEFAULT 'Months',
  ADD COLUMN IF NOT EXISTS warranty_start_from text DEFAULT 'Invoice Date',
  ADD COLUMN IF NOT EXISTS warranty_manual_override boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON public.products (lower(sku)) WHERE sku IS NOT NULL AND sku <> '';

-- Serials
CREATE TABLE IF NOT EXISTS public.serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  serial_number text NOT NULL,
  purchase_invoice_no text,
  purchase_date date,
  supplier_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  sale_invoice_no text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  installation_date date,
  warranty_start_date date,
  warranty_end_date date,
  status text NOT NULL DEFAULT 'In Stock',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS serials_serial_number_unique ON public.serials (lower(serial_number));
CREATE INDEX IF NOT EXISTS serials_product_idx ON public.serials (product_id);
CREATE INDEX IF NOT EXISTS serials_status_idx ON public.serials (status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.serials TO authenticated;
GRANT ALL ON public.serials TO service_role;

ALTER TABLE public.serials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view serials" ON public.serials FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert serials" ON public.serials FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update serials" ON public.serials FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins can delete serials" ON public.serials FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_serials_touch BEFORE UPDATE ON public.serials FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
