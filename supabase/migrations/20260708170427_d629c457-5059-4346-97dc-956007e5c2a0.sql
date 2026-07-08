
-- UPS bundle master and battery catalog for Smart Sales
CREATE TABLE public.ups_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  label TEXT,
  ups_load_watts NUMERIC(10,2),
  items JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{product_id, qty, description, note}]
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_product_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ups_bundles TO authenticated;
GRANT ALL ON public.ups_bundles TO service_role;
ALTER TABLE public.ups_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read ups_bundles" ON public.ups_bundles FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write ups_bundles" ON public.ups_bundles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_ups_bundles_updated BEFORE UPDATE ON public.ups_bundles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.battery_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  brand TEXT,
  model TEXT,
  voltage NUMERIC(6,2) NOT NULL DEFAULT 12,
  ah NUMERIC(8,2) NOT NULL,
  tier TEXT NOT NULL DEFAULT 'standard', -- economy | standard | premium
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.battery_catalog TO authenticated;
GRANT ALL ON public.battery_catalog TO service_role;
ALTER TABLE public.battery_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read battery_catalog" ON public.battery_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write battery_catalog" ON public.battery_catalog FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_battery_catalog_updated BEFORE UPDATE ON public.battery_catalog FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
