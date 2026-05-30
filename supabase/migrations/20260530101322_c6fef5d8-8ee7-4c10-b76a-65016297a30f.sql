
-- CUSTOMERS (shared master)
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company text NOT NULL,
  contact_name text,
  phone text,
  email text,
  address text,
  gst text,
  remarks text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view customers" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert customers" ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update customers" ON public.customers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete customers" ON public.customers FOR DELETE TO authenticated USING (true);
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- LEADS (owned by the sales executive)
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL,
  title text NOT NULL,
  source text,
  status text NOT NULL DEFAULT 'new',  -- new | follow_up | quoted | won | lost
  expected_value numeric DEFAULT 0,
  closed_value numeric DEFAULT 0,
  next_followup date,
  closed_at date,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own leads select" ON public.leads FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own leads insert" ON public.leads FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own leads update" ON public.leads FOR UPDATE TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own leads delete" ON public.leads FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER trg_leads_updated BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_leads_owner_status ON public.leads(owner_id, status);

-- LEAD ACTIVITIES (follow-up notes)
CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  activity_date date NOT NULL DEFAULT CURRENT_DATE,
  kind text NOT NULL DEFAULT 'note', -- note | call | meeting | email | whatsapp
  notes text,
  next_followup date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_activities TO authenticated;
GRANT ALL ON public.lead_activities TO service_role;
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own act select" ON public.lead_activities FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own act insert" ON public.lead_activities FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own act update" ON public.lead_activities FOR UPDATE TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own act delete" ON public.lead_activities FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- QUOTATIONS
CREATE TABLE public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no text NOT NULL UNIQUE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL,
  quote_date date NOT NULL DEFAULT CURRENT_DATE,
  validity_days integer NOT NULL DEFAULT 15,
  items jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{description, hsn, qty, unit, rate, amount}]
  subtotal numeric NOT NULL DEFAULT 0,
  gst_percent numeric NOT NULL DEFAULT 18,
  gst_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft', -- draft | sent | accepted | rejected
  terms text,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotations TO authenticated;
GRANT ALL ON public.quotations TO service_role;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own q select" ON public.quotations FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own q insert" ON public.quotations FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own q update" ON public.quotations FOR UPDATE TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own q delete" ON public.quotations FOR DELETE TO authenticated USING (owner_id = auth.uid());
CREATE TRIGGER trg_quotations_updated BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto quote-no PHS/YY-YY/NNNN by Indian FY (Apr-Mar)
CREATE OR REPLACE FUNCTION public.set_quote_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  d date := COALESCE(NEW.quote_date, CURRENT_DATE);
  start_yr int;
  end_yr int;
  fy text;
  seq int;
BEGIN
  IF NEW.quote_no IS NULL OR NEW.quote_no = '' THEN
    IF EXTRACT(MONTH FROM d) >= 4 THEN
      start_yr := EXTRACT(YEAR FROM d)::int;
    ELSE
      start_yr := EXTRACT(YEAR FROM d)::int - 1;
    END IF;
    end_yr := start_yr + 1;
    fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');
    SELECT COALESCE(MAX(CAST(split_part(quote_no,'/',3) AS int)),0)+1 INTO seq
      FROM public.quotations WHERE quote_no LIKE 'PHS/'||fy||'/%';
    NEW.quote_no := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_quote_no BEFORE INSERT ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.set_quote_no();

-- INCENTIVE RULES (slabs) - shared
CREATE TABLE public.incentive_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  min_value numeric NOT NULL DEFAULT 0,
  max_value numeric, -- null = infinity
  percent numeric NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incentive_rules TO authenticated;
GRANT ALL ON public.incentive_rules TO service_role;
ALTER TABLE public.incentive_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view rules" ON public.incentive_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth ins rules" ON public.incentive_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth upd rules" ON public.incentive_rules FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth del rules" ON public.incentive_rules FOR DELETE TO authenticated USING (true);

-- INCENTIVE PAYOUT RECORDS
CREATE TABLE public.incentives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL,
  period text, -- e.g. 2026-Q1
  closed_value numeric NOT NULL DEFAULT 0,
  applied_percent numeric NOT NULL DEFAULT 0,
  payout numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending | paid
  paid_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incentives TO authenticated;
GRANT ALL ON public.incentives TO service_role;
ALTER TABLE public.incentives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own inc select" ON public.incentives FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own inc insert" ON public.incentives FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "own inc update" ON public.incentives FOR UPDATE TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "own inc delete" ON public.incentives FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- Seed default slabs (industry-standard B2B tiered model)
INSERT INTO public.incentive_rules (label, min_value, max_value, percent, sort_order) VALUES
  ('Tier 1 (Base)',         0,        500000,   2.0, 1),
  ('Tier 2 (Target)',       500000,   1500000,  3.0, 2),
  ('Tier 3 (Stretch)',      1500000,  3000000,  4.0, 3),
  ('Tier 4 (Accelerator)',  3000000,  NULL,     5.0, 4);
