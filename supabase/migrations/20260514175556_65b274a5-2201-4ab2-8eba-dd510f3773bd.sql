
CREATE TABLE public.amcs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_no TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  client_company TEXT,
  client_address TEXT,
  client_gst TEXT,
  contact_no TEXT,
  email TEXT,
  units JSONB NOT NULL DEFAULT '[]'::jsonb,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  duration_years INT NOT NULL DEFAULT 1,
  amc_value NUMERIC(12,2) DEFAULT 0,
  terms TEXT,
  pm_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  remarks TEXT,
  prev_amc_id UUID REFERENCES public.amcs(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_amcs_end_date ON public.amcs(end_date);
CREATE INDEX idx_amcs_agreement_no ON public.amcs(agreement_no);

ALTER TABLE public.amcs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view amcs" ON public.amcs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert amcs" ON public.amcs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update amcs" ON public.amcs FOR UPDATE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER amcs_touch BEFORE UPDATE ON public.amcs
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.amc_settings (
  id INT PRIMARY KEY DEFAULT 1,
  terms_template TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = 1)
);

ALTER TABLE public.amc_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated view settings" ON public.amc_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert settings" ON public.amc_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update settings" ON public.amc_settings FOR UPDATE TO authenticated USING (true);

INSERT INTO public.amc_settings (id, terms_template) VALUES (1,
'1. This Annual Maintenance Contract covers preventive and breakdown maintenance of the UPS units listed in this agreement.
2. Preventive Maintenance visits will be carried out quarterly during the contract period.
3. Breakdown calls will be attended within 24 hours of intimation on working days.
4. Cost of batteries, capacitors, fans, IGBTs, SMPS cards and other consumable / faulty parts is NOT included in the AMC value unless explicitly stated.
5. Damage due to fire, flood, voltage surges beyond UPS rating, mishandling or unauthorised repairs is excluded from the contract.
6. The AMC value is payable in advance and is non-refundable once the contract is activated.
7. GST as applicable shall be charged extra.
8. Either party may terminate this contract by giving 30 days written notice.
9. Disputes, if any, are subject to Gurgaon jurisdiction only.
10. This agreement is valid only on receipt of full payment against the AMC invoice.');
