CREATE TABLE public.installed_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  model_no text NOT NULL,
  serial_no text,
  invoice_no text,
  invoice_date date,
  warranty_months integer NOT NULL DEFAULT 12,
  amc_start_date date,
  amc_end_date date,
  remarks text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.installed_equipment TO authenticated;
GRANT ALL ON public.installed_equipment TO service_role;

ALTER TABLE public.installed_equipment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ie_select_authenticated" ON public.installed_equipment
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ie_insert_authenticated" ON public.installed_equipment
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ie_update_authenticated" ON public.installed_equipment
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "ie_delete_admin" ON public.installed_equipment
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_installed_equipment_customer ON public.installed_equipment(customer_id);
CREATE INDEX idx_installed_equipment_serial ON public.installed_equipment(lower(serial_no));

CREATE TRIGGER trg_installed_equipment_updated_at
  BEFORE UPDATE ON public.installed_equipment
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();