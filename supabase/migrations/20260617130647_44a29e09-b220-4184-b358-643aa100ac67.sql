
INSERT INTO public.product_categories (name)
VALUES ('Spare Parts')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.product_spare_parts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  spare_part_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  CONSTRAINT product_spare_parts_unique UNIQUE (parent_product_id, spare_part_id),
  CONSTRAINT product_spare_parts_no_self CHECK (parent_product_id <> spare_part_id)
);

CREATE INDEX IF NOT EXISTS idx_psp_parent ON public.product_spare_parts(parent_product_id);
CREATE INDEX IF NOT EXISTS idx_psp_spare  ON public.product_spare_parts(spare_part_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_spare_parts TO authenticated;
GRANT ALL ON public.product_spare_parts TO service_role;

ALTER TABLE public.product_spare_parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "psp_select_auth" ON public.product_spare_parts
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "psp_insert_auth" ON public.product_spare_parts
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "psp_update_auth" ON public.product_spare_parts
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "psp_delete_auth" ON public.product_spare_parts
  FOR DELETE TO authenticated USING (true);
