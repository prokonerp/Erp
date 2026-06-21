
CREATE SEQUENCE IF NOT EXISTS public.dc_customer_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.dc_oem_seq START 1;

CREATE TABLE public.delivery_challans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  challan_no TEXT NOT NULL UNIQUE,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('customer','oem')),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted','Dispatched','Cancelled')),
  challan_date DATE NOT NULL DEFAULT CURRENT_DATE,
  dispatch_date DATE,
  reference_no TEXT,
  gate_pass_no TEXT,
  sales_order_no TEXT,
  customer_po_no TEXT,
  invoice_no TEXT,
  -- party
  party_name TEXT,
  party_code TEXT,
  gstin TEXT,
  oem_plant TEXT,
  contact_person TEXT,
  contact_number TEXT,
  email TEXT,
  delivery_address TEXT,
  -- transport
  transporter_name TEXT,
  vehicle_number TEXT,
  driver_name TEXT,
  driver_mobile TEXT,
  lr_number TEXT,
  mode_of_transport TEXT,
  num_packages TEXT,
  total_weight TEXT,
  -- items: [{sr, part_no, part_name, description, uom, qty, batch_no, model_no, serial_no}]
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  internal_remarks TEXT,
  dispatch_remarks TEXT,
  prepared_by TEXT,
  checked_by TEXT,
  approved_by TEXT,
  oem_logo_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.set_dc_challan_no()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE yr TEXT := to_char(now(),'YYYY'); seq INT;
BEGIN
  IF NEW.challan_no IS NULL OR NEW.challan_no = '' THEN
    IF NEW.doc_type = 'customer' THEN
      seq := nextval('public.dc_customer_seq');
      NEW.challan_no := 'DC-CUST/' || yr || '/' || lpad(seq::text, 4, '0');
    ELSE
      seq := nextval('public.dc_oem_seq');
      NEW.challan_no := 'DC-OEM/' || yr || '/' || lpad(seq::text, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_set_dc_challan_no BEFORE INSERT ON public.delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.set_dc_challan_no();

CREATE OR REPLACE FUNCTION public.dc_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_dc_touch_updated BEFORE UPDATE ON public.delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_challans TO authenticated;
GRANT ALL ON public.delivery_challans TO service_role;

ALTER TABLE public.delivery_challans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth view delivery_challans" ON public.delivery_challans
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert delivery_challans" ON public.delivery_challans
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by OR created_by IS NULL);
CREATE POLICY "Owner or admin update delivery_challans" ON public.delivery_challans
  FOR UPDATE TO authenticated USING (auth.uid() = created_by OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admin delete delivery_challans" ON public.delivery_challans
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX idx_dc_doc_type ON public.delivery_challans(doc_type);
CREATE INDEX idx_dc_created ON public.delivery_challans(created_at DESC);
