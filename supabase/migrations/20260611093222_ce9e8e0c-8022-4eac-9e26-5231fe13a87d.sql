
CREATE TABLE public.warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'Godown',
  address text,
  city text,
  state text,
  pincode text,
  contact_person text,
  contact_number text,
  email text,
  status text NOT NULL DEFAULT 'Active',
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX warehouses_code_unique ON public.warehouses (lower(code));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO authenticated;
GRANT ALL ON public.warehouses TO service_role;

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view warehouses" ON public.warehouses FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins warehouses" ON public.warehouses FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admin upd warehouses" ON public.warehouses FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "admin del warehouses" ON public.warehouses FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_warehouses_touch BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.serials ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS serials_warehouse_idx ON public.serials(warehouse_id);

ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES public.warehouses(id) ON DELETE SET NULL;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS serial_format text;
