
CREATE SEQUENCE IF NOT EXISTS public.grn_customer_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.grn_oem_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.grn_general_seq START 1;

CREATE TABLE public.grns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grn_no TEXT UNIQUE,
  category TEXT NOT NULL CHECK (category IN ('customer','oem','general')),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Received','QC Pending','Approved','Rejected')),
  grn_date DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_date DATE,
  reference_no TEXT,
  source_doc_type TEXT,
  source_doc_no TEXT,
  source_doc_date DATE,
  po_no TEXT,
  invoice_no TEXT,
  invoice_date DATE,
  ticket_no TEXT,

  source_name TEXT,
  source_code TEXT,
  source_address TEXT,
  source_contact_person TEXT,
  source_contact_number TEXT,
  source_email TEXT,
  source_gstin TEXT,
  oem_plant TEXT,

  transporter_name TEXT,
  vehicle_number TEXT,
  driver_name TEXT,
  driver_mobile TEXT,
  lr_number TEXT,
  mode_of_transport TEXT,
  num_packages TEXT,
  total_weight TEXT,

  items JSONB NOT NULL DEFAULT '[]'::jsonb,

  qc_status TEXT,
  qc_inspector TEXT,
  qc_date DATE,
  qc_remarks TEXT,
  accepted_qty NUMERIC,
  rejected_qty NUMERIC,

  warehouse_id UUID,
  warehouse_name TEXT,
  storage_location TEXT,
  bin_no TEXT,

  attachments JSONB DEFAULT '[]'::jsonb,

  internal_remarks TEXT,
  receipt_remarks TEXT,

  received_by TEXT,
  checked_by TEXT,
  approved_by TEXT,

  oem_logo_url TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grns TO authenticated;
GRANT ALL ON public.grns TO service_role;
GRANT USAGE ON SEQUENCE public.grn_customer_seq, public.grn_oem_seq, public.grn_general_seq TO authenticated, service_role;

ALTER TABLE public.grns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grns_select" ON public.grns FOR SELECT TO authenticated USING (true);
CREATE POLICY "grns_insert" ON public.grns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "grns_update" ON public.grns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "grns_delete" ON public.grns FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.set_grn_no()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE yr TEXT := to_char(now(),'YYYY'); seq INT;
BEGIN
  IF NEW.grn_no IS NULL OR NEW.grn_no = '' THEN
    IF NEW.category = 'customer' THEN
      seq := nextval('public.grn_customer_seq');
      NEW.grn_no := 'GRN-CUST/' || yr || '/' || lpad(seq::text, 4, '0');
    ELSIF NEW.category = 'oem' THEN
      seq := nextval('public.grn_oem_seq');
      NEW.grn_no := 'GRN-OEM/' || yr || '/' || lpad(seq::text, 4, '0');
    ELSE
      seq := nextval('public.grn_general_seq');
      NEW.grn_no := 'GRN-GEN/' || yr || '/' || lpad(seq::text, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_set_grn_no BEFORE INSERT ON public.grns
  FOR EACH ROW EXECUTE FUNCTION public.set_grn_no();

CREATE TRIGGER trg_grn_touch BEFORE UPDATE ON public.grns
  FOR EACH ROW EXECUTE FUNCTION public.dc_touch_updated_at();
