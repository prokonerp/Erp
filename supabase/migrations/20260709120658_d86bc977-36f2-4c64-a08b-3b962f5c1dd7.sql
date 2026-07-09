
CREATE TABLE IF NOT EXISTS public.product_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  child_product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  default_qty numeric(14,3) NOT NULL DEFAULT 1,
  mandatory boolean NOT NULL DEFAULT false,
  editable_qty boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_bundles_no_self CHECK (parent_product_id <> child_product_id),
  CONSTRAINT product_bundles_unique_pair UNIQUE (parent_product_id, child_product_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_bundles TO authenticated;
GRANT ALL ON public.product_bundles TO service_role;

ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read product bundles"
  ON public.product_bundles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert product bundles"
  ON public.product_bundles FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update product bundles"
  ON public.product_bundles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete product bundles"
  ON public.product_bundles FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS product_bundles_parent_idx ON public.product_bundles(parent_product_id);
CREATE INDEX IF NOT EXISTS product_bundles_child_idx  ON public.product_bundles(child_product_id);

CREATE TRIGGER product_bundles_touch_updated_at
  BEFORE UPDATE ON public.product_bundles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
