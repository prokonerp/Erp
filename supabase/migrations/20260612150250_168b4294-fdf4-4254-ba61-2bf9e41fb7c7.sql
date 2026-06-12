
-- Product categories master
CREATE TABLE IF NOT EXISTS public.product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_categories TO authenticated;
GRANT ALL ON public.product_categories TO service_role;

ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read product categories"
  ON public.product_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert product categories"
  ON public.product_categories FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update product categories"
  ON public.product_categories FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated delete product categories"
  ON public.product_categories FOR DELETE TO authenticated USING (true);

INSERT INTO public.product_categories (name) VALUES
  ('Accessories'), ('CCTV'), ('General'), ('Inverter/Battery'),
  ('Offline UPS'), ('Online UPS'), ('Solar Panel'), ('UPS Battery')
ON CONFLICT (name) DO NOTHING;

-- Dual tax structure on products (keep tax_rate for backward compatibility)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS central_tax_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS local_tax_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS central_tax_exempt BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS local_tax_exempt BOOLEAN NOT NULL DEFAULT false;

-- Backfill: split legacy tax_rate evenly into central+local (CGST/SGST style)
UPDATE public.products
SET central_tax_rate = COALESCE(central_tax_rate, tax_rate / 2),
    local_tax_rate   = COALESCE(local_tax_rate,   tax_rate / 2)
WHERE tax_rate IS NOT NULL
  AND (central_tax_rate IS NULL OR local_tax_rate IS NULL);

-- Make name nullable so UI can auto-derive from brand/model
ALTER TABLE public.products ALTER COLUMN name DROP NOT NULL;
