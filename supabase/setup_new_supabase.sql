-- ============================================================================
--  PROKON ERP - COMPLETE SUPABASE SETUP
-- ============================================================================
--  This script replicates the ENTIRE database of the current Supabase project
--  (project ref: vimkodursmcsaptrrzbl) for use on a brand-new Supabase project.
--
--  It contains the full merged output of all 138 migrations in supabase/migrations
--  (applied in chronological order), which cover:
--     * All tables (82) in the `public` schema
--     * All functions / RPCs (110) e.g. has_role, claim_admin,
--       is_designated_owner, record_user_activity, admin_edit_grn_reverse, ...
--     * All Row Level Security (RLS) policies (424) on tables AND storage.objects
--     * All triggers (91) + sequences
--     * Storage RLS policies for the ticket-attachments / amc-agreements /
--       oem-logos buckets
--     * Seed / master data (app_modules, app_roles, settings, master lists, ...)
--
--  HOW TO USE (pick one):
--    1. Supabase CLI (recommended - keeps history + lets you run it as a migration):
--         supabase login
--         supabase link --project-ref <NEW_PROJECT_REF>
--         supabase db push
--       (db push replays supabase/migrations; this merged file is a convenience
--        single-file equivalent.)
--    2. SQL Editor / psql:
--         Open the Supabase Dashboard > SQL Editor, paste this whole file, Run.
--       or: psql "$DATABASE_URL" -f supabase/setup_new_supabase.sql
--
--  AFTER RUNNING (things that are configured OUTSIDE migrations):
--     * Storage buckets are created at the bottom of this file (they were
--       previously created via the Dashboard).
--     * Enable any extensions you need in Dashboard > Database > Extensions
--       (most are enabled by default on new projects; the block below adds the
--       ones this project relies on, using IF NOT EXISTS so it is a no-op if
--       already present).
--     * Any service_role / publishable keys for the new project go in .env.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions (IF NOT EXISTS => safe on fresh projects)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgjwt;       -- JWT helpers
CREATE EXTENSION IF NOT EXISTS pg_net;      -- async HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_cron;     -- scheduled jobs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- uuid helpers


-- =====================================================================
-- SOURCE: 20260514170826_b02cb31b-c720-4d9b-b1b2-2eac30d2c691.sql
-- =====================================================================

-- Products catalog
CREATE TABLE public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'Nos',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sequence for challan numbers
CREATE SEQUENCE public.challan_seq START 1;

-- Gatepasses
CREATE TABLE public.gatepasses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  challan_no TEXT NOT NULL UNIQUE,
  gatepass_date DATE NOT NULL DEFAULT CURRENT_DATE,
  gatepass_time TIME NOT NULL DEFAULT CURRENT_TIME,
  person_name TEXT NOT NULL,
  person_company TEXT,
  contact_no TEXT,
  vehicle_no TEXT,
  destination TEXT,
  purpose TEXT,
  return_type TEXT NOT NULL DEFAULT 'Non-Returnable', -- Returnable / Non-Returnable
  items JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{product, serial_no, quantity, unit, remarks}]
  remarks TEXT,
  prepared_by TEXT,
  authorised_by TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger to auto-generate challan_no
CREATE OR REPLACE FUNCTION public.set_challan_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.challan_no IS NULL OR NEW.challan_no = '' THEN
    NEW.challan_no := 'PHT/' || to_char(now(), 'YYYY') || '/' ||
                      lpad(nextval('public.challan_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_challan_no
BEFORE INSERT ON public.gatepasses
FOR EACH ROW EXECUTE FUNCTION public.set_challan_no();

-- RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gatepasses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view products" ON public.products
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert products" ON public.products
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update products" ON public.products
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete products" ON public.products
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated can view gatepasses" ON public.gatepasses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert gatepasses" ON public.gatepasses
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update gatepasses" ON public.gatepasses
  FOR UPDATE TO authenticated USING (true);

-- Seed a few starter products (user can add/remove)
INSERT INTO public.products (name, unit) VALUES
  ('Laptop', 'Nos'),
  ('Monitor', 'Nos'),
  ('Cable', 'Mtr'),
  ('Tool Kit', 'Set');


-- =====================================================================
-- SOURCE: 20260514174225_9b984aac-d7da-429a-a0c6-85de70ecea5b.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_challan_no()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  yr TEXT := to_char(now(), 'YYYY');
  seq INT;
BEGIN
  IF NEW.challan_no IS NULL OR NEW.challan_no = '' THEN
    SELECT COALESCE(MAX(CAST(split_part(challan_no,'/',3) AS INT)),0)+1 INTO seq
      FROM public.gatepasses WHERE challan_no LIKE 'PHS/'||yr||'/%';
    NEW.challan_no := 'PHS/' || yr || '/' || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

-- =====================================================================
-- SOURCE: 20260514174523_133c0c30-4d7d-40f4-b12a-a6f7e0e902a2.sql
-- =====================================================================
UPDATE public.gatepasses SET challan_no = REPLACE(challan_no, 'PHT/', 'PHS/') WHERE challan_no LIKE 'PHT/%';

-- =====================================================================
-- SOURCE: 20260514175556_65b274a5-2201-4ab2-8eba-dd510f3773bd.sql
-- =====================================================================

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


-- =====================================================================
-- SOURCE: 20260526025600_3dbc29aa-234f-4dcf-8c32-643edb3775c4.sql
-- =====================================================================

CREATE TABLE public.pm_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amc_id uuid NOT NULL REFERENCES public.amcs(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  completed_at timestamptz,
  completed_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (amc_id, scheduled_date)
);

CREATE INDEX idx_pm_visits_scheduled ON public.pm_visits(scheduled_date);
CREATE INDEX idx_pm_visits_amc ON public.pm_visits(amc_id);

ALTER TABLE public.pm_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view pm_visits" ON public.pm_visits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert pm_visits" ON public.pm_visits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update pm_visits" ON public.pm_visits FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete pm_visits" ON public.pm_visits FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_pm_visits_updated_at
BEFORE UPDATE ON public.pm_visits
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Sync function: create pm_visits rows from amcs.pm_dates
CREATE OR REPLACE FUNCTION public.sync_pm_visits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  d text;
BEGIN
  IF NEW.pm_dates IS NOT NULL THEN
    FOR d IN SELECT jsonb_array_elements_text(NEW.pm_dates)
    LOOP
      INSERT INTO public.pm_visits (amc_id, scheduled_date)
      VALUES (NEW.id, d::date)
      ON CONFLICT (amc_id, scheduled_date) DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_amcs_sync_pm
AFTER INSERT OR UPDATE OF pm_dates ON public.amcs
FOR EACH ROW EXECUTE FUNCTION public.sync_pm_visits();

-- Backfill existing AMCs
INSERT INTO public.pm_visits (amc_id, scheduled_date)
SELECT a.id, (d)::date
FROM public.amcs a, jsonb_array_elements_text(a.pm_dates) d
ON CONFLICT (amc_id, scheduled_date) DO NOTHING;


-- =====================================================================
-- SOURCE: 20260530101322_c6fef5d8-8ee7-4c10-b76a-65016297a30f.sql
-- =====================================================================

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


-- =====================================================================
-- SOURCE: 20260531165556_93ff8bde-3cf8-473b-9767-03242fd1fd67.sql
-- =====================================================================
-- Quotations: Zoho-style fields
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS reference_no text,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS expiry_date date,
  ADD COLUMN IF NOT EXISTS salesperson text,
  ADD COLUMN IF NOT EXISTS project_name text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS shipping_address text,
  ADD COLUMN IF NOT EXISTS place_of_supply text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_charges numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_off numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_notes text,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Customers: state + split addresses for auto GST
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS billing_address text,
  ADD COLUMN IF NOT EXISTS shipping_address text;

-- Terms templates
CREATE TABLE IF NOT EXISTS public.quote_terms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  body text NOT NULL DEFAULT '',
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_terms_templates TO authenticated;
GRANT ALL ON public.quote_terms_templates TO service_role;
ALTER TABLE public.quote_terms_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view qtt" ON public.quote_terms_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth ins qtt" ON public.quote_terms_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth upd qtt" ON public.quote_terms_templates FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth del qtt" ON public.quote_terms_templates FOR DELETE TO authenticated USING (true);

-- CRM settings (single row)
CREATE TABLE IF NOT EXISTS public.crm_settings (
  id integer PRIMARY KEY DEFAULT 1,
  business_state text NOT NULL DEFAULT 'Haryana',
  business_gstin text,
  default_terms text NOT NULL DEFAULT '',
  default_customer_notes text NOT NULL DEFAULT 'Thanks for your business.',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_settings_singleton CHECK (id = 1)
);
GRANT SELECT, INSERT, UPDATE ON public.crm_settings TO authenticated;
GRANT ALL ON public.crm_settings TO service_role;
ALTER TABLE public.crm_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth view crms" ON public.crm_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth ins crms" ON public.crm_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth upd crms" ON public.crm_settings FOR UPDATE TO authenticated USING (true);

INSERT INTO public.crm_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Seed a couple of default terms templates
INSERT INTO public.quote_terms_templates (name, body, is_default, sort_order)
SELECT 'Standard', E'1. Prices are exclusive of GST as applicable.\n2. Payment: 100% advance along with PO.\n3. Delivery: Within 2-3 weeks from receipt of PO & payment.\n4. Warranty: As per manufacturer''s standard warranty.\n5. This quotation is valid for 15 days from the date of issue.', true, 0
WHERE NOT EXISTS (SELECT 1 FROM public.quote_terms_templates);

INSERT INTO public.quote_terms_templates (name, body, is_default, sort_order)
SELECT 'AMC', E'1. AMC charges are exclusive of GST.\n2. Covers 4 preventive maintenance visits per year.\n3. Spare parts/batteries are NOT included.\n4. Payment: 100% advance.\n5. Validity: 15 days.', false, 1
WHERE NOT EXISTS (SELECT 1 FROM public.quote_terms_templates WHERE name = 'AMC');

-- =====================================================================
-- SOURCE: 20260602092531_aa5a1327-972d-4b51-a053-b32b671a2c54.sql
-- =====================================================================

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id text NOT NULL UNIQUE,
  call_type text NOT NULL DEFAULT 'OOW',
  product text,
  serial_no text,
  customer_name text NOT NULL,
  customer_address text,
  customer_email text,
  customer_phone text,
  location text,
  complaint text,
  status text NOT NULL DEFAULT 'New',
  assigned_engineer_name text,
  assigned_engineer_phone text,
  assigned_at timestamptz,
  parts_used boolean NOT NULL DEFAULT false,
  parts_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  quotation_id uuid,
  customer_id uuid,
  closed_at timestamptz,
  remarks text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;
GRANT ALL ON public.tickets TO service_role;

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth view tickets" ON public.tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert tickets" ON public.tickets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update tickets" ON public.tickets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete tickets" ON public.tickets FOR DELETE TO authenticated USING (true);

CREATE TRIGGER tickets_touch BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.ticket_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'note',
  from_status text,
  to_status text,
  notes text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticket_activities TO authenticated;
GRANT ALL ON public.ticket_activities TO service_role;

ALTER TABLE public.ticket_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth view tact" ON public.ticket_activities FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert tact" ON public.ticket_activities FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update tact" ON public.ticket_activities FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete tact" ON public.ticket_activities FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_tickets_status ON public.tickets(status);
CREATE INDEX idx_tickets_created_at ON public.tickets(created_at DESC);
CREATE INDEX idx_tact_ticket ON public.ticket_activities(ticket_id, created_at DESC);

-- Auto case_id TKT-0001 if blank
CREATE OR REPLACE FUNCTION public.set_ticket_case_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  seq int;
BEGIN
  IF NEW.case_id IS NULL OR NEW.case_id = '' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(case_id, '\D', '', 'g'), '')::int), 0) + 1
      INTO seq FROM public.tickets WHERE case_id LIKE 'TKT-%';
    NEW.case_id := 'TKT-' || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER tickets_case_id BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_ticket_case_id();


-- =====================================================================
-- SOURCE: 20260602094501_50459276-93bf-4bf1-9156-680cfc82df36.sql
-- =====================================================================

CREATE TABLE public.wa_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_templates TO authenticated;
GRANT ALL ON public.wa_templates TO service_role;

ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth view wa_templates" ON public.wa_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth ins wa_templates" ON public.wa_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth upd wa_templates" ON public.wa_templates FOR UPDATE TO authenticated USING (true);

INSERT INTO public.wa_templates (id, name, body) VALUES
('engineer_assign', 'Engineer Assignment', E'*New Service Call Assigned*\nCase ID: {{case_id}}\nType: {{call_type}}\nCustomer: {{customer_name}}\nContact: {{customer_phone}}\nLocation: {{location}}\nAddress: {{customer_address}}\nProduct: {{product}}\nSerial: {{serial_no}}\nComplaint: {{complaint}}\n\n— Prokon Hi-Tech Systems'),
('oow_quotation', 'OOW Quotation Share', E'Dear {{customer_name}},\n\nPlease find our quotation *{{quote_no}}* for service request *{{case_id}}*{{product_line}}.\n\nKindly review and confirm to proceed.\n\n— Prokon Hi-Tech Systems'),
('ticket_closed', 'Ticket Closure', E'Dear {{customer_name}},\n\nYour service request *{{case_id}}*{{product_line}} has been *resolved & closed*.\nThank you for choosing Prokon Hi-Tech Systems. We appreciate your business.\n\nFor any further assistance, feel free to reach out.\n— Prokon Hi-Tech Systems');


-- =====================================================================
-- SOURCE: 20260604061008_dc22e45e-f7a6-4018-8803-88feadbc3d1e.sql
-- =====================================================================

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Storage policies for ticket-attachments bucket
CREATE POLICY "Public can upload ticket attachments"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND (storage.foldername(name))[1] = 'public'
);

CREATE POLICY "Authenticated can read ticket attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'ticket-attachments');

CREATE POLICY "Anon can read own ticket attachments"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'ticket-attachments' AND (storage.foldername(name))[1] = 'public');


-- =====================================================================
-- SOURCE: 20260606034517_f25943e5-9526-4c2d-9611-126fd045cff0.sql
-- =====================================================================

-- Role system
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin', 'user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "view roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "claim first admin" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (
    role = 'admin' AND user_id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
  );

-- Helper: updated_at trigger function reuse (touch_updated_at already exists)

-- Companies
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gstin text,
  address text,
  phone text,
  email text,
  website text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view companies" ON public.companies FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins companies" ON public.companies FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd companies" ON public.companies FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin del companies" ON public.companies FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER companies_touch BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Branches
CREATE TABLE IF NOT EXISTS public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  gstin text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.branches TO authenticated;
GRANT ALL ON public.branches TO service_role;
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view branches" ON public.branches FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins branches" ON public.branches FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd branches" ON public.branches FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin del branches" ON public.branches FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER branches_touch BEFORE UPDATE ON public.branches FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Vendors
CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  gstin text,
  contact_name text,
  phone text,
  email text,
  address text,
  payment_terms text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view vendors" ON public.vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins vendors" ON public.vendors FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd vendors" ON public.vendors FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin del vendors" ON public.vendors FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER vendors_touch BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Employees
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text,
  department text,
  phone text,
  email text,
  joining_date date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view employees" ON public.employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins employees" ON public.employees FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd employees" ON public.employees FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin del employees" ON public.employees FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER employees_touch BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Inventory
CREATE TABLE IF NOT EXISTS public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_name text,
  warehouse text,
  quantity numeric NOT NULL DEFAULT 0,
  serial_no text,
  location text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO authenticated;
GRANT ALL ON public.inventory TO service_role;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view inventory" ON public.inventory FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins inventory" ON public.inventory FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd inventory" ON public.inventory FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin del inventory" ON public.inventory FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER inventory_touch BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Accounts Ledger
CREATE TABLE IF NOT EXISTS public.accounts_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'Asset',
  opening_balance numeric NOT NULL DEFAULT 0,
  gst text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts_ledger TO authenticated;
GRANT ALL ON public.accounts_ledger TO service_role;
ALTER TABLE public.accounts_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view ledger" ON public.accounts_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins ledger" ON public.accounts_ledger FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd ledger" ON public.accounts_ledger FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "admin del ledger" ON public.accounts_ledger FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER ledger_touch BEFORE UPDATE ON public.accounts_ledger FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- =====================================================================
-- SOURCE: 20260609123208_34de8e44-0267-4784-a02f-4718796e95ef.sql
-- =====================================================================
-- Add customer_id FK to amcs
ALTER TABLE public.amcs ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_amcs_customer_id ON public.amcs(customer_id);

-- Add FK constraint to tickets.customer_id (column already exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tickets_customer_id_fkey'
  ) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON public.tickets(customer_id);

-- Backfill tickets.customer_id by matching company/contact name + phone
UPDATE public.tickets t
SET customer_id = c.id
FROM public.customers c
WHERE t.customer_id IS NULL
  AND (
    (t.customer_phone IS NOT NULL AND t.customer_phone <> '' AND regexp_replace(t.customer_phone,'\D','','g') = regexp_replace(c.phone,'\D','','g'))
    OR lower(trim(t.customer_name)) = lower(trim(c.company))
    OR lower(trim(t.customer_name)) = lower(trim(c.contact_name))
  );

-- Backfill amcs.customer_id by matching client_name/client_company + contact_no
UPDATE public.amcs a
SET customer_id = c.id
FROM public.customers c
WHERE a.customer_id IS NULL
  AND (
    (a.contact_no IS NOT NULL AND a.contact_no <> '' AND regexp_replace(a.contact_no,'\D','','g') = regexp_replace(c.phone,'\D','','g'))
    OR lower(trim(a.client_company)) = lower(trim(c.company))
    OR lower(trim(a.client_name)) = lower(trim(c.contact_name))
    OR lower(trim(a.client_name)) = lower(trim(c.company))
  );

-- =====================================================================
-- SOURCE: 20260609125619_81c83f5c-0b00-4e2c-b711-1fdaa0bb7727.sql
-- =====================================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS hsn text,
  ADD COLUMN IF NOT EXISTS default_price numeric,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS products_touch_updated_at ON public.products;
CREATE TRIGGER products_touch_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- =====================================================================
-- SOURCE: 20260610063255_41e3f674-c58b-4542-bbb3-e2850383d91e.sql
-- =====================================================================

-- Extend products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS tax_rate numeric,
  ADD COLUMN IF NOT EXISTS serial_tracking boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS serial_mode text NOT NULL DEFAULT 'Manual',
  ADD COLUMN IF NOT EXISTS warranty_applicable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS warranty_type text,
  ADD COLUMN IF NOT EXISTS warranty_duration integer,
  ADD COLUMN IF NOT EXISTS warranty_unit text DEFAULT 'Months',
  ADD COLUMN IF NOT EXISTS warranty_start_from text DEFAULT 'Invoice Date',
  ADD COLUMN IF NOT EXISTS warranty_manual_override boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_unique ON public.products (lower(sku)) WHERE sku IS NOT NULL AND sku <> '';

-- Serials
CREATE TABLE IF NOT EXISTS public.serials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  serial_number text NOT NULL,
  purchase_invoice_no text,
  purchase_date date,
  supplier_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  sale_invoice_no text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  installation_date date,
  warranty_start_date date,
  warranty_end_date date,
  status text NOT NULL DEFAULT 'In Stock',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS serials_serial_number_unique ON public.serials (lower(serial_number));
CREATE INDEX IF NOT EXISTS serials_product_idx ON public.serials (product_id);
CREATE INDEX IF NOT EXISTS serials_status_idx ON public.serials (status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.serials TO authenticated;
GRANT ALL ON public.serials TO service_role;

ALTER TABLE public.serials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view serials" ON public.serials FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert serials" ON public.serials FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update serials" ON public.serials FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins can delete serials" ON public.serials FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_serials_touch BEFORE UPDATE ON public.serials FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- =====================================================================
-- SOURCE: 20260611093222_ce9e8e0c-8022-4eac-9e26-5231fe13a87d.sql
-- =====================================================================

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


-- =====================================================================
-- SOURCE: 20260612150250_168b4294-fdf4-4254-ba61-2bf9e41fb7c7.sql
-- =====================================================================

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


-- =====================================================================
-- SOURCE: 20260612153528_290d3f49-a99b-41fb-98e7-b5100b1104a9.sql
-- =====================================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'Business',
  ADD COLUMN IF NOT EXISTS salutation TEXT,
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS pan TEXT,
  ADD COLUMN IF NOT EXISTS phone_area_code TEXT DEFAULT '+91',
  ADD COLUMN IF NOT EXISTS billing_line1 TEXT,
  ADD COLUMN IF NOT EXISTS billing_line2 TEXT,
  ADD COLUMN IF NOT EXISTS billing_landmark TEXT,
  ADD COLUMN IF NOT EXISTS billing_city TEXT,
  ADD COLUMN IF NOT EXISTS billing_state TEXT,
  ADD COLUMN IF NOT EXISTS billing_country TEXT DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS billing_pincode TEXT,
  ADD COLUMN IF NOT EXISTS shipping_line1 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_line2 TEXT,
  ADD COLUMN IF NOT EXISTS shipping_landmark TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city TEXT,
  ADD COLUMN IF NOT EXISTS shipping_state TEXT,
  ADD COLUMN IF NOT EXISTS shipping_country TEXT DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS shipping_pincode TEXT;


-- =====================================================================
-- SOURCE: 20260612155135_ab10a2df-477c-4920-81b0-e57b9fc1975e.sql
-- =====================================================================
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS place_of_supply text;

-- =====================================================================
-- SOURCE: 20260613095518_84c6f626-cf9d-44cb-9b3e-969230467425.sql
-- =====================================================================

-- A. Ticket settings (singleton)
CREATE TABLE IF NOT EXISTS public.ticket_settings (
  id int PRIMARY KEY DEFAULT 1,
  prefix text NOT NULL DEFAULT 'TKT',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_settings_singleton CHECK (id = 1)
);
INSERT INTO public.ticket_settings (id, prefix) VALUES (1, 'TKT') ON CONFLICT (id) DO NOTHING;
GRANT SELECT ON public.ticket_settings TO authenticated;
GRANT ALL ON public.ticket_settings TO service_role;
ALTER TABLE public.ticket_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticket_settings read" ON public.ticket_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "ticket_settings admin write" ON public.ticket_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- B. Ticket sequence (singleton, never resets)
CREATE TABLE IF NOT EXISTS public.ticket_sequence (
  id int PRIMARY KEY DEFAULT 1,
  last_seq bigint NOT NULL DEFAULT 0,
  CONSTRAINT ticket_sequence_singleton CHECK (id = 1)
);
INSERT INTO public.ticket_sequence (id, last_seq) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;
GRANT SELECT ON public.ticket_sequence TO authenticated;
GRANT ALL ON public.ticket_sequence TO service_role;
ALTER TABLE public.ticket_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ticket_sequence read" ON public.ticket_sequence FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.next_ticket_seq()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n bigint;
BEGIN
  UPDATE public.ticket_sequence SET last_seq = last_seq + 1 WHERE id = 1 RETURNING last_seq INTO n;
  RETURN n;
END $$;

-- C. Call type master
CREATE TABLE IF NOT EXISTS public.call_type_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.call_type_master TO authenticated;
GRANT ALL ON public.call_type_master TO service_role;
ALTER TABLE public.call_type_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_type_master read" ON public.call_type_master FOR SELECT TO authenticated USING (true);
CREATE POLICY "call_type_master insert" ON public.call_type_master FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "call_type_master admin update" ON public.call_type_master FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "call_type_master admin delete" ON public.call_type_master FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.call_type_master (name) VALUES
  ('OOW'), ('Installation'), ('Warranty'), ('AMC'),
  ('PM Call'), ('New Sale Delivery'), ('CCTV')
ON CONFLICT (name) DO NOTHING;

-- D. New columns on tickets
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS sector text,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'P3',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS raised_by_type text,
  ADD COLUMN IF NOT EXISTS raised_by_name text;

-- E. New column on customers
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS sector text;

-- F. Replace case_id trigger function
CREATE OR REPLACE FUNCTION public.set_ticket_case_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  p text;
  ts text;
  seq bigint;
BEGIN
  IF NEW.case_id IS NULL OR NEW.case_id = '' THEN
    SELECT prefix INTO p FROM public.ticket_settings WHERE id = 1;
    IF p IS NULL THEN p := 'TKT'; END IF;
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDDHH24MISS');
    seq := public.next_ticket_seq();
    NEW.case_id := p || ts || lpad(seq::text, 3, '0');
  END IF;
  RETURN NEW;
END $$;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS trg_set_ticket_case_id ON public.tickets;
CREATE TRIGGER trg_set_ticket_case_id
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_ticket_case_id();


-- =====================================================================
-- SOURCE: 20260613103423_a5933b91-9a48-415f-81c7-190dde5b7a8d.sql
-- =====================================================================

-- 1. app_roles
CREATE TABLE public.app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_roles TO authenticated;
GRANT ALL ON public.app_roles TO service_role;
ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view roles" ON public.app_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage roles" ON public.app_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. role_module_permissions
CREATE TABLE public.role_module_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.app_roles(id) ON DELETE CASCADE,
  module text NOT NULL,
  enable_access boolean NOT NULL DEFAULT false,
  can_read boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, module)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_module_permissions TO authenticated;
GRANT ALL ON public.role_module_permissions TO service_role;
ALTER TABLE public.role_module_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view perms" ON public.role_module_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage perms" ON public.role_module_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. app_users
CREATE TABLE public.app_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  email text,
  phone text,
  role_id uuid REFERENCES public.app_roles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  custom_permissions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO authenticated;
GRANT ALL ON public.app_users TO service_role;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view app_users" ON public.app_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage app_users" ON public.app_users FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. touch trigger
CREATE TRIGGER trg_app_roles_touch BEFORE UPDATE ON public.app_roles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_role_module_permissions_touch BEFORE UPDATE ON public.role_module_permissions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_app_users_touch BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. seed roles
INSERT INTO public.app_roles (name, description, is_system) VALUES
  ('Admin', 'Full access to all modules', true),
  ('User', 'Restricted access based on assigned permissions', true)
ON CONFLICT (name) DO NOTHING;

-- 6. seed permissions for all known modules
DO $$
DECLARE
  admin_id uuid;
  user_id uuid;
  m text;
  modules text[] := ARRAY['customers','products','tickets','amc','gatepass','reports','quotations'];
BEGIN
  SELECT id INTO admin_id FROM public.app_roles WHERE name='Admin';
  SELECT id INTO user_id  FROM public.app_roles WHERE name='User';
  FOREACH m IN ARRAY modules LOOP
    INSERT INTO public.role_module_permissions (role_id, module, enable_access, can_read, can_create, can_edit, can_delete)
    VALUES (admin_id, m, true, true, true, true, true)
    ON CONFLICT (role_id, module) DO NOTHING;
    INSERT INTO public.role_module_permissions (role_id, module, enable_access, can_read, can_create, can_edit, can_delete)
    VALUES (user_id, m,
            m <> 'reports',
            m <> 'reports',
            false, false, false)
    ON CONFLICT (role_id, module) DO NOTHING;
  END LOOP;
END $$;

-- 7. has_permission()
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid uuid;
  cperm jsonb;
  modperm jsonb;
  col text;
BEGIN
  IF public.has_role(_user_id, 'admin') THEN
    RETURN true;
  END IF;

  SELECT role_id, custom_permissions INTO rid, cperm
  FROM public.app_users WHERE user_id = _user_id;

  -- normalize action -> column name
  col := CASE _action
    WHEN 'access' THEN 'enable_access'
    WHEN 'read'   THEN 'can_read'
    WHEN 'view'   THEN 'can_read'
    WHEN 'create' THEN 'can_create'
    WHEN 'edit'   THEN 'can_edit'
    WHEN 'update' THEN 'can_edit'
    WHEN 'delete' THEN 'can_delete'
    ELSE NULL END;
  IF col IS NULL THEN RETURN false; END IF;

  IF cperm IS NOT NULL AND cperm ? _module THEN
    modperm := cperm -> _module;
    RETURN COALESCE((modperm ->> col)::boolean, false)
       AND COALESCE((modperm ->> 'enable_access')::boolean, false);
  END IF;

  IF rid IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.role_module_permissions
    WHERE role_id = rid
      AND module = _module
      AND enable_access = true
      AND CASE col
        WHEN 'enable_access' THEN enable_access
        WHEN 'can_read'   THEN can_read
        WHEN 'can_create' THEN can_create
        WHEN 'can_edit'   THEN can_edit
        WHEN 'can_delete' THEN can_delete
      END = true
  );
END $$;


-- =====================================================================
-- SOURCE: 20260613105818_a585ffdd-9c26-4760-a536-e89163d56bc9.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_ticket_case_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  p text;
  ts text;
  seq bigint;
BEGIN
  IF NEW.case_id IS NULL OR NEW.case_id = '' THEN
    SELECT prefix INTO p FROM public.ticket_settings WHERE id = 1;
    IF p IS NULL THEN p := 'TKT'; END IF;
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DDMMYYHH24MI');
    seq := public.next_ticket_seq();
    NEW.case_id := p || ts || lpad(seq::text, 3, '0');
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.log_ticket_created()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.ticket_activities (ticket_id, kind, notes, to_status, actor, created_at)
  VALUES (NEW.id, 'created', 'Ticket created', NEW.status, NEW.created_by, NEW.created_at);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ticket_created_log ON public.tickets;
CREATE TRIGGER trg_ticket_created_log
AFTER INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.log_ticket_created();


-- =====================================================================
-- SOURCE: 20260613113850_cfec5a4f-f11f-45be-857f-02de3f6ccfb3.sql
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS oem_call boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oem_brand text,
  ADD COLUMN IF NOT EXISTS oem_ref_id text,
  ADD COLUMN IF NOT EXISTS oem_purchase_date date;

CREATE TABLE IF NOT EXISTS public.oem_brand_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oem_brand_master TO authenticated;
GRANT ALL ON public.oem_brand_master TO service_role;

ALTER TABLE public.oem_brand_master ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "auth view oem brands" ON public.oem_brand_master FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "auth insert oem brands" ON public.oem_brand_master FOR INSERT TO authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "auth update oem brands" ON public.oem_brand_master FOR UPDATE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "auth delete oem brands" ON public.oem_brand_master FOR DELETE TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO public.oem_brand_master (name) VALUES
  ('APC'), ('Luminous'), ('Microtek'), ('Eaton'), ('Exide'), ('Quanta')
ON CONFLICT (name) DO NOTHING;


-- =====================================================================
-- SOURCE: 20260613120545_4c671a7b-0bb6-44ec-a55f-6f85b64a3529.sql
-- =====================================================================

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS amc_id uuid REFERENCES public.amcs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pm_visit_id uuid REFERENCES public.pm_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_amc_id ON public.tickets(amc_id);
CREATE INDEX IF NOT EXISTS idx_tickets_pm_visit_id ON public.tickets(pm_visit_id);


-- =====================================================================
-- SOURCE: 20260613124430_61a30da8-aedb-4fb2-a863-37036fab1ba8.sql
-- =====================================================================

-- 1. AMC prefix setting
ALTER TABLE public.amc_settings ADD COLUMN IF NOT EXISTS prefix text NOT NULL DEFAULT 'PHS/AMC/';
INSERT INTO public.amc_settings (id, terms_template, prefix) VALUES (1, '', 'PHS/AMC/') ON CONFLICT (id) DO NOTHING;

-- 2. AMC sequence + auto agreement number
CREATE TABLE IF NOT EXISTS public.amc_sequence (
  id int PRIMARY KEY DEFAULT 1,
  last_seq bigint NOT NULL DEFAULT 0,
  CHECK (id = 1)
);
GRANT SELECT ON public.amc_sequence TO authenticated;
GRANT ALL ON public.amc_sequence TO service_role;
ALTER TABLE public.amc_sequence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "amc_sequence read" ON public.amc_sequence;
CREATE POLICY "amc_sequence read" ON public.amc_sequence FOR SELECT TO authenticated USING (true);
INSERT INTO public.amc_sequence (id, last_seq) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_amc_seq()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  UPDATE public.amc_sequence SET last_seq = last_seq + 1 WHERE id = 1 RETURNING last_seq INTO n;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.set_amc_agreement_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  p text;
  ts text;
  seq bigint;
BEGIN
  IF NEW.agreement_no IS NULL OR NEW.agreement_no = '' THEN
    SELECT prefix INTO p FROM public.amc_settings WHERE id = 1;
    IF p IS NULL OR p = '' THEN p := 'PHS/AMC/'; END IF;
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DDMMYYHH24MI');
    seq := public.next_amc_seq();
    NEW.agreement_no := p || ts || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_amcs_set_agreement_no ON public.amcs;
CREATE TRIGGER trg_amcs_set_agreement_no BEFORE INSERT ON public.amcs
  FOR EACH ROW EXECUTE FUNCTION public.set_amc_agreement_no();

-- Seed sequence from highest existing numeric tail to avoid collisions
DO $$
DECLARE mx bigint;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(agreement_no, '.*?(\d+)$', '\1'), '')::bigint), 0) INTO mx FROM public.amcs;
  UPDATE public.amc_sequence SET last_seq = GREATEST(last_seq, mx) WHERE id = 1;
END $$;

-- 3. OEM columns on amcs + pm_visits
ALTER TABLE public.amcs
  ADD COLUMN IF NOT EXISTS oem_call boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oem_brand text,
  ADD COLUMN IF NOT EXISTS oem_ref_id text,
  ADD COLUMN IF NOT EXISTS oem_purchase_date date;

ALTER TABLE public.pm_visits
  ADD COLUMN IF NOT EXISTS oem_call boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oem_brand text,
  ADD COLUMN IF NOT EXISTS oem_ref_id text,
  ADD COLUMN IF NOT EXISTS oem_purchase_date date;

-- 4. Indexes for OEM tab perf
CREATE INDEX IF NOT EXISTS idx_tickets_oem_call ON public.tickets (oem_call) WHERE oem_call;
CREATE INDEX IF NOT EXISTS idx_amcs_oem_call ON public.amcs (oem_call) WHERE oem_call;
CREATE INDEX IF NOT EXISTS idx_pm_visits_oem_call ON public.pm_visits (oem_call) WHERE oem_call;


-- =====================================================================
-- SOURCE: 20260613131950_b75f3e47-afec-482b-8753-d45e618293a3.sql
-- =====================================================================

ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS special_instruction text;
ALTER TABLE public.ticket_activities ADD COLUMN IF NOT EXISTS special_instruction boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_tact_special ON public.ticket_activities (ticket_id) WHERE special_instruction;


-- =====================================================================
-- SOURCE: 20260613133410_6de3f29e-a18b-4074-b5c5-4c62bf677edc.sql
-- =====================================================================
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS special_instruction_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;

-- =====================================================================
-- SOURCE: 20260613134322_5e29a92f-ac17-4831-80f3-d3ad3e6eefd4.sql
-- =====================================================================
ALTER TABLE public.tickets ADD COLUMN preferred_visit_datetime timestamptz NULL;

-- =====================================================================
-- SOURCE: 20260613153340_d65b165e-90c5-40f6-8e0a-df444abb2450.sql
-- =====================================================================

DROP POLICY IF EXISTS "view app_users" ON public.app_users;
CREATE POLICY "users view own app_user row" ON public.app_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth ins rules" ON public.incentive_rules;
DROP POLICY IF EXISTS "auth upd rules" ON public.incentive_rules;
DROP POLICY IF EXISTS "auth del rules" ON public.incentive_rules;
CREATE POLICY "admin ins rules" ON public.incentive_rules
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin upd rules" ON public.incentive_rules
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin del rules" ON public.incentive_rules
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated insert settings" ON public.amc_settings;
DROP POLICY IF EXISTS "Authenticated update settings" ON public.amc_settings;
CREATE POLICY "Admin insert amc_settings" ON public.amc_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin update amc_settings" ON public.amc_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth ins crms" ON public.crm_settings;
DROP POLICY IF EXISTS "auth upd crms" ON public.crm_settings;
CREATE POLICY "admin ins crm_settings" ON public.crm_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin upd crm_settings" ON public.crm_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can insert gatepasses" ON public.gatepasses;
DROP POLICY IF EXISTS "Authenticated can update gatepasses" ON public.gatepasses;
CREATE POLICY "Authenticated insert own gatepass" ON public.gatepasses
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owner or admin update gatepass" ON public.gatepasses
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin delete gatepass" ON public.gatepasses
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated delete pm_visits" ON public.pm_visits;
CREATE POLICY "Admin delete pm_visits" ON public.pm_visits
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth update tact" ON public.ticket_activities;
DROP POLICY IF EXISTS "auth delete tact" ON public.ticket_activities;
CREATE POLICY "Actor or admin update tact" ON public.ticket_activities
  FOR UPDATE TO authenticated
  USING (actor = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (actor = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Actor or admin delete tact" ON public.ticket_activities
  FOR DELETE TO authenticated
  USING (actor = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth delete tickets" ON public.tickets;
CREATE POLICY "Creator or admin delete tickets" ON public.tickets
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anon can read own ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Public can upload ticket attachments" ON storage.objects;
CREATE POLICY "Authenticated upload ticket attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ticket-attachments');

ALTER FUNCTION public.set_challan_no() SET search_path = public;
ALTER FUNCTION public.touch_updated_at() SET search_path = public;


-- =====================================================================
-- SOURCE: 20260616054630_b8cd9c13-e842-4206-90f1-ecdd8cc44dfc.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sync_pm_visits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  d text;
  desired date[];
BEGIN
  IF NEW.pm_dates IS NOT NULL THEN
    FOR d IN SELECT jsonb_array_elements_text(NEW.pm_dates)
    LOOP
      INSERT INTO public.pm_visits (amc_id, scheduled_date)
      VALUES (NEW.id, d::date)
      ON CONFLICT (amc_id, scheduled_date) DO NOTHING;
    END LOOP;

    SELECT COALESCE(array_agg((x)::date), ARRAY[]::date[])
      INTO desired
      FROM jsonb_array_elements_text(NEW.pm_dates) AS x;
  ELSE
    desired := ARRAY[]::date[];
  END IF;

  -- Remove pending PM visits whose date was removed from AMC. Keep completed.
  DELETE FROM public.pm_visits
   WHERE amc_id = NEW.id
     AND completed_at IS NULL
     AND NOT (scheduled_date = ANY(desired));

  RETURN NEW;
END;
$function$;

-- Backfill missing pm_visits for existing AMCs
INSERT INTO public.pm_visits (amc_id, scheduled_date)
SELECT a.id, (d)::date
FROM public.amcs a,
     LATERAL jsonb_array_elements_text(COALESCE(a.pm_dates, '[]'::jsonb)) AS d
ON CONFLICT (amc_id, scheduled_date) DO NOTHING;


-- =====================================================================
-- SOURCE: 20260616063210_731b918b-d7cd-46a6-95da-131fc93a0166.sql
-- =====================================================================

ALTER TABLE public.amcs ADD COLUMN IF NOT EXISTS agreement_doc_path text;

CREATE POLICY "Authenticated can read amc agreements"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'amc-agreements');

CREATE POLICY "Authenticated can upload amc agreements"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'amc-agreements');

CREATE POLICY "Authenticated can update amc agreements"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'amc-agreements');

CREATE POLICY "Authenticated can delete amc agreements"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'amc-agreements');


-- =====================================================================
-- SOURCE: 20260616102845_16e1efe5-5c09-42eb-8d46-8e8731fb18d3.sql
-- =====================================================================

-- INDENT module
CREATE TYPE public.indent_type AS ENUM ('rma_advance_exchange', 'rma_exchange', 'rma_service_ship');

CREATE TABLE public.indent_sequence (
  id INT PRIMARY KEY DEFAULT 1,
  last_seq BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT indent_sequence_single CHECK (id = 1)
);
INSERT INTO public.indent_sequence (id, last_seq) VALUES (1, 0) ON CONFLICT DO NOTHING;

GRANT SELECT ON public.indent_sequence TO authenticated;
GRANT ALL ON public.indent_sequence TO service_role;

CREATE OR REPLACE FUNCTION public.next_indent_seq()
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n BIGINT;
BEGIN
  UPDATE public.indent_sequence SET last_seq = last_seq + 1 WHERE id = 1 RETURNING last_seq INTO n;
  RETURN n;
END $$;

CREATE TABLE public.indents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_no TEXT UNIQUE,
  indent_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ticket_id UUID NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  indent_city TEXT,
  case_id TEXT,
  oem_case_id TEXT,
  company TEXT,
  def_model_no TEXT,
  def_serial_no TEXT,
  problem_reported TEXT,
  indent_type public.indent_type,
  oracles TEXT,
  material_exchange_model TEXT,
  material_exchange_serial_no TEXT,
  material_rec_model_no TEXT,
  material_rec_serial_no TEXT,
  material_rec_date DATE,
  engineer_name TEXT,
  remarks TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_indents_ticket_id ON public.indents(ticket_id);
CREATE INDEX idx_indents_created_at ON public.indents(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.indents TO authenticated;
GRANT ALL ON public.indents TO service_role;

ALTER TABLE public.indents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth view indents" ON public.indents FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert indents" ON public.indents FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update indents" ON public.indents FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Creator or admin delete indents" ON public.indents FOR DELETE TO authenticated
  USING ((created_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

-- Auto-number trigger: PHS/IND/DDMMYYHHMI<seq>
CREATE OR REPLACE FUNCTION public.set_indent_no()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  ts TEXT;
  seq BIGINT;
BEGIN
  IF NEW.indent_no IS NULL OR NEW.indent_no = '' THEN
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DDMMYYHH24MI');
    seq := public.next_indent_seq();
    NEW.indent_no := 'PHS/IND/' || ts || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_set_indent_no BEFORE INSERT ON public.indents
  FOR EACH ROW EXECUTE FUNCTION public.set_indent_no();

CREATE TRIGGER trg_indents_touch BEFORE UPDATE ON public.indents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Enforce: only OEM-tagged tickets can have indents
CREATE OR REPLACE FUNCTION public.validate_indent_oem_ticket()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  is_oem BOOLEAN;
BEGIN
  SELECT oem_call INTO is_oem FROM public.tickets WHERE id = NEW.ticket_id;
  IF NOT COALESCE(is_oem, false) THEN
    RAISE EXCEPTION 'INDENT can only be created for OEM-tagged tickets';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_validate_indent_oem BEFORE INSERT OR UPDATE OF ticket_id ON public.indents
  FOR EACH ROW EXECUTE FUNCTION public.validate_indent_oem_ticket();


-- =====================================================================
-- SOURCE: 20260616140727_2196f1b7-f6a8-43e0-b082-06ef27d0bba1.sql
-- =====================================================================

-- 1) Dynamic modules registry
CREATE TABLE public.app_modules (
  key text PRIMARY KEY,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 100,
  supports_import boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_modules TO authenticated;
GRANT ALL ON public.app_modules TO service_role;
ALTER TABLE public.app_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read modules" ON public.app_modules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage modules" ON public.app_modules
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_app_modules_touch BEFORE UPDATE ON public.app_modules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.app_modules (key, label, sort_order, supports_import) VALUES
  ('customers',  'Customers',  10, true),
  ('products',   'Products',   20, true),
  ('tickets',    'Tickets',    30, true),
  ('indent',     'Indent',     40, false),
  ('amc',        'AMC',        50, true),
  ('gatepass',   'Gatepass',   60, false),
  ('quotations', 'Quotations', 70, false),
  ('reports',    'Reports',    80, false)
ON CONFLICT (key) DO NOTHING;

-- 2) Export / Import permission columns
ALTER TABLE public.role_module_permissions
  ADD COLUMN IF NOT EXISTS can_export boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_import boolean NOT NULL DEFAULT false;

-- Update has_permission to support export/import actions
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rid uuid;
  cperm jsonb;
  modperm jsonb;
  col text;
BEGIN
  IF public.has_role(_user_id, 'admin') THEN
    RETURN true;
  END IF;

  SELECT role_id, custom_permissions INTO rid, cperm
  FROM public.app_users WHERE user_id = _user_id;

  col := CASE _action
    WHEN 'access' THEN 'enable_access'
    WHEN 'read'   THEN 'can_read'
    WHEN 'view'   THEN 'can_read'
    WHEN 'create' THEN 'can_create'
    WHEN 'edit'   THEN 'can_edit'
    WHEN 'update' THEN 'can_edit'
    WHEN 'delete' THEN 'can_delete'
    WHEN 'export' THEN 'can_export'
    WHEN 'import' THEN 'can_import'
    ELSE NULL END;
  IF col IS NULL THEN RETURN false; END IF;

  IF cperm IS NOT NULL AND cperm ? _module THEN
    modperm := cperm -> _module;
    RETURN COALESCE((modperm ->> col)::boolean, false)
       AND COALESCE((modperm ->> 'enable_access')::boolean, false);
  END IF;

  IF rid IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.role_module_permissions
    WHERE role_id = rid
      AND module = _module
      AND enable_access = true
      AND CASE col
        WHEN 'enable_access' THEN enable_access
        WHEN 'can_read'   THEN can_read
        WHEN 'can_create' THEN can_create
        WHEN 'can_edit'   THEN can_edit
        WHEN 'can_delete' THEN can_delete
        WHEN 'can_export' THEN can_export
        WHEN 'can_import' THEN can_import
      END = true
  );
END $function$;

-- 3) Password expiry tracking on app_users
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- 4) Password history (for "no reuse of last 5")
CREATE TABLE public.password_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_history_user_idx ON public.password_history (user_id, created_at DESC);
GRANT SELECT ON public.password_history TO authenticated;
GRANT ALL ON public.password_history TO service_role;
ALTER TABLE public.password_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own history" ON public.password_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());


-- =====================================================================
-- SOURCE: 20260617074628_19e48ef9-6bef-4bc1-97ff-c391898d5775.sql
-- =====================================================================
ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS product_model text,
  ADD COLUMN IF NOT EXISTS product_serial text;

-- =====================================================================
-- SOURCE: 20260617083320_97b28e51-6a26-46ba-9af1-78a4b20a2ce4.sql
-- =====================================================================
CREATE TABLE public.whatsapp_launch_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  record_id uuid,
  record_number text,
  recipient_label text,
  recipient_mobile text NOT NULL,
  whatsapp_url text NOT NULL,
  launch_success boolean NOT NULL DEFAULT false,
  failure_reason text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.whatsapp_launch_logs TO authenticated;
GRANT ALL ON public.whatsapp_launch_logs TO service_role;

ALTER TABLE public.whatsapp_launch_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can insert whatsapp launch logs"
ON public.whatsapp_launch_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can view whatsapp launch logs"
ON public.whatsapp_launch_logs
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX idx_whatsapp_launch_logs_record ON public.whatsapp_launch_logs(module, record_id, created_at DESC);
CREATE INDEX idx_whatsapp_launch_logs_created_at ON public.whatsapp_launch_logs(created_at DESC);

-- =====================================================================
-- SOURCE: 20260617111311_53e5159c-d91d-4172-b597-47a1f9a6843a.sql
-- =====================================================================

-- ============= ENUMS =============
DO $$ BEGIN
  CREATE TYPE public.ims_stock_type AS ENUM ('good','defective');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ims_stock_status AS ENUM ('available','reserved','issued','in_transit','returned_to_oem','scrapped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ims_txn_type AS ENUM (
    'good_in','good_out','defective_in','defective_out',
    'transfer_out','transfer_in','oem_return','oem_replacement_receipt',
    'stock_adjustment','scrap_adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ims_transfer_status AS ENUM ('draft','submitted','approved','rejected','in_transit','received','completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ims_reservation_status AS ENUM ('reserved','issued','released');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============= SEQUENCES =============
CREATE TABLE IF NOT EXISTS public.ims_txn_sequence (id INT PRIMARY KEY, last_seq BIGINT NOT NULL DEFAULT 0);
INSERT INTO public.ims_txn_sequence(id,last_seq) VALUES (1,0) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ims_transfer_sequence (id INT PRIMARY KEY, last_seq BIGINT NOT NULL DEFAULT 0);
INSERT INTO public.ims_transfer_sequence(id,last_seq) VALUES (1,0) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_ims_txn_seq() RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n BIGINT;
BEGIN
  UPDATE public.ims_txn_sequence SET last_seq = last_seq + 1 WHERE id=1 RETURNING last_seq INTO n;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.next_ims_transfer_seq() RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n BIGINT;
BEGIN
  UPDATE public.ims_transfer_sequence SET last_seq = last_seq + 1 WHERE id=1 RETURNING last_seq INTO n;
  RETURN n;
END $$;

-- ============= STOCK ITEMS =============
CREATE TABLE public.ims_stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  oem TEXT,
  category TEXT,
  part_name TEXT NOT NULL,
  part_model_no TEXT,
  part_serial_no TEXT UNIQUE,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  warehouse_type TEXT,
  stock_type public.ims_stock_type NOT NULL DEFAULT 'good',
  stock_status public.ims_stock_status NOT NULL DEFAULT 'available',
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  indent_id UUID REFERENCES public.indents(id) ON DELETE SET NULL,
  oem_case_id TEXT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  transaction_ref TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  modified_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_stock_warehouse ON public.ims_stock_items(warehouse_id);
CREATE INDEX idx_ims_stock_oem ON public.ims_stock_items(oem);
CREATE INDEX idx_ims_stock_status ON public.ims_stock_items(stock_status);
CREATE INDEX idx_ims_stock_type ON public.ims_stock_items(stock_type);
CREATE INDEX idx_ims_stock_ticket ON public.ims_stock_items(ticket_id);
CREATE INDEX idx_ims_stock_indent ON public.ims_stock_items(indent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ims_stock_items TO authenticated;
GRANT ALL ON public.ims_stock_items TO service_role;
ALTER TABLE public.ims_stock_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ims_stock_read" ON public.ims_stock_items FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_stock_insert" ON public.ims_stock_items FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'ims','create') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_stock_update" ON public.ims_stock_items FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_stock_delete" ON public.ims_stock_items FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Auto-populate warehouse_type from warehouses
CREATE OR REPLACE FUNCTION public.ims_set_warehouse_type() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.warehouse_id IS NOT NULL THEN
    SELECT type INTO NEW.warehouse_type FROM public.warehouses WHERE id = NEW.warehouse_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_stock_warehouse_type
  BEFORE INSERT OR UPDATE OF warehouse_id ON public.ims_stock_items
  FOR EACH ROW EXECUTE FUNCTION public.ims_set_warehouse_type();

CREATE TRIGGER trg_ims_stock_updated_at BEFORE UPDATE ON public.ims_stock_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============= TRANSACTIONS =============
CREATE TABLE public.ims_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_no TEXT UNIQUE,
  txn_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  txn_type public.ims_txn_type NOT NULL,
  stock_item_id UUID REFERENCES public.ims_stock_items(id) ON DELETE SET NULL,
  part_name TEXT,
  part_model_no TEXT,
  part_serial_no TEXT,
  oem TEXT,
  from_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  to_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  from_party TEXT,
  to_party TEXT,
  qty INTEGER NOT NULL DEFAULT 1,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  indent_id UUID REFERENCES public.indents(id) ON DELETE SET NULL,
  transfer_id UUID,
  reference TEXT,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_txn_type ON public.ims_transactions(txn_type);
CREATE INDEX idx_ims_txn_date ON public.ims_transactions(txn_date);
CREATE INDEX idx_ims_txn_stock ON public.ims_transactions(stock_item_id);
CREATE INDEX idx_ims_txn_ticket ON public.ims_transactions(ticket_id);
CREATE INDEX idx_ims_txn_indent ON public.ims_transactions(indent_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ims_transactions TO authenticated;
GRANT ALL ON public.ims_transactions TO service_role;
ALTER TABLE public.ims_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ims_txn_read" ON public.ims_transactions FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_txn_insert" ON public.ims_transactions FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'ims','create') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_txn_update" ON public.ims_transactions FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_txn_delete" ON public.ims_transactions FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.set_ims_txn_no() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE ts TEXT; seq BIGINT;
BEGIN
  IF NEW.txn_no IS NULL OR NEW.txn_no = '' THEN
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata','DDMMYYHH24MI');
    seq := public.next_ims_txn_seq();
    NEW.txn_no := 'PHS/IMS/' || ts || lpad(seq::text,4,'0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_set_txn_no BEFORE INSERT ON public.ims_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_ims_txn_no();

-- ============= TRANSFERS =============
CREATE TABLE public.ims_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no TEXT UNIQUE,
  request_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  destination_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  oem TEXT,
  part_name TEXT,
  part_model_no TEXT,
  part_serial_no TEXT,
  stock_item_id UUID REFERENCES public.ims_stock_items(id) ON DELETE SET NULL,
  stock_type public.ims_stock_type NOT NULL DEFAULT 'good',
  qty INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  remarks TEXT,
  status public.ims_transfer_status NOT NULL DEFAULT 'draft',
  requested_by UUID REFERENCES auth.users(id),
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  received_by UUID REFERENCES auth.users(id),
  received_at TIMESTAMPTZ,
  receipt_remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_transfers_status ON public.ims_transfers(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ims_transfers TO authenticated;
GRANT ALL ON public.ims_transfers TO service_role;
ALTER TABLE public.ims_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ims_xfer_read" ON public.ims_transfers FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_xfer_insert" ON public.ims_transfers FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'ims','create') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_xfer_update" ON public.ims_transfers FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_xfer_delete" ON public.ims_transfers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.set_ims_transfer_no() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE ts TEXT; seq BIGINT;
BEGIN
  IF NEW.transfer_no IS NULL OR NEW.transfer_no = '' THEN
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata','DDMMYYHH24MI');
    seq := public.next_ims_transfer_seq();
    NEW.transfer_no := 'PHS/IMT/' || ts || lpad(seq::text,4,'0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_set_transfer_no BEFORE INSERT ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.set_ims_transfer_no();

CREATE TRIGGER trg_ims_transfers_updated_at BEFORE UPDATE ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-react to status changes: in_transit / completed update linked stock_item
CREATE OR REPLACE FUNCTION public.ims_transfer_status_effects() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.stock_item_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'in_transit' THEN
      UPDATE public.ims_stock_items SET stock_status='in_transit', updated_at=now() WHERE id=NEW.stock_item_id;
    ELSIF NEW.status = 'completed' THEN
      UPDATE public.ims_stock_items
        SET warehouse_id = NEW.destination_warehouse_id,
            stock_status = 'available',
            updated_at = now()
        WHERE id = NEW.stock_item_id;
      -- Log paired transactions
      INSERT INTO public.ims_transactions(txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by)
      VALUES
        ('transfer_out', NEW.stock_item_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
          NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no, 'Transfer out', NEW.requested_by),
        ('transfer_in',  NEW.stock_item_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
          NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no, 'Transfer in', NEW.received_by);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_transfer_status_effects
  AFTER UPDATE OF status ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.ims_transfer_status_effects();

-- ============= RESERVATIONS =============
CREATE TABLE public.ims_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES public.ims_stock_items(id) ON DELETE CASCADE,
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  indent_id UUID REFERENCES public.indents(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  status public.ims_reservation_status NOT NULL DEFAULT 'reserved',
  reserved_by UUID REFERENCES auth.users(id),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_resv_stock ON public.ims_reservations(stock_item_id);
CREATE INDEX idx_ims_resv_status ON public.ims_reservations(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ims_reservations TO authenticated;
GRANT ALL ON public.ims_reservations TO service_role;
ALTER TABLE public.ims_reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ims_resv_read" ON public.ims_reservations FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_resv_insert" ON public.ims_reservations FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(),'ims','create') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_resv_update" ON public.ims_reservations FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_permission(auth.uid(),'ims','edit') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_resv_delete" ON public.ims_reservations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_ims_resv_updated_at BEFORE UPDATE ON public.ims_reservations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Keep stock status synced with reservation status
CREATE OR REPLACE FUNCTION public.ims_resv_sync_stock() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.ims_stock_items SET stock_status='reserved', updated_at=now()
      WHERE id = NEW.stock_item_id AND stock_status='available';
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'issued' THEN
      UPDATE public.ims_stock_items SET stock_status='issued', updated_at=now() WHERE id=NEW.stock_item_id;
    ELSIF NEW.status = 'released' THEN
      UPDATE public.ims_stock_items SET stock_status='available', updated_at=now() WHERE id=NEW.stock_item_id;
    ELSIF NEW.status = 'reserved' THEN
      UPDATE public.ims_stock_items SET stock_status='reserved', updated_at=now() WHERE id=NEW.stock_item_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ims_resv_sync_stock
  AFTER INSERT OR UPDATE ON public.ims_reservations
  FOR EACH ROW EXECUTE FUNCTION public.ims_resv_sync_stock();

-- ============= AUDIT LOG =============
CREATE TABLE public.ims_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ims_audit_entity ON public.ims_audit_log(entity, entity_id);
CREATE INDEX idx_ims_audit_created ON public.ims_audit_log(created_at);

GRANT SELECT, INSERT ON public.ims_audit_log TO authenticated;
GRANT ALL ON public.ims_audit_log TO service_role;
ALTER TABLE public.ims_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ims_audit_read" ON public.ims_audit_log FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(),'ims','read') OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ims_audit_insert" ON public.ims_audit_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- Generic audit trigger
CREATE OR REPLACE FUNCTION public.ims_write_audit() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE ent TEXT;
BEGIN
  ent := CASE TG_TABLE_NAME
    WHEN 'ims_stock_items' THEN 'stock_item'
    WHEN 'ims_transactions' THEN 'transaction'
    WHEN 'ims_transfers' THEN 'transfer'
    WHEN 'ims_reservations' THEN 'reservation'
    ELSE TG_TABLE_NAME END;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.ims_audit_log(entity, entity_id, action, new_value, user_id)
      VALUES (ent, NEW.id, 'create', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.ims_audit_log(entity, entity_id, action, old_value, new_value, user_id)
      VALUES (ent, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.ims_audit_log(entity, entity_id, action, old_value, user_id)
      VALUES (ent, OLD.id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_audit_ims_stock AFTER INSERT OR UPDATE OR DELETE ON public.ims_stock_items
  FOR EACH ROW EXECUTE FUNCTION public.ims_write_audit();
CREATE TRIGGER trg_audit_ims_txn AFTER INSERT OR UPDATE OR DELETE ON public.ims_transactions
  FOR EACH ROW EXECUTE FUNCTION public.ims_write_audit();
CREATE TRIGGER trg_audit_ims_xfer AFTER INSERT OR UPDATE OR DELETE ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.ims_write_audit();
CREATE TRIGGER trg_audit_ims_resv AFTER INSERT OR UPDATE OR DELETE ON public.ims_reservations
  FOR EACH ROW EXECUTE FUNCTION public.ims_write_audit();

-- ============= APP MODULE =============
INSERT INTO public.app_modules(key, label, sort_order, supports_import, is_active)
VALUES ('ims','IMS',45,false,true)
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
-- SOURCE: 20260617120854_d8712878-d6e8-4993-af53-0aec7084bd46.sql
-- =====================================================================

-- 1) Add OEM Case ID to transactions for full indent traceability
ALTER TABLE public.ims_transactions
  ADD COLUMN IF NOT EXISTS oem_case_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ims_txn_oem_case ON public.ims_transactions(oem_case_id);

-- Backfill from indents where possible
UPDATE public.ims_transactions t
   SET oem_case_id = i.oem_case_id
  FROM public.indents i
 WHERE t.indent_id = i.id
   AND t.oem_case_id IS NULL
   AND i.oem_case_id IS NOT NULL;

-- 2) Rewrite transfer status effects
-- Approval/in_transit  -> transfer_out + stock=in_transit (deducted from source)
-- Completed            -> transfer_in  + stock moves to destination, status=available
-- Auto-link stock item by serial + source warehouse if not pre-set
CREATE OR REPLACE FUNCTION public.ims_transfer_status_effects() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  linked_id UUID := NEW.stock_item_id;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('in_transit','completed') THEN

    -- Auto-link by serial + source warehouse when not chosen
    IF linked_id IS NULL AND NEW.part_serial_no IS NOT NULL THEN
      SELECT id INTO linked_id
        FROM public.ims_stock_items
       WHERE part_serial_no = NEW.part_serial_no
         AND (NEW.source_warehouse_id IS NULL OR warehouse_id = NEW.source_warehouse_id)
       LIMIT 1;
      IF linked_id IS NOT NULL THEN
        NEW.stock_item_id := linked_id;
      END IF;
    END IF;

    IF NEW.status = 'in_transit' THEN
      IF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET stock_status = 'in_transit', updated_at = now()
         WHERE id = linked_id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
      ) VALUES (
        'transfer_out', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
        NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
        'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
      );

    ELSIF NEW.status = 'completed' THEN
      IF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET warehouse_id  = NEW.destination_warehouse_id,
               stock_status  = 'available',
               updated_at    = now()
         WHERE id = linked_id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
      ) VALUES (
        'transfer_in', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
        NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
        'Transfer received', NEW.received_by
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Switch trigger to BEFORE UPDATE so NEW.stock_item_id mutation persists
DROP TRIGGER IF EXISTS trg_ims_transfer_status_effects ON public.ims_transfers;
CREATE TRIGGER trg_ims_transfer_status_effects
  BEFORE UPDATE OF status ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.ims_transfer_status_effects();


-- =====================================================================
-- SOURCE: 20260617130647_44a29e09-b220-4184-b358-643aa100ac67.sql
-- =====================================================================

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


-- =====================================================================
-- SOURCE: 20260617170240_87c7ec8e-783a-45b1-805c-6ac0adb3fc3f.sql
-- =====================================================================
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS defective_parts_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS defective_parts_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS good_parts_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS good_parts_details jsonb NOT NULL DEFAULT '[]'::jsonb;

-- =====================================================================
-- SOURCE: 20260618085919_ee3f4ecb-ff72-4e2c-bcb2-3e64a441b816.sql
-- =====================================================================
ALTER TABLE public.indents ADD COLUMN IF NOT EXISTS oracles_data jsonb NOT NULL DEFAULT '[]'::jsonb;

-- =====================================================================
-- SOURCE: 20260621100303_e97d9eff-c669-44cf-bebf-2762091d54a3.sql
-- =====================================================================

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


-- =====================================================================
-- SOURCE: 20260621101657_579900da-e2f5-4047-83b3-1116e1fba223.sql
-- =====================================================================

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


-- =====================================================================
-- SOURCE: 20260623065217_d1dfcd1b-345e-4d5c-bfe6-4457fdb477ef.sql
-- =====================================================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS weight_kg NUMERIC;

-- =====================================================================
-- SOURCE: 20260624035436_727bd65f-7628-4add-a5bb-b4c2cd474288.sql
-- =====================================================================
-- Backfill place_of_supply from the GSTIN state code on existing customers
-- where place_of_supply is missing but gst is present.
WITH state_map AS (
  SELECT * FROM (VALUES
    ('01','Jammu and Kashmir'),('02','Himachal Pradesh'),('03','Punjab'),
    ('04','Chandigarh'),('05','Uttarakhand'),('06','Haryana'),('07','Delhi'),
    ('08','Rajasthan'),('09','Uttar Pradesh'),('10','Bihar'),('11','Sikkim'),
    ('12','Arunachal Pradesh'),('13','Nagaland'),('14','Manipur'),('15','Mizoram'),
    ('16','Tripura'),('17','Meghalaya'),('18','Assam'),('19','West Bengal'),
    ('20','Jharkhand'),('21','Odisha'),('22','Chhattisgarh'),('23','Madhya Pradesh'),
    ('24','Gujarat'),('25','Daman and Diu'),('26','Dadra and Nagar Haveli'),
    ('27','Maharashtra'),('28','Andhra Pradesh'),('29','Karnataka'),('30','Goa'),
    ('31','Lakshadweep'),('32','Kerala'),('33','Tamil Nadu'),('34','Puducherry'),
    ('35','Andaman and Nicobar Islands'),('36','Telangana'),('37','Andhra Pradesh'),
    ('38','Ladakh')
  ) AS t(code, state_name)
)
UPDATE public.customers c
   SET place_of_supply = sm.state_name
  FROM state_map sm
 WHERE (c.place_of_supply IS NULL OR btrim(c.place_of_supply) = '')
   AND c.gst IS NOT NULL
   AND length(c.gst) >= 2
   AND substr(c.gst, 1, 2) = sm.code;


-- =====================================================================
-- SOURCE: 20260625072907_5260952b-e893-46ad-90dd-4b53c8dc3662.sql
-- =====================================================================

-- 1. Remove claim-first-admin escalation
DROP POLICY IF EXISTS "claim first admin" ON public.user_roles;

-- 2. Enable RLS on sequence tables; no policies = denied for authenticated/anon; service_role bypasses
ALTER TABLE public.indent_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ims_transfer_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ims_txn_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.indent_sequence FROM anon, authenticated;
REVOKE ALL ON public.ims_transfer_sequence FROM anon, authenticated;
REVOKE ALL ON public.ims_txn_sequence FROM anon, authenticated;
GRANT ALL ON public.indent_sequence TO service_role;
GRANT ALL ON public.ims_transfer_sequence TO service_role;
GRANT ALL ON public.ims_txn_sequence TO service_role;

-- 3. Password history: revoke direct writes from authenticated; only service_role writes
REVOKE INSERT, UPDATE, DELETE ON public.password_history FROM authenticated, anon;
GRANT ALL ON public.password_history TO service_role;

-- 4. Storage: allow authenticated to update/delete ticket attachments
CREATE POLICY "Authenticated update ticket attachments"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'ticket-attachments')
  WITH CHECK (bucket_id = 'ticket-attachments');
CREATE POLICY "Authenticated delete ticket attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ticket-attachments');

-- 5. Replace USING(true)/WITH CHECK(true) on non-SELECT policies with auth.uid() IS NOT NULL
DO $$
DECLARE
  r record;
  using_clause text;
  check_clause text;
  cmd_text text;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, p.polname, p.polcmd,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS wcheck
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND p.polcmd <> 'r'  -- skip SELECT
       AND (pg_get_expr(p.polqual, p.polrelid) = 'true'
            OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true')
  LOOP
    cmd_text := CASE r.polcmd WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END;
    EXECUTE format('DROP POLICY %I ON %I.%I', r.polname, r.nspname, r.relname);

    using_clause := CASE WHEN r.qual IS NULL THEN '' ELSE ' USING (auth.uid() IS NOT NULL)' END;
    check_clause := CASE WHEN r.wcheck IS NULL THEN '' ELSE ' WITH CHECK (auth.uid() IS NOT NULL)' END;

    EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s TO authenticated%s%s',
                   r.polname, r.nspname, r.relname, cmd_text, using_clause, check_clause);
  END LOOP;
END $$;


-- =====================================================================
-- SOURCE: 20260626052248_1bb85376-e8a7-4e32-aee6-348e3a025d47.sql
-- =====================================================================

-- 1. Columns
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

ALTER TABLE public.amcs
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Backfill tickets
UPDATE public.tickets SET is_deleted = true WHERE deleted_at IS NOT NULL AND is_deleted = false;

-- 2. Indexes for dashboard counts
CREATE INDEX IF NOT EXISTS idx_tickets_active ON public.tickets (created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_indents_active ON public.indents (created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_amcs_active    ON public.amcs    (end_date)        WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tickets_archived ON public.tickets (deleted_at) WHERE is_deleted = true;
CREATE INDEX IF NOT EXISTS idx_indents_archived ON public.indents (deleted_at) WHERE is_deleted = true;
CREATE INDEX IF NOT EXISTS idx_amcs_archived    ON public.amcs    (deleted_at) WHERE is_deleted = true;

-- 3. Update SELECT policies to hide soft-deleted from non-admin users
DROP POLICY IF EXISTS "auth view tickets" ON public.tickets;
CREATE POLICY "auth view tickets" ON public.tickets FOR SELECT
  USING (auth.uid() IS NOT NULL AND (is_deleted = false OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "auth view indents" ON public.indents;
CREATE POLICY "auth view indents" ON public.indents FOR SELECT
  USING (auth.uid() IS NOT NULL AND (is_deleted = false OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "Authenticated can view amcs" ON public.amcs;
CREATE POLICY "Authenticated can view amcs" ON public.amcs FOR SELECT
  USING (auth.uid() IS NOT NULL AND (is_deleted = false OR public.has_role(auth.uid(),'admin')));

-- 4. Restrict hard DELETE to admins only (soft delete from app is an UPDATE; admin Archive purge uses service role)
DROP POLICY IF EXISTS "Creator or admin delete tickets" ON public.tickets;
CREATE POLICY "Admin only hard delete tickets" ON public.tickets FOR DELETE
  USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Creator or admin delete indents" ON public.indents;
CREATE POLICY "Admin only hard delete indents" ON public.indents FOR DELETE
  USING (public.has_role(auth.uid(),'admin'));

-- amcs had no explicit delete policy; add admin-only
DROP POLICY IF EXISTS "Admin only hard delete amcs" ON public.amcs;
CREATE POLICY "Admin only hard delete amcs" ON public.amcs FOR DELETE
  USING (public.has_role(auth.uid(),'admin'));

-- 5. Enable realtime
ALTER TABLE public.tickets REPLICA IDENTITY FULL;
ALTER TABLE public.indents REPLICA IDENTITY FULL;
ALTER TABLE public.amcs    REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.indents; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.amcs;    EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 6. Cleanup function — hard-deletes anything soft-deleted >30 days ago
CREATE OR REPLACE FUNCTION public.purge_archived_records()
RETURNS TABLE(tickets_deleted int, indents_deleted int, amcs_deleted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t int := 0; i int := 0; a int := 0;
BEGIN
  WITH d AS (DELETE FROM public.indents WHERE is_deleted = true AND deleted_at < now() - interval '30 days' RETURNING 1)
    SELECT count(*) INTO i FROM d;
  WITH d AS (DELETE FROM public.amcs    WHERE is_deleted = true AND deleted_at < now() - interval '30 days' RETURNING 1)
    SELECT count(*) INTO a FROM d;
  WITH d AS (DELETE FROM public.tickets WHERE is_deleted = true AND deleted_at < now() - interval '30 days' RETURNING 1)
    SELECT count(*) INTO t FROM d;
  RETURN QUERY SELECT t, i, a;
END $$;

REVOKE ALL ON FUNCTION public.purge_archived_records() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_archived_records() TO service_role;

-- 7. Schedule daily purge at 02:00 IST (20:30 UTC)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-archived-records-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-archived-records-daily');
    PERFORM cron.schedule(
      'purge-archived-records-daily',
      '30 20 * * *',
      $cron$ SELECT public.purge_archived_records(); $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;


-- =====================================================================
-- SOURCE: 20260627082815_5a111d6b-a909-425d-8bf2-b2e82efdafc7.sql
-- =====================================================================
ALTER TABLE public.amcs ALTER COLUMN duration_years TYPE numeric;

-- =====================================================================
-- SOURCE: 20260701070025_316ae623-5165-4a37-9617-050cb2a0d314.sql
-- =====================================================================
-- Complaint Master table for standardized ticket complaint descriptions
CREATE TABLE public.complaint_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX complaint_master_name_lower_key ON public.complaint_master (lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.complaint_master TO authenticated;
GRANT ALL ON public.complaint_master TO service_role;

ALTER TABLE public.complaint_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "complaint_master read" ON public.complaint_master
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "complaint_master insert" ON public.complaint_master
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "complaint_master admin update" ON public.complaint_master
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "complaint_master admin delete" ON public.complaint_master
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER complaint_master_touch_updated_at
  BEFORE UPDATE ON public.complaint_master
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed default complaint options
INSERT INTO public.complaint_master (name) VALUES
  ('Backup Issue'),
  ('Battery Faulty'),
  ('Power Board Faulty'),
  ('Charger Card Faulty'),
  ('Battery Not Charging'),
  ('Charger Not Working'),
  ('Power Failure'),
  ('Battery Replacement Required'),
  ('Charger Replacement Required'),
  ('Alarm Issue'),
  ('Display Issue'),
  ('Wiring Issue'),
  ('Installation Issue'),
  ('Preventive Maintenance'),
  ('General Service'),
  ('Other')
ON CONFLICT DO NOTHING;

-- Migrate: import any distinct existing ticket complaint values that don't already exist
INSERT INTO public.complaint_master (name)
SELECT DISTINCT initcap(trim(t.complaint))
FROM public.tickets t
WHERE t.complaint IS NOT NULL
  AND trim(t.complaint) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.complaint_master cm
    WHERE lower(cm.name) = lower(trim(t.complaint))
  )
ON CONFLICT DO NOTHING;

-- =====================================================================
-- SOURCE: 20260706061617_051a01ef-53f3-4465-82a2-c904426be472.sql
-- =====================================================================

-- Tighten UPDATE policies on tickets, amcs, indents to require module edit permission or admin
DROP POLICY IF EXISTS "auth update tickets" ON public.tickets;
CREATE POLICY "auth update tickets" ON public.tickets
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'tickets', 'edit')
  OR created_by = auth.uid()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'tickets', 'edit')
  OR created_by = auth.uid()
);

DROP POLICY IF EXISTS "Authenticated can update amcs" ON public.amcs;
CREATE POLICY "Authenticated can update amcs" ON public.amcs
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'amc', 'edit')
  OR created_by = auth.uid()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'amc', 'edit')
  OR created_by = auth.uid()
);

DROP POLICY IF EXISTS "auth update indents" ON public.indents;
CREATE POLICY "auth update indents" ON public.indents
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'indent', 'edit')
  OR created_by = auth.uid()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'indent', 'edit')
  OR created_by = auth.uid()
);

-- Restrict user_roles SELECT to own row or admins
DROP POLICY IF EXISTS "view roles" ON public.user_roles;
CREATE POLICY "view roles" ON public.user_roles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
);

-- Storage: amc-agreements requires amc module permission
DROP POLICY IF EXISTS "Authenticated can read amc agreements" ON storage.objects;
CREATE POLICY "Authenticated can read amc agreements" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'read'))
);

DROP POLICY IF EXISTS "Authenticated can update amc agreements" ON storage.objects;
CREATE POLICY "Authenticated can update amc agreements" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'edit'))
)
WITH CHECK (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'edit'))
);

DROP POLICY IF EXISTS "Authenticated can delete amc agreements" ON storage.objects;
CREATE POLICY "Authenticated can delete amc agreements" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'delete') OR public.has_permission(auth.uid(), 'amc', 'edit'))
);

-- Also ensure INSERT is scoped (upload uses user-side supabase client)
DROP POLICY IF EXISTS "Authenticated can insert amc agreements" ON storage.objects;
CREATE POLICY "Authenticated can insert amc agreements" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'edit') OR public.has_permission(auth.uid(), 'amc', 'create'))
);

-- Storage: ticket-attachments requires tickets module permission
DROP POLICY IF EXISTS "Authenticated can read ticket attachments" ON storage.objects;
CREATE POLICY "Authenticated can read ticket attachments" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'tickets', 'read'))
);

DROP POLICY IF EXISTS "Authenticated update ticket attachments" ON storage.objects;
CREATE POLICY "Authenticated update ticket attachments" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'tickets', 'edit'))
)
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'tickets', 'edit'))
);

DROP POLICY IF EXISTS "Authenticated delete ticket attachments" ON storage.objects;
CREATE POLICY "Authenticated delete ticket attachments" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'tickets', 'delete') OR public.has_permission(auth.uid(), 'tickets', 'edit'))
);


-- =====================================================================
-- SOURCE: 20260706092259_7e942e27-8935-41c1-9ca8-80d90060fb01.sql
-- =====================================================================
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS parent_tagging_required boolean NOT NULL DEFAULT false;
UPDATE public.products SET parent_tagging_required = true WHERE category = 'Spare Parts' AND parent_tagging_required = false;

-- =====================================================================
-- SOURCE: 20260707092721_ff151f0c-d387-4ddc-8808-d44c32d6555e.sql
-- =====================================================================
-- =============================================================================
-- HEAD SALES: GST-compliant Invoicing, Payments, e-Way Bill
-- =============================================================================

-- --- Extend branches with full seller identity ---------------------------------
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS state_name TEXT,
  ADD COLUMN IF NOT EXISTS state_code TEXT,
  ADD COLUMN IF NOT EXISTS pan TEXT,
  ADD COLUMN IF NOT EXISTS cin TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS bank_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account TEXT,
  ADD COLUMN IF NOT EXISTS bank_ifsc TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch TEXT,
  ADD COLUMN IF NOT EXISTS upi_id TEXT,
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS invoice_footer TEXT,
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;

-- --- Extend products with GST rate + stock-on-invoice flag ---------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS track_stock_on_invoice BOOLEAN NOT NULL DEFAULT false;

-- --- Extend customers with state code for GST engine ---------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS state_code TEXT;

-- =============================================================================
-- INVOICE SETTINGS (per branch)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoice_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL DEFAULT 'PHS/INV/',
  fy_reset BOOLEAN NOT NULL DEFAULT true,
  current_fy TEXT,
  next_seq INT NOT NULL DEFAULT 1,
  terms_default TEXT,
  notes_default TEXT,
  place_of_supply_default TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_settings TO authenticated;
GRANT ALL ON public.invoice_settings TO service_role;
ALTER TABLE public.invoice_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_settings_read" ON public.invoice_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoice_settings_write" ON public.invoice_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_invoice_settings_updated_at BEFORE UPDATE ON public.invoice_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =============================================================================
-- INVOICES
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no TEXT UNIQUE,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),

  -- captured seller snapshot (in case branch details change later)
  seller_name TEXT,
  seller_gstin TEXT,
  seller_state TEXT,
  seller_state_code TEXT,
  seller_address TEXT,

  -- captured buyer snapshot
  buyer_name TEXT,
  buyer_gstin TEXT,
  buyer_state TEXT,
  buyer_state_code TEXT,
  billing_address TEXT,
  shipping_address TEXT,
  place_of_supply TEXT,
  place_of_supply_code TEXT,

  is_interstate BOOLEAN NOT NULL DEFAULT false,
  reverse_charge BOOLEAN NOT NULL DEFAULT false,

  linked_quote_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL,
  linked_dc_ids UUID[] DEFAULT '{}',

  -- money (all in INR, rounded to 2)
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess NUMERIC(14,2) NOT NULL DEFAULT 0,
  round_off NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_paid NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_in_words TEXT,

  status TEXT NOT NULL DEFAULT 'draft', -- draft | issued | partial | paid | cancelled
  cancel_reason TEXT,
  cancelled_at TIMESTAMPTZ,

  -- e-Invoice (IRN) fields
  irn TEXT,
  ack_no TEXT,
  ack_date TIMESTAMPTZ,
  qr_payload TEXT,
  einvoice_status TEXT, -- null | pending | generated | cancelled | failed
  einvoice_error TEXT,

  -- e-Way Bill
  ewaybill_no TEXT,
  ewaybill_date TIMESTAMPTZ,
  ewaybill_valid_till TIMESTAMPTZ,

  notes TEXT,
  terms TEXT,
  pdf_url TEXT,

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_read" ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "invoices_update" ON public.invoices FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "invoices_delete_admin" ON public.invoices FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS idx_invoices_date ON public.invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_branch ON public.invoices(branch_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =============================================================================
-- INVOICE ITEMS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  sr_no INT NOT NULL DEFAULT 1,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  hsn TEXT,
  qty NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit TEXT,
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_items_all" ON public.invoice_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);

-- =============================================================================
-- PAYMENTS RECEIVED
-- =============================================================================
CREATE SEQUENCE IF NOT EXISTS public.payment_no_seq;

CREATE TABLE IF NOT EXISTS public.payments_received (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_no TEXT UNIQUE,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  mode TEXT NOT NULL DEFAULT 'bank', -- bank | cash | upi | cheque | neft | rtgs | card
  reference TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  unallocated NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments_received TO authenticated;
GRANT ALL ON public.payments_received TO service_role;
ALTER TABLE public.payments_received ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_read" ON public.payments_received FOR SELECT TO authenticated USING (true);
CREATE POLICY "payments_insert" ON public.payments_received FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "payments_update" ON public.payments_received FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "payments_delete_admin" ON public.payments_received FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_payments_received_updated_at BEFORE UPDATE ON public.payments_received
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.set_payment_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE yr TEXT := to_char(now(),'YYYY'); seq BIGINT;
BEGIN
  IF NEW.payment_no IS NULL OR NEW.payment_no = '' THEN
    seq := nextval('public.payment_no_seq');
    NEW.payment_no := 'PHS/RCPT/' || yr || '/' || lpad(seq::text, 4, '0');
  END IF;
  IF NEW.unallocated IS NULL THEN NEW.unallocated := NEW.amount; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_set_payment_no BEFORE INSERT ON public.payments_received
  FOR EACH ROW EXECUTE FUNCTION public.set_payment_no();

-- =============================================================================
-- PAYMENT ALLOCATIONS (payment ↔ invoice, many-to-many with amounts)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES public.payments_received(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay_alloc_all" ON public.payment_allocations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_payment ON public.payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_pay_alloc_invoice ON public.payment_allocations(invoice_id);

-- Trigger: after allocation change, refresh invoice + payment aggregates
CREATE OR REPLACE FUNCTION public.refresh_invoice_and_payment_balances()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  inv_id UUID;
  pay_id UUID;
  inv_total NUMERIC(14,2);
  paid NUMERIC(14,2);
  pay_amount NUMERIC(14,2);
  allocated NUMERIC(14,2);
BEGIN
  inv_id := COALESCE(NEW.invoice_id, OLD.invoice_id);
  pay_id := COALESCE(NEW.payment_id, OLD.payment_id);

  -- Payment side
  SELECT amount INTO pay_amount FROM public.payments_received WHERE id = pay_id;
  SELECT COALESCE(SUM(amount),0) INTO allocated FROM public.payment_allocations WHERE payment_id = pay_id;
  IF allocated > pay_amount + 0.01 THEN
    RAISE EXCEPTION 'Cannot allocate more (%) than payment amount (%)', allocated, pay_amount;
  END IF;
  UPDATE public.payments_received SET unallocated = pay_amount - allocated WHERE id = pay_id;

  -- Invoice side
  SELECT total INTO inv_total FROM public.invoices WHERE id = inv_id;
  SELECT COALESCE(SUM(amount),0) INTO paid FROM public.payment_allocations WHERE invoice_id = inv_id;
  UPDATE public.invoices
     SET total_paid = paid,
         status = CASE
           WHEN status = 'cancelled' THEN 'cancelled'
           WHEN paid >= inv_total - 0.01 THEN 'paid'
           WHEN paid > 0 THEN 'partial'
           WHEN status IN ('draft') THEN 'draft'
           ELSE 'issued'
         END
   WHERE id = inv_id;

  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_pay_alloc_refresh
AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
FOR EACH ROW EXECUTE FUNCTION public.refresh_invoice_and_payment_balances();

-- =============================================================================
-- E-WAY BILLS
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.eway_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  transporter_name TEXT,
  transporter_id TEXT,
  vehicle_no TEXT,
  distance_km NUMERIC(8,2),
  transport_mode TEXT, -- road | rail | air | ship
  doc_type TEXT DEFAULT 'INV',
  ewb_no TEXT,
  ewb_date TIMESTAMPTZ,
  valid_till TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | generated | cancelled | failed
  payload JSONB,
  response JSONB,
  error TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.eway_bills TO authenticated;
GRANT ALL ON public.eway_bills TO service_role;
ALTER TABLE public.eway_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eway_all" ON public.eway_bills FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_eway_bills_updated_at BEFORE UPDATE ON public.eway_bills
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =============================================================================
-- INVOICE NUMBER GENERATOR (per branch, FY-aware)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_invoice_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  s public.invoice_settings%ROWTYPE;
  d DATE := COALESCE(NEW.invoice_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.invoice_no IS NOT NULL AND NEW.invoice_no <> '' THEN
    RETURN NEW;
  END IF;

  -- Fiscal year (Apr-Mar)
  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  SELECT * INTO s FROM public.invoice_settings WHERE branch_id = NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.invoice_settings (branch_id, current_fy, next_seq)
      VALUES (NEW.branch_id, fy, 1)
      RETURNING * INTO s;
  END IF;

  -- FY reset
  IF s.fy_reset AND (s.current_fy IS NULL OR s.current_fy <> fy) THEN
    UPDATE public.invoice_settings
       SET current_fy = fy, next_seq = 1
     WHERE id = s.id
    RETURNING * INTO s;
  END IF;

  seq := s.next_seq;
  new_prefix := COALESCE(s.prefix, 'PHS/INV/');

  NEW.invoice_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');

  UPDATE public.invoice_settings SET next_seq = next_seq + 1 WHERE id = s.id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_set_invoice_no BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_no();

-- =============================================================================
-- Register the new sales module in the permissions system
-- =============================================================================
INSERT INTO public.app_modules (key, label, sort_order, supports_import, is_active)
VALUES ('sales', 'Sales & Invoicing', 25, false, true)
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
-- SOURCE: 20260707153609_6313f1b0-9350-4c75-abf6-2544baaccf97.sql
-- =====================================================================
ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS theme_color TEXT NOT NULL DEFAULT '#000000',
  ADD COLUMN IF NOT EXISTS copy_label TEXT NOT NULL DEFAULT 'Original Copy';

-- =====================================================================
-- SOURCE: 20260707162545_ee2117ea-89af-4145-aa6e-1c729df84d37.sql
-- =====================================================================
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS po_number TEXT,
  ADD COLUMN IF NOT EXISTS po_date DATE;

-- =====================================================================
-- SOURCE: 20260707165758_75f298cc-040e-41dd-9d71-8fea47524fe1.sql
-- =====================================================================

-- 1. payment_terms on invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_terms TEXT;

-- 2. warehouse_id + serial_numbers on invoice_items
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS serial_numbers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS idx_invoice_items_warehouse ON public.invoice_items(warehouse_id);

-- 3. Trigger: on invoice_items INSERT/UPDATE/DELETE, sync ims_stock_items.stock_status
CREATE OR REPLACE FUNCTION public.invoice_item_sync_serials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed TEXT[];
  added TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.serial_numbers IS NOT NULL AND array_length(NEW.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(NEW.serial_numbers)
         AND stock_status = 'available';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    removed := ARRAY(SELECT unnest(COALESCE(OLD.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(NEW.serial_numbers,'{}')));
    added   := ARRAY(SELECT unnest(COALESCE(NEW.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(OLD.serial_numbers,'{}')));
    IF array_length(removed,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(removed)
         AND stock_status = 'issued';
    END IF;
    IF array_length(added,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(added)
         AND stock_status = 'available';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.serial_numbers IS NOT NULL AND array_length(OLD.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(OLD.serial_numbers)
         AND stock_status = 'issued';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_item_sync_serials ON public.invoice_items;
CREATE TRIGGER trg_invoice_item_sync_serials
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.invoice_item_sync_serials();

-- 4. Trigger: on invoice cancel, revert serials to available
CREATE OR REPLACE FUNCTION public.invoice_cancel_release_serials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    UPDATE public.ims_stock_items s
       SET stock_status = 'available', updated_at = now()
      FROM public.invoice_items ii
     WHERE ii.invoice_id = NEW.id
       AND s.part_serial_no = ANY(ii.serial_numbers)
       AND s.stock_status = 'issued';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_cancel_release_serials ON public.invoices;
CREATE TRIGGER trg_invoice_cancel_release_serials
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.invoice_cancel_release_serials();


-- =====================================================================
-- SOURCE: 20260707172002_86ad4db5-7261-4af5-a905-5d4b3bed60bf.sql
-- =====================================================================

-- ============ PURCHASE ORDER MODULE ============

-- 1. Module registration
INSERT INTO public.app_modules (key, label, supports_import)
VALUES ('po', 'Purchase Orders', false)
ON CONFLICT (key) DO NOTHING;

-- 2. PO Settings (per-branch numbering)
CREATE TABLE IF NOT EXISTS public.po_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL DEFAULT 'PROKON/PO/',
  fy_reset BOOLEAN NOT NULL DEFAULT true,
  current_fy TEXT,
  next_seq INT NOT NULL DEFAULT 1,
  terms_default TEXT,
  notes_default TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_settings TO authenticated;
GRANT ALL ON public.po_settings TO service_role;
ALTER TABLE public.po_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po_settings read"  ON public.po_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "po_settings write" ON public.po_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3. Purchase Orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_no TEXT UNIQUE,
  po_date DATE NOT NULL DEFAULT CURRENT_DATE,
  delivery_date DATE,
  branch_id UUID NOT NULL REFERENCES public.branches(id),
  vendor_id UUID NOT NULL REFERENCES public.vendors(id),

  vendor_name TEXT,
  vendor_gstin TEXT,
  vendor_address TEXT,
  vendor_contact_name TEXT,
  vendor_phone TEXT,
  vendor_email TEXT,
  vendor_state_code TEXT,
  vendor_state_name TEXT,

  buyer_name TEXT,
  buyer_gstin TEXT,
  buyer_state_code TEXT,
  buyer_state_name TEXT,
  buyer_address TEXT,

  -- Delivery
  delivery_address_type TEXT NOT NULL DEFAULT 'org' CHECK (delivery_address_type IN ('org','customer','custom')),
  delivery_address TEXT,
  customer_id UUID REFERENCES public.customers(id),
  customer_name TEXT,

  payment_terms TEXT,
  is_interstate BOOLEAN NOT NULL DEFAULT false,

  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess NUMERIC(14,2) NOT NULL DEFAULT 0,
  round_off NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_in_words TEXT,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','sent','partial','completed','cancelled')),

  notes TEXT,
  terms TEXT,

  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po read"   ON public.purchase_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "po insert" ON public.purchase_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "po update" ON public.purchase_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "po delete" ON public.purchase_orders FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_po_touch BEFORE UPDATE ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Purchase Order Items
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sr_no INT NOT NULL DEFAULT 1,
  product_id UUID REFERENCES public.products(id),
  description TEXT NOT NULL,
  hsn TEXT,
  qty NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit TEXT,
  rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  taxable_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  gst_rate NUMERIC(6,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(14,2) NOT NULL DEFAULT 0,
  igst NUMERIC(14,2) NOT NULL DEFAULT 0,
  cess NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  received_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_order_items TO authenticated;
GRANT ALL ON public.purchase_order_items TO service_role;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po_items all" ON public.purchase_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_vendor ON public.purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_date ON public.purchase_orders(po_date DESC);

-- 5. Auto PO number trigger
CREATE OR REPLACE FUNCTION public.set_po_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s public.po_settings%ROWTYPE;
  d DATE := COALESCE(NEW.po_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.po_no IS NOT NULL AND NEW.po_no <> '' THEN
    RETURN NEW;
  END IF;

  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  SELECT * INTO s FROM public.po_settings WHERE branch_id = NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.po_settings (branch_id, prefix, fy_reset, current_fy, next_seq)
      VALUES (NEW.branch_id, 'PROKON/PO/', true, fy, 1)
      RETURNING * INTO s;
  END IF;

  IF s.fy_reset AND (s.current_fy IS NULL OR s.current_fy <> fy) THEN
    UPDATE public.po_settings SET current_fy = fy, next_seq = 1
      WHERE id = s.id RETURNING * INTO s;
  END IF;

  seq := s.next_seq;
  new_prefix := COALESCE(s.prefix, 'PROKON/PO/');

  IF s.fy_reset THEN
    NEW.po_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');
  ELSE
    NEW.po_no := new_prefix || to_char(d,'YYYY') || '/' || lpad(seq::text, 4, '0');
  END IF;

  UPDATE public.po_settings SET next_seq = next_seq + 1 WHERE id = s.id;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_po_set_no BEFORE INSERT ON public.purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.set_po_no();


-- =====================================================================
-- SOURCE: 20260708073047_b1e70965-350b-44b9-b20e-244bc0ae065e.sql
-- =====================================================================
ALTER TABLE public.invoice_settings
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS company_address text,
  ADD COLUMN IF NOT EXISTS udyam_no text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS email text;

-- =====================================================================
-- SOURCE: 20260708170427_d629c457-5059-4346-97dc-956007e5c2a0.sql
-- =====================================================================

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


-- =====================================================================
-- SOURCE: 20260709120145_d93eed54-0b52-4ec7-9f0c-3f78c35c3128.sql
-- =====================================================================

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id),
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS delivery_timeline text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone text;


-- =====================================================================
-- SOURCE: 20260709120658_d86bc977-36f2-4c64-a08b-3b962f5c1dd7.sql
-- =====================================================================

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


-- =====================================================================
-- SOURCE: 20260709123245_0da9df07-28ce-4fca-97e9-ecd50b182c77.sql
-- =====================================================================

-- 1. Sales order sequence settings (per-branch, FY-reset like invoice/PO)
CREATE TABLE IF NOT EXISTS public.sales_order_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID,
  prefix TEXT NOT NULL DEFAULT 'PHS/SO/',
  fy_reset BOOLEAN NOT NULL DEFAULT true,
  current_fy TEXT,
  next_seq INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_order_settings TO authenticated;
GRANT ALL ON public.sales_order_settings TO service_role;
ALTER TABLE public.sales_order_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "so_settings authenticated read"  ON public.sales_order_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "so_settings authenticated write" ON public.sales_order_settings FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "so_settings authenticated update" ON public.sales_order_settings FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "so_settings authenticated delete" ON public.sales_order_settings FOR DELETE TO authenticated USING (true);

-- 2. Sales orders table
CREATE TABLE IF NOT EXISTS public.sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  so_no TEXT UNIQUE,
  so_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  expected_delivery DATE,
  branch_id UUID,
  customer_id UUID,
  seller_name TEXT,
  seller_gstin TEXT,
  seller_state TEXT,
  seller_state_code TEXT,
  seller_address TEXT,
  buyer_name TEXT,
  buyer_gstin TEXT,
  buyer_state TEXT,
  buyer_state_code TEXT,
  billing_address TEXT,
  shipping_address TEXT,
  place_of_supply TEXT,
  place_of_supply_code TEXT,
  is_interstate BOOLEAN DEFAULT false,
  reverse_charge BOOLEAN DEFAULT false,
  contact_person TEXT,
  contact_email TEXT,
  contact_mobile TEXT,
  salesperson TEXT,
  payment_terms TEXT,
  delivery_timeline TEXT,
  po_number TEXT,
  po_date DATE,
  subtotal NUMERIC(14,2) DEFAULT 0,
  discount NUMERIC(14,2) DEFAULT 0,
  taxable_value NUMERIC(14,2) DEFAULT 0,
  cgst NUMERIC(14,2) DEFAULT 0,
  sgst NUMERIC(14,2) DEFAULT 0,
  igst NUMERIC(14,2) DEFAULT 0,
  cess NUMERIC(14,2) DEFAULT 0,
  round_off NUMERIC(14,2) DEFAULT 0,
  total NUMERIC(14,2) DEFAULT 0,
  total_in_words TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  terms TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_quote_id UUID REFERENCES public.quotations(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_orders_customer_idx ON public.sales_orders(customer_id);
CREATE INDEX IF NOT EXISTS sales_orders_quote_idx ON public.sales_orders(linked_quote_id);
CREATE INDEX IF NOT EXISTS sales_orders_status_idx ON public.sales_orders(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_orders TO authenticated;
GRANT ALL ON public.sales_orders TO service_role;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_orders authenticated read"   ON public.sales_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "sales_orders authenticated insert" ON public.sales_orders FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "sales_orders authenticated update" ON public.sales_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sales_orders authenticated delete" ON public.sales_orders FOR DELETE TO authenticated USING (true);

-- 3. Numbering trigger
CREATE OR REPLACE FUNCTION public.set_so_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  s public.sales_order_settings%ROWTYPE;
  d DATE := COALESCE(NEW.so_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.so_no IS NOT NULL AND NEW.so_no <> '' THEN RETURN NEW; END IF;

  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  SELECT * INTO s FROM public.sales_order_settings WHERE branch_id IS NOT DISTINCT FROM NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.sales_order_settings (branch_id, current_fy, next_seq)
      VALUES (NEW.branch_id, fy, 1) RETURNING * INTO s;
  END IF;

  IF s.fy_reset AND (s.current_fy IS NULL OR s.current_fy <> fy) THEN
    UPDATE public.sales_order_settings SET current_fy = fy, next_seq = 1
      WHERE id = s.id RETURNING * INTO s;
  END IF;

  seq := s.next_seq;
  new_prefix := COALESCE(s.prefix, 'PHS/SO/');
  NEW.so_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');
  UPDATE public.sales_order_settings SET next_seq = next_seq + 1 WHERE id = s.id;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_set_so_no ON public.sales_orders;
CREATE TRIGGER trg_set_so_no BEFORE INSERT ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_so_no();

DROP TRIGGER IF EXISTS trg_so_touch_updated ON public.sales_orders;
CREATE TRIGGER trg_so_touch_updated BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_so_settings_touch ON public.sales_order_settings;
CREATE TRIGGER trg_so_settings_touch BEFORE UPDATE ON public.sales_order_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Parent references on existing tables
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS converted_to_so_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quotation_id  UUID REFERENCES public.quotations(id)   ON DELETE SET NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dc_sales_order_idx ON public.delivery_challans(sales_order_id);
CREATE INDEX IF NOT EXISTS invoices_so_idx ON public.invoices(sales_order_id);


-- =====================================================================
-- SOURCE: 20260710143032_3ab7c175-c545-4d89-b238-f397f6da0478.sql
-- =====================================================================

-- Remove overly permissive storage INSERT policies (rely on stricter permission-checked policies)
DROP POLICY IF EXISTS "Authenticated can upload amc agreements" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload ticket attachments" ON storage.objects;

-- Tighten customers SELECT to permission-gated access
DROP POLICY IF EXISTS "auth view customers" ON public.customers;
CREATE POLICY "customers_read_permission" ON public.customers
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'customers', 'read')
    OR has_permission(auth.uid(), 'sales', 'read')
  );

-- Align ims_transactions UPDATE with other IMS tables (allow ims edit permission)
DROP POLICY IF EXISTS "ims_txn_update" ON public.ims_transactions;
CREATE POLICY "ims_txn_update" ON public.ims_transactions
  FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(), 'ims', 'edit') OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_permission(auth.uid(), 'ims', 'edit') OR has_role(auth.uid(), 'admin'::app_role));


-- =====================================================================
-- SOURCE: 20260710143916_2769139d-4a2f-4ab9-af0b-bd6cbcaecd95.sql
-- =====================================================================

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS last_login timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity timestamptz,
  ADD COLUMN IF NOT EXISTS last_logout timestamptz,
  ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.record_user_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.app_users
     SET last_login = now(),
         last_activity = now(),
         login_count = COALESCE(login_count,0) + 1
   WHERE user_id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.record_user_activity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.app_users
     SET last_activity = now()
   WHERE user_id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.record_user_logout()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.app_users
     SET last_logout = now()
   WHERE user_id = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.record_user_login()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_activity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_logout()   TO authenticated;


-- =====================================================================
-- SOURCE: 20260713054828_e45f6c22-5003-45e8-93cd-d0f9f26d61be.sql
-- =====================================================================
ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS pin_code TEXT;

-- =====================================================================
-- SOURCE: 20260713062437_e6944e57-97bc-47ef-bae9-4566a46e43eb.sql
-- =====================================================================

DROP POLICY IF EXISTS grns_update ON public.grns;
DROP POLICY IF EXISTS grns_delete ON public.grns;

CREATE POLICY grns_update ON public.grns
  FOR UPDATE TO authenticated
  USING ((auth.uid() = created_by) OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((auth.uid() = created_by) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY grns_delete ON public.grns
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));


-- =====================================================================
-- SOURCE: 20260713063058_e8e00861-3626-401a-b64c-bc05c9e7f37f.sql
-- =====================================================================

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS pin_code TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.delivery_challans ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);
ALTER TABLE public.grns ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);
ALTER TABLE public.gatepasses ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

CREATE INDEX IF NOT EXISTS idx_delivery_challans_branch ON public.delivery_challans(branch_id);
CREATE INDEX IF NOT EXISTS idx_grns_branch ON public.grns(branch_id);
CREATE INDEX IF NOT EXISTS idx_gatepasses_branch ON public.gatepasses(branch_id);
CREATE INDEX IF NOT EXISTS idx_branches_company ON public.branches(company_id);


-- =====================================================================
-- SOURCE: 20260714055833_4937b5a6-0e47-4087-892a-89c1001ee694.sql
-- =====================================================================
ALTER TABLE public.product_spare_parts ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- =====================================================================
-- SOURCE: 20260715070000_4856999b-0321-4569-8b00-ace57e1ef227.sql
-- =====================================================================
ALTER TABLE public.ims_stock_items ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1; ALTER TABLE public.ims_stock_items ADD COLUMN IF NOT EXISTS opening_stock boolean NOT NULL DEFAULT false;

-- =====================================================================
-- SOURCE: 20260716174215_630f2fbb-9203-42a6-970c-6d7a2e88156d.sql
-- =====================================================================

-- 1) Tighten SELECT policies on tickets, amcs, indents
DROP POLICY IF EXISTS "auth view tickets" ON public.tickets;
CREATE POLICY "auth view tickets" ON public.tickets
FOR SELECT USING (
  ((is_deleted = false) OR public.has_role(auth.uid(), 'admin'::app_role))
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'read')
    OR created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Authenticated can view amcs" ON public.amcs;
CREATE POLICY "Authenticated can view amcs" ON public.amcs
FOR SELECT USING (
  ((is_deleted = false) OR public.has_role(auth.uid(), 'admin'::app_role))
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'amc', 'read')
    OR created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "auth view indents" ON public.indents;
CREATE POLICY "auth view indents" ON public.indents
FOR SELECT USING (
  ((is_deleted = false) OR public.has_role(auth.uid(), 'admin'::app_role))
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'indent', 'read')
    OR created_by = auth.uid()
  )
);

-- 2) Replace always-true UPDATE/INSERT/DELETE policies with permission-based checks

-- Invoices (sales module)
DROP POLICY IF EXISTS invoices_insert ON public.invoices;
CREATE POLICY invoices_insert ON public.invoices
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'create')
);

DROP POLICY IF EXISTS invoices_update ON public.invoices;
CREATE POLICY invoices_update ON public.invoices
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
);

-- Payments Received (sales module)
DROP POLICY IF EXISTS payments_insert ON public.payments_received;
CREATE POLICY payments_insert ON public.payments_received
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'create')
);

DROP POLICY IF EXISTS payments_update ON public.payments_received;
CREATE POLICY payments_update ON public.payments_received
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
);

-- Purchase Orders (po module)
DROP POLICY IF EXISTS "po insert" ON public.purchase_orders;
CREATE POLICY "po insert" ON public.purchase_orders
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'po', 'create')
);

DROP POLICY IF EXISTS "po update" ON public.purchase_orders;
CREATE POLICY "po update" ON public.purchase_orders
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'po', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'po', 'edit')
);

DROP POLICY IF EXISTS "po delete" ON public.purchase_orders;
CREATE POLICY "po delete" ON public.purchase_orders
FOR DELETE USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'po', 'delete')
);

-- Sales Orders (sales module)
DROP POLICY IF EXISTS "sales_orders authenticated update" ON public.sales_orders;
CREATE POLICY "sales_orders authenticated update" ON public.sales_orders
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
);

DROP POLICY IF EXISTS "sales_orders authenticated delete" ON public.sales_orders;
CREATE POLICY "sales_orders authenticated delete" ON public.sales_orders
FOR DELETE USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'delete')
);

-- Sales Order Settings (sales module)
DROP POLICY IF EXISTS "so_settings authenticated write" ON public.sales_order_settings;
CREATE POLICY "so_settings authenticated write" ON public.sales_order_settings
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'create')
);

DROP POLICY IF EXISTS "so_settings authenticated update" ON public.sales_order_settings;
CREATE POLICY "so_settings authenticated update" ON public.sales_order_settings
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
);

DROP POLICY IF EXISTS "so_settings authenticated delete" ON public.sales_order_settings;
CREATE POLICY "so_settings authenticated delete" ON public.sales_order_settings
FOR DELETE USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'delete')
);

-- Product Bundles (products module)
DROP POLICY IF EXISTS "Authenticated can insert product bundles" ON public.product_bundles;
CREATE POLICY "Authenticated can insert product bundles" ON public.product_bundles
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'products', 'create')
);

DROP POLICY IF EXISTS "Authenticated can update product bundles" ON public.product_bundles;
CREATE POLICY "Authenticated can update product bundles" ON public.product_bundles
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'products', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'products', 'edit')
);

DROP POLICY IF EXISTS "Authenticated can delete product bundles" ON public.product_bundles;
CREATE POLICY "Authenticated can delete product bundles" ON public.product_bundles
FOR DELETE USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'products', 'delete')
);

-- 3) Ticket attachments bucket: explicit INSERT policy scoped to Tickets module permission
DROP POLICY IF EXISTS "ticket_attachments staff upload" ON storage.objects;
CREATE POLICY "ticket_attachments staff upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'create')
    OR public.has_permission(auth.uid(), 'tickets', 'edit')
  )
);


-- =====================================================================
-- SOURCE: 20260717054828_675b9f59-054c-4a11-ade2-d1c8b475ce57.sql
-- =====================================================================

CREATE TABLE public.indent_oracle_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_id uuid NOT NULL REFERENCES public.indents(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  oracle_no text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, oracle_no)
);
CREATE INDEX idx_indent_oracle_map_indent ON public.indent_oracle_map(indent_id);
CREATE INDEX idx_indent_oracle_map_ticket ON public.indent_oracle_map(ticket_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.indent_oracle_map TO authenticated;
GRANT ALL ON public.indent_oracle_map TO service_role;

ALTER TABLE public.indent_oracle_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "indent_oracle_map_read_auth"
  ON public.indent_oracle_map FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "indent_oracle_map_write_auth"
  ON public.indent_oracle_map FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Trigger fn: rebuild map rows for an indent from its oracles_data
CREATE OR REPLACE FUNCTION public.sync_indent_oracle_map()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  b jsonb;
  onum text;
BEGIN
  DELETE FROM public.indent_oracle_map WHERE indent_id = NEW.id;
  IF NEW.oracles_data IS NOT NULL AND jsonb_typeof(NEW.oracles_data) = 'array' THEN
    FOR b IN SELECT * FROM jsonb_array_elements(NEW.oracles_data)
    LOOP
      onum := btrim(COALESCE(b->>'oracle_no',''));
      IF onum <> '' THEN
        INSERT INTO public.indent_oracle_map (indent_id, ticket_id, oracle_no)
        VALUES (NEW.id, NEW.ticket_id, onum)
        ON CONFLICT (ticket_id, oracle_no) DO UPDATE SET indent_id = EXCLUDED.indent_id;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_indent_oracle_map ON public.indents;
CREATE TRIGGER trg_sync_indent_oracle_map
AFTER INSERT OR UPDATE OF oracles_data, ticket_id ON public.indents
FOR EACH ROW EXECUTE FUNCTION public.sync_indent_oracle_map();

-- Backfill from existing indents
INSERT INTO public.indent_oracle_map (indent_id, ticket_id, oracle_no)
SELECT i.id, i.ticket_id, btrim(b->>'oracle_no')
FROM public.indents i,
     LATERAL jsonb_array_elements(COALESCE(i.oracles_data, '[]'::jsonb)) AS b
WHERE i.ticket_id IS NOT NULL
  AND COALESCE(btrim(b->>'oracle_no'),'') <> ''
ON CONFLICT (ticket_id, oracle_no) DO NOTHING;


-- =====================================================================
-- SOURCE: 20260718165034_5ac970ee-9a8f-4b9c-93d3-feb1ff46d56b.sql
-- =====================================================================

CREATE TABLE public.charger_ah_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charger_current numeric NOT NULL UNIQUE,
  max_battery_ah numeric NOT NULL,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.charger_ah_limits TO authenticated;
GRANT ALL ON public.charger_ah_limits TO service_role;
ALTER TABLE public.charger_ah_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read charger limits" ON public.charger_ah_limits FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage charger limits" ON public.charger_ah_limits FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER charger_ah_limits_touch BEFORE UPDATE ON public.charger_ah_limits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- =====================================================================
-- SOURCE: 20260719170613_0698cf51-1414-4882-a06b-aac4c80a3117.sql
-- =====================================================================

-- OEM logos catalog
CREATE TABLE public.oem_logos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  oem_name TEXT NOT NULL,
  logo_path TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT 'center' CHECK (position IN ('left','center','right')),
  size TEXT NOT NULL DEFAULT 'medium' CHECK (size IN ('small','medium','large')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.oem_logos TO authenticated;
GRANT ALL ON public.oem_logos TO service_role;

ALTER TABLE public.oem_logos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read oem_logos" ON public.oem_logos FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage oem_logos" ON public.oem_logos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_oem_logos_updated_at BEFORE UPDATE ON public.oem_logos
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Include-logos toggle on quotations
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS include_oem_logos BOOLEAN NOT NULL DEFAULT true;

-- Storage policies for oem-logos bucket (private; authenticated read + admin write)
CREATE POLICY "oem_logos read auth" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'oem-logos');
CREATE POLICY "oem_logos write admin" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'oem-logos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "oem_logos update admin" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'oem-logos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "oem_logos delete admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'oem-logos' AND public.has_role(auth.uid(), 'admin'));


-- =====================================================================
-- SOURCE: 20260721044733_1e892cea-5a5e-4350-a37c-d29e369d28b3.sql
-- =====================================================================
-- ============================================================
-- RMA Workflow: link columns, stock category, indent status
-- ============================================================

-- 1. Link columns on delivery_challans and grns
ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS indent_id UUID NULL REFERENCES public.indents(id) ON DELETE SET NULL;

ALTER TABLE public.grns
  ADD COLUMN IF NOT EXISTS indent_id UUID NULL REFERENCES public.indents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_category TEXT NULL;

-- General GRN stock category values
DO $$ BEGIN
  ALTER TABLE public.grns
    ADD CONSTRAINT grns_stock_category_chk
    CHECK (stock_category IS NULL OR stock_category IN ('good','defective','quarantine'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_delivery_challans_indent ON public.delivery_challans(indent_id);
CREATE INDEX IF NOT EXISTS idx_grns_indent ON public.grns(indent_id);

-- 2. Allow "general" doc_type on delivery_challans
DO $$ BEGIN
  ALTER TABLE public.delivery_challans DROP CONSTRAINT IF EXISTS delivery_challans_doc_type_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
ALTER TABLE public.delivery_challans
  ADD CONSTRAINT delivery_challans_doc_type_check
  CHECK (doc_type IN ('customer','oem','general'));

-- 3. Indent status column
ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

DO $$ BEGIN
  ALTER TABLE public.indents
    ADD CONSTRAINT indents_status_chk
    CHECK (status IN ('draft','open','in_progress','partially_completed','completed','closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. DC posting trigger — dispatch decrements stock; cancel reverses
-- ============================================================
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  it JSONB;
  serial TEXT;
  qty NUMERIC;
  model TEXT;
  part_name_v TEXT;
  oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type TEXT;
  txn_type_v TEXT;
  new_status TEXT;
BEGIN
  -- Determine which side (customer=good, oem=defective, general=skip auto)
  IF NEW.doc_type = 'customer' THEN
    target_type := 'good';   txn_type_v := 'good_out';
  ELSIF NEW.doc_type = 'oem' THEN
    target_type := 'defective'; txn_type_v := 'defective_out';
  ELSE
    RETURN NEW; -- general DC: no auto-post
  END IF;

  -- ==== POST on transition to Dispatched ====
  IF NEW.status = 'Dispatched' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Dispatched') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);

      IF qty <= 0 THEN CONTINUE; END IF;

      -- Serial-tracked path: enforce availability
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial
            AND stock_type = target_type
            AND stock_status = 'available'
          LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot dispatch DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;

        UPDATE public.ims_stock_items
          SET stock_status = CASE WHEN NEW.doc_type='oem' THEN 'returned_to_oem' ELSE 'issued' END,
              transaction_ref = 'DC ' || NEW.challan_no,
              updated_at = now()
          WHERE id = stock_row.id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, from_party, to_party, qty,
        indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v::txn_type_enum, -- if enum; else cast handled below
        stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial,
        COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id, NULL,
        NULL,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty,
        NEW.indent_id,
        'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan dispatch',
        NEW.created_by
      );
    END LOOP;

  -- ==== REVERSE on transition away from Dispatched (e.g., Cancelled) ====
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Dispatched' AND NEW.status <> 'Dispatched' THEN
    -- Restore any stock items linked by this DC's ref
    UPDATE public.ims_stock_items
       SET stock_status = 'available', updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued','returned_to_oem');

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment', 'DC Reversal', 0, 'DC ' || NEW.challan_no,
      'Reversal: DC status changed from Dispatched to ' || NEW.status,
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN invalid_text_representation THEN
  -- ims_transactions.txn_type is TEXT, not enum — retry without cast
  RAISE;
END $$;

-- Simpler variant: ims_transactions.txn_type is TEXT (per schema). Redefine cleanly.
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type TEXT; txn_type_v TEXT;
BEGIN
  IF NEW.doc_type = 'customer' THEN
    target_type := 'good';      txn_type_v := 'good_out';
  ELSIF NEW.doc_type = 'oem' THEN
    target_type := 'defective'; txn_type_v := 'defective_out';
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.status = 'Dispatched' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Dispatched') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      stock_row := NULL;
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available' LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot dispatch DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = CASE WHEN NEW.doc_type='oem' THEN 'returned_to_oem' ELSE 'issued' END,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial, COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan dispatch', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Dispatched' AND NEW.status <> 'Dispatched' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available', updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued','returned_to_oem');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dc_post_inventory ON public.delivery_challans;
CREATE TRIGGER trg_dc_post_inventory
  AFTER INSERT OR UPDATE OF status ON public.delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.dc_post_inventory();

-- ============================================================
-- 5. GRN posting trigger — Approved credits stock; Rejected reverses
-- ============================================================
CREATE OR REPLACE FUNCTION public.grn_post_inventory()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  target_type TEXT; txn_type_v TEXT;
  new_id UUID;
BEGIN
  -- Determine stock side
  IF NEW.category = 'customer' THEN
    target_type := 'defective'; txn_type_v := 'defective_in';
  ELSIF NEW.category = 'oem' THEN
    target_type := 'good';      txn_type_v := 'good_in';
  ELSE
    -- general: driven by stock_category (default good)
    IF COALESCE(NEW.stock_category,'good') = 'defective' THEN
      target_type := 'defective'; txn_type_v := 'defective_in';
    ELSE
      target_type := 'good';      txn_type_v := 'good_in';
    END IF;
  END IF;

  IF NEW.status = 'Approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Approved') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      INSERT INTO public.ims_stock_items(
        oem, part_name, part_model_no, part_serial_no, warehouse_id,
        stock_type, stock_status, qty, transaction_ref, notes, created_by
      ) VALUES (
        oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, NEW.warehouse_id,
        target_type, 'available', qty, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
      ) RETURNING id INTO new_id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
        NEW.warehouse_id,
        COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
        qty, NEW.indent_id, 'GRN ' || NEW.grn_no,
        'Auto-posted from GRN approval', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Approved' AND NEW.status <> 'Approved' THEN
    -- Reverse: mark stock items scrapped and log adjustment
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped', updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available';

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment', 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN status changed from Approved to ' || NEW.status,
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_grn_post_inventory ON public.grns;
CREATE TRIGGER trg_grn_post_inventory
  AFTER INSERT OR UPDATE OF status ON public.grns
  FOR EACH ROW EXECUTE FUNCTION public.grn_post_inventory();

-- ============================================================
-- 6. Indent lifecycle auto-status
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_indent_status(_indent_id UUID)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  dc_count INT; grn_count INT;
  dc_dispatched INT; grn_approved INT;
  new_status TEXT;
BEGIN
  IF _indent_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='Dispatched')
    INTO dc_count, dc_dispatched
    FROM public.delivery_challans WHERE indent_id = _indent_id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='Approved')
    INTO grn_count, grn_approved
    FROM public.grns WHERE indent_id = _indent_id;

  IF dc_count = 0 AND grn_count = 0 THEN
    new_status := 'open';
  ELSIF (dc_dispatched + grn_approved) = 0 THEN
    new_status := 'in_progress';
  ELSIF (dc_dispatched = dc_count) AND (grn_approved = grn_count) AND (dc_count + grn_count) > 0 THEN
    new_status := 'completed';
  ELSE
    new_status := 'partially_completed';
  END IF;

  UPDATE public.indents
     SET status = new_status, updated_at = now()
   WHERE id = _indent_id AND status NOT IN ('closed','draft');
END $$;

CREATE OR REPLACE FUNCTION public.trg_indent_recalc_from_doc()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.recalc_indent_status(COALESCE(NEW.indent_id, OLD.indent_id));
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_dc_indent_recalc ON public.delivery_challans;
CREATE TRIGGER trg_dc_indent_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.trg_indent_recalc_from_doc();

DROP TRIGGER IF EXISTS trg_grn_indent_recalc ON public.grns;
CREATE TRIGGER trg_grn_indent_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.grns
  FOR EACH ROW EXECUTE FUNCTION public.trg_indent_recalc_from_doc();

-- Move new indents from draft → open on first save-with-oracles
CREATE OR REPLACE FUNCTION public.indent_default_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS NULL OR NEW.status = '' THEN
    NEW.status := 'open';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_indent_default_status ON public.indents;
CREATE TRIGGER trg_indent_default_status
  BEFORE INSERT ON public.indents
  FOR EACH ROW EXECUTE FUNCTION public.indent_default_status();


-- =====================================================================
-- SOURCE: 20260721045554_cd20b1ee-013b-4e8f-8527-f0e58ff0c3b6.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION public._oracle_row_str(v JSONB, k TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT btrim(COALESCE(v ->> k, '')) $$;

CREATE OR REPLACE FUNCTION public._oracle_block_complete(blk JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  drows JSONB := COALESCE(blk->'defective_rows','[]'::jsonb);
  erows JSONB := COALESCE(blk->'exchange_rows','[]'::jsonb);
  rrows JSONB := COALESCE(blk->'received_rows','[]'::jsonb);
  n INT := jsonb_array_length(drows);
  i INT;
  d JSONB; e JSONB; r JSONB;
BEGIN
  IF n = 0 THEN RETURN FALSE; END IF;
  IF jsonb_array_length(erows) < n OR jsonb_array_length(rrows) < n THEN RETURN FALSE; END IF;
  FOR i IN 0..n-1 LOOP
    d := drows -> i; e := erows -> i; r := rrows -> i;
    IF public._oracle_row_str(d,'def_model_no') = '' OR public._oracle_row_str(d,'def_serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(d,'qty') = '' OR (public._oracle_row_str(d,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(e,'warehouse_id') = '' OR public._oracle_row_str(e,'model_no') = '' OR public._oracle_row_str(e,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(e,'qty') = '' OR (public._oracle_row_str(e,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'warehouse_id') = '' OR public._oracle_row_str(r,'model_no') = '' OR public._oracle_row_str(r,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'qty') = '' OR (public._oracle_row_str(r,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'received_date') = '' THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $$;

DO $$
DECLARE
  r RECORD;
  new_blocks JSONB;
  blk JSONB;
  changed BOOLEAN;
  now_ts TEXT := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  FOR r IN SELECT id, oracles_data FROM public.indents WHERE oracles_data IS NOT NULL LOOP
    new_blocks := '[]'::jsonb;
    changed := FALSE;
    FOR blk IN SELECT * FROM jsonb_array_elements(r.oracles_data) LOOP
      IF COALESCE(blk->>'status','open') <> 'closed' AND public._oracle_block_complete(blk) THEN
        blk := blk || jsonb_build_object(
          'status','closed',
          'closed_at', now_ts,
          'closed_by', COALESCE(blk->'closed_by','null'::jsonb),
          'closed_by_name', COALESCE(blk->'closed_by_name', to_jsonb('System (backfill)'::text))
        );
        changed := TRUE;
      END IF;
      new_blocks := new_blocks || jsonb_build_array(blk);
    END LOOP;
    IF changed THEN
      UPDATE public.indents SET oracles_data = new_blocks, updated_at = now() WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Keep the helpers so future ingest paths can reuse the same completeness check.


-- =====================================================================
-- SOURCE: 20260721045618_4715f528-6d91-44b9-92ca-1a0e32a08990.sql
-- =====================================================================

ALTER FUNCTION public._oracle_row_str(JSONB, TEXT) SET search_path = public;
ALTER FUNCTION public._oracle_block_complete(JSONB) SET search_path = public;


-- =====================================================================
-- SOURCE: 20260721054044_546380e7-cea4-4e61-bf33-3e151eaa1bb7.sql
-- =====================================================================

-- Audit columns for submit/print lifecycle on DC and GRN
ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS printed_by UUID,
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

ALTER TABLE public.grns
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS printed_by UUID,
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

-- Rework DC inventory trigger to fire on Submitted (was Dispatched).
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type TEXT; txn_type_v TEXT;
BEGIN
  IF NEW.doc_type = 'customer' THEN
    target_type := 'good';      txn_type_v := 'good_out';
  ELSIF NEW.doc_type = 'oem' THEN
    target_type := 'defective'; txn_type_v := 'defective_out';
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      stock_row := NULL;
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available' LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot submit DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = CASE WHEN NEW.doc_type='oem' THEN 'returned_to_oem' ELSE 'issued' END,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial, COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available', updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued','returned_to_oem');
  END IF;

  RETURN NEW;
END $function$;

-- Rework GRN inventory trigger to fire on Submitted (was Approved).
CREATE OR REPLACE FUNCTION public.grn_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  target_type TEXT; txn_type_v TEXT;
  new_id UUID;
BEGIN
  IF NEW.category = 'customer' THEN
    target_type := 'defective'; txn_type_v := 'defective_in';
  ELSIF NEW.category = 'oem' THEN
    target_type := 'good';      txn_type_v := 'good_in';
  ELSE
    IF COALESCE(NEW.stock_category,'good') = 'defective' THEN
      target_type := 'defective'; txn_type_v := 'defective_in';
    ELSE
      target_type := 'good';      txn_type_v := 'good_in';
    END IF;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      INSERT INTO public.ims_stock_items(
        oem, part_name, part_model_no, part_serial_no, warehouse_id,
        stock_type, stock_status, qty, transaction_ref, notes, created_by
      ) VALUES (
        oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, NEW.warehouse_id,
        target_type, 'available', qty, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
      ) RETURNING id INTO new_id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
        NEW.warehouse_id,
        COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
        qty, NEW.indent_id, 'GRN ' || NEW.grn_no,
        'Auto-posted from GRN submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped', updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available';

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment', 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $function$;

-- Indent status recalculation now driven by Submitted docs.
CREATE OR REPLACE FUNCTION public.recalc_indent_status(_indent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  dc_count INT; grn_count INT;
  dc_done INT; grn_done INT;
  new_status TEXT;
BEGIN
  IF _indent_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='Submitted')
    INTO dc_count, dc_done
    FROM public.delivery_challans WHERE indent_id = _indent_id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='Submitted')
    INTO grn_count, grn_done
    FROM public.grns WHERE indent_id = _indent_id;

  IF dc_count = 0 AND grn_count = 0 THEN
    new_status := 'open';
  ELSIF (dc_done + grn_done) = 0 THEN
    new_status := 'in_progress';
  ELSIF (dc_done = dc_count) AND (grn_done = grn_count) AND (dc_count + grn_count) > 0 THEN
    new_status := 'completed';
  ELSE
    new_status := 'partially_completed';
  END IF;

  UPDATE public.indents
     SET status = new_status, updated_at = now()
   WHERE id = _indent_id AND status NOT IN ('closed','draft');
END $function$;

-- Backfill: existing "Dispatched" DCs and "Approved" GRNs are effectively already
-- posted to inventory. Mark them as Submitted so the new lifecycle is consistent
-- and reporting/indent recalculation continues to see them as completed.
UPDATE public.delivery_challans SET status = 'Submitted' WHERE status = 'Dispatched';
UPDATE public.grns SET status = 'Submitted' WHERE status = 'Approved';


-- =====================================================================
-- SOURCE: 20260721055343_82b816ab-022f-408e-869b-bb215cceb2c3.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type public.ims_stock_type; txn_type_v TEXT;
BEGIN
  IF NEW.doc_type = 'customer' THEN
    target_type := 'good'::public.ims_stock_type;      txn_type_v := 'good_out';
  ELSIF NEW.doc_type = 'oem' THEN
    target_type := 'defective'::public.ims_stock_type; txn_type_v := 'defective_out';
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      stock_row := NULL;
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot submit DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = CASE WHEN NEW.doc_type='oem' THEN 'returned_to_oem'::public.ims_stock_status ELSE 'issued'::public.ims_stock_status END,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial, COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status);
  END IF;

  RETURN NEW;
END $function$;


CREATE OR REPLACE FUNCTION public.grn_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  target_type public.ims_stock_type; txn_type_v TEXT;
  new_id UUID;
BEGIN
  IF NEW.category = 'customer' THEN
    target_type := 'defective'::public.ims_stock_type; txn_type_v := 'defective_in';
  ELSIF NEW.category = 'oem' THEN
    target_type := 'good'::public.ims_stock_type;      txn_type_v := 'good_in';
  ELSE
    IF COALESCE(NEW.stock_category,'good') = 'defective' THEN
      target_type := 'defective'::public.ims_stock_type; txn_type_v := 'defective_in';
    ELSE
      target_type := 'good'::public.ims_stock_type;      txn_type_v := 'good_in';
    END IF;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      INSERT INTO public.ims_stock_items(
        oem, part_name, part_model_no, part_serial_no, warehouse_id,
        stock_type, stock_status, qty, transaction_ref, notes, created_by
      ) VALUES (
        oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, NEW.warehouse_id,
        target_type, 'available'::public.ims_stock_status, qty, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
      ) RETURNING id INTO new_id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
        NEW.warehouse_id,
        COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
        qty, NEW.indent_id, 'GRN ' || NEW.grn_no,
        'Auto-posted from GRN submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available'::public.ims_stock_status;

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment', 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $function$;


-- =====================================================================
-- SOURCE: 20260721055934_867f797b-cb2f-4e68-9887-ae8f92a19c1e.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
BEGIN
  IF NEW.doc_type = 'customer' THEN
    target_type := 'good'::public.ims_stock_type;      txn_type_v := 'good_out'::public.ims_txn_type;
  ELSIF NEW.doc_type = 'oem' THEN
    target_type := 'defective'::public.ims_stock_type; txn_type_v := 'defective_out'::public.ims_txn_type;
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      stock_row := NULL;
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot submit DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = CASE WHEN NEW.doc_type='oem' THEN 'returned_to_oem'::public.ims_stock_status ELSE 'issued'::public.ims_stock_status END,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial, COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status);
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.grn_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  new_id UUID;
BEGIN
  IF NEW.category = 'customer' THEN
    target_type := 'defective'::public.ims_stock_type; txn_type_v := 'defective_in'::public.ims_txn_type;
  ELSIF NEW.category = 'oem' THEN
    target_type := 'good'::public.ims_stock_type;      txn_type_v := 'good_in'::public.ims_txn_type;
  ELSE
    IF COALESCE(NEW.stock_category,'good') = 'defective' THEN
      target_type := 'defective'::public.ims_stock_type; txn_type_v := 'defective_in'::public.ims_txn_type;
    ELSE
      target_type := 'good'::public.ims_stock_type;      txn_type_v := 'good_in'::public.ims_txn_type;
    END IF;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      INSERT INTO public.ims_stock_items(
        oem, part_name, part_model_no, part_serial_no, warehouse_id,
        stock_type, stock_status, qty, transaction_ref, notes, created_by
      ) VALUES (
        oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, NEW.warehouse_id,
        target_type, 'available'::public.ims_stock_status, qty, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
      ) RETURNING id INTO new_id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
        NEW.warehouse_id,
        COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
        qty, NEW.indent_id, 'GRN ' || NEW.grn_no,
        'Auto-posted from GRN submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available'::public.ims_stock_status;

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment'::public.ims_txn_type, 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $function$;


-- =====================================================================
-- SOURCE: 20260721061219_e2df0de2-e0e7-4c6f-99d5-37a785e6c1f2.sql
-- =====================================================================

-- Relax the CHECK constraint to accept new + legacy statuses
ALTER TABLE public.delivery_challans DROP CONSTRAINT IF EXISTS delivery_challans_status_check;
ALTER TABLE public.delivery_challans
  ADD CONSTRAINT delivery_challans_status_check
  CHECK (status IN ('Draft','Submitted','Challan Generated','Cancelled'));

-- Move existing Draft rows to the new single status
UPDATE public.delivery_challans SET status = 'Challan Generated' WHERE status = 'Draft';

-- Default new rows to the new status
ALTER TABLE public.delivery_challans ALTER COLUMN status SET DEFAULT 'Challan Generated';

-- Update posting trigger to fire on Challan Generated (Submitted retained for history)
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  is_posting_new BOOLEAN;
  was_posting_old BOOLEAN;
BEGIN
  IF NEW.doc_type = 'customer' THEN
    target_type := 'good'::public.ims_stock_type;      txn_type_v := 'good_out'::public.ims_txn_type;
  ELSIF NEW.doc_type = 'oem' THEN
    target_type := 'defective'::public.ims_stock_type; txn_type_v := 'defective_out'::public.ims_txn_type;
  ELSE
    RETURN NEW;
  END IF;

  is_posting_new  := NEW.status IN ('Challan Generated','Submitted');
  was_posting_old := TG_OP = 'UPDATE' AND OLD.status IN ('Challan Generated','Submitted');

  IF is_posting_new AND (TG_OP = 'INSERT' OR NOT was_posting_old) THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      stock_row := NULL;
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot post DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = CASE WHEN NEW.doc_type='oem' THEN 'returned_to_oem'::public.ims_stock_status ELSE 'issued'::public.ims_stock_status END,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial, COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND was_posting_old AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status);
  END IF;

  RETURN NEW;
END $function$;


-- =====================================================================
-- SOURCE: 20260721062222_867bda4f-6e59-4566-b41e-65e14481e2a1.sql
-- =====================================================================

-- Audit table
CREATE TABLE IF NOT EXISTS public.document_deletion_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_type TEXT NOT NULL,
  document_subtype TEXT,
  document_no TEXT NOT NULL,
  document_id UUID NOT NULL,
  reason TEXT NOT NULL,
  deleted_by UUID,
  deleted_by_name TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  original_created_by UUID,
  original_created_at TIMESTAMPTZ,
  snapshot JSONB
);

GRANT SELECT, INSERT ON public.document_deletion_audit TO authenticated;
GRANT ALL ON public.document_deletion_audit TO service_role;

ALTER TABLE public.document_deletion_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view deletion audit"
  ON public.document_deletion_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert deletion audit"
  ON public.document_deletion_audit FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_doc_del_audit_type ON public.document_deletion_audit(document_type, deleted_at DESC);

-- Admin delete: Delivery Challan
CREATE OR REPLACE FUNCTION public.admin_delete_challan(_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dc public.delivery_challans%ROWTYPE;
  ref TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete Delivery Challans';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for deletion';
  END IF;

  SELECT * INTO dc FROM public.delivery_challans WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery Challan not found'; END IF;

  ref := 'DC ' || dc.challan_no;

  -- Reverse stock statuses touched by this DC
  UPDATE public.ims_stock_items
     SET stock_status = 'available'::public.ims_stock_status,
         transaction_ref = NULL,
         updated_at = now()
   WHERE transaction_ref = ref
     AND stock_status IN ('issued'::public.ims_stock_status,
                          'returned_to_oem'::public.ims_stock_status,
                          'reserved'::public.ims_stock_status);

  -- Remove ledger + reservation entries tied to this DC
  DELETE FROM public.ims_transactions WHERE reference = ref;
  DELETE FROM public.ims_reservations WHERE reference = ref;

  -- Audit
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason,
     deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('delivery_challan', dc.doc_type, dc.challan_no, dc.id, _reason,
     auth.uid(), dc.created_by, dc.created_at, to_jsonb(dc));

  DELETE FROM public.delivery_challans WHERE id = _id;
END $$;

REVOKE ALL ON FUNCTION public.admin_delete_challan(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_challan(UUID, TEXT) TO authenticated;

-- Admin delete: GRN
CREATE OR REPLACE FUNCTION public.admin_delete_grn(_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gr public.grns%ROWTYPE;
  ref TEXT;
  locked_count INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete GRNs';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for deletion';
  END IF;

  SELECT * INTO gr FROM public.grns WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;

  ref := 'GRN ' || gr.grn_no;

  -- Refuse if any stock created by this GRN has already been consumed downstream
  SELECT count(*) INTO locked_count
    FROM public.ims_stock_items
   WHERE transaction_ref = ref
     AND stock_status NOT IN ('available'::public.ims_stock_status,
                              'scrapped'::public.ims_stock_status);
  IF locked_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete GRN %: % stock item(s) already issued/reserved. Reverse those first.', gr.grn_no, locked_count;
  END IF;

  -- Remove stock created by this GRN and its ledger entries
  DELETE FROM public.ims_transactions WHERE reference = ref;
  DELETE FROM public.ims_stock_items  WHERE transaction_ref = ref;

  -- Audit
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason,
     deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('grn', gr.category, gr.grn_no, gr.id, _reason,
     auth.uid(), gr.created_by, gr.created_at, to_jsonb(gr));

  DELETE FROM public.grns WHERE id = _id;
END $$;

REVOKE ALL ON FUNCTION public.admin_delete_grn(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_grn(UUID, TEXT) TO authenticated;


-- =====================================================================
-- SOURCE: 20260721075348_ab22f59e-e465-43bb-abcd-1e33721c8055.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.grn_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  cond TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  new_id UUID;
  base_type public.ims_stock_type;
  base_txn public.ims_txn_type;
BEGIN
  IF NEW.category = 'customer' THEN
    base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
  ELSIF NEW.category = 'oem' THEN
    base_type := 'good'::public.ims_stock_type;      base_txn := 'good_in'::public.ims_txn_type;
  ELSE
    IF COALESCE(NEW.stock_category,'good') = 'defective' THEN
      base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
    ELSE
      base_type := 'good'::public.ims_stock_type;      base_txn := 'good_in'::public.ims_txn_type;
    END IF;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      cond       := lower(btrim(COALESCE(it->>'condition','')));
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      -- For Customer GRNs, per-item Condition (from Section D Product Tag) overrides
      -- the base classification: Good → Good stock; Scrap → Defective + Scrapped;
      -- anything else → Defective + Available.
      IF NEW.category = 'customer' THEN
        IF cond = 'good' THEN
          target_type := 'good'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'good_in'::public.ims_txn_type;
        ELSIF cond = 'scrap' THEN
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'scrapped'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        ELSE
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        END IF;
      ELSE
        target_type := base_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := base_txn;
      END IF;

      INSERT INTO public.ims_stock_items(
        oem, part_name, part_model_no, part_serial_no, warehouse_id,
        stock_type, stock_status, qty, transaction_ref, notes, created_by
      ) VALUES (
        oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, NEW.warehouse_id,
        target_type, target_status, qty, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
      ) RETURNING id INTO new_id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
        NEW.warehouse_id,
        COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
        qty, NEW.indent_id, 'GRN ' || NEW.grn_no,
        'Auto-posted from GRN submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available'::public.ims_stock_status;

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment'::public.ims_txn_type, 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $function$;

-- =====================================================================
-- SOURCE: 20260721081058_7507a278-2d99-4099-a06c-ba739f31432d.sql
-- =====================================================================

-- 1. Extend completeness check to Section D (customer received rows).
CREATE OR REPLACE FUNCTION public._oracle_block_complete(blk jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  drows JSONB := COALESCE(blk->'defective_rows','[]'::jsonb);
  erows JSONB := COALESCE(blk->'exchange_rows','[]'::jsonb);
  rrows JSONB := COALESCE(blk->'received_rows','[]'::jsonb);
  crows JSONB := COALESCE(blk->'customer_received_rows','[]'::jsonb);
  n INT := jsonb_array_length(drows);
  i INT;
  d JSONB; e JSONB; r JSONB; c JSONB;
BEGIN
  IF n = 0 THEN RETURN FALSE; END IF;
  IF jsonb_array_length(erows) < n OR jsonb_array_length(rrows) < n OR jsonb_array_length(crows) < n THEN RETURN FALSE; END IF;
  FOR i IN 0..n-1 LOOP
    d := drows -> i; e := erows -> i; r := rrows -> i; c := crows -> i;
    -- Section A: Defective
    IF public._oracle_row_str(d,'def_model_no') = '' OR public._oracle_row_str(d,'def_serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(d,'qty') = '' OR (public._oracle_row_str(d,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    -- Section B: Exchange
    IF public._oracle_row_str(e,'warehouse_id') = '' OR public._oracle_row_str(e,'model_no') = '' OR public._oracle_row_str(e,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(e,'qty') = '' OR (public._oracle_row_str(e,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    -- Section C: Material Received (from OEM)
    IF public._oracle_row_str(r,'warehouse_id') = '' OR public._oracle_row_str(r,'model_no') = '' OR public._oracle_row_str(r,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'qty') = '' OR (public._oracle_row_str(r,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'received_date') = '' THEN RETURN FALSE; END IF;
    -- Section D: Material Received (from Customer)
    IF public._oracle_row_str(c,'warehouse_id') = '' OR public._oracle_row_str(c,'model_no') = '' OR public._oracle_row_str(c,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(c,'qty') = '' OR (public._oracle_row_str(c,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(c,'received_date') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(c,'product_tag') = '' THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $function$;

-- 2. Recalculate every indent's oracle statuses per the new rule.
DO $$
DECLARE
  rec RECORD;
  arr JSONB;
  out_arr JSONB;
  blk JSONB;
  new_blk JSONB;
  complete BOOLEAN;
  cur_status TEXT;
  now_ts TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  FOR rec IN SELECT id, oracles_data FROM public.indents WHERE oracles_data IS NOT NULL LOOP
    arr := rec.oracles_data;
    IF jsonb_typeof(arr) <> 'array' THEN CONTINUE; END IF;
    out_arr := '[]'::jsonb;
    FOR blk IN SELECT * FROM jsonb_array_elements(arr) LOOP
      complete := public._oracle_block_complete(blk);
      cur_status := COALESCE(blk->>'status','open');
      IF complete AND cur_status <> 'closed' THEN
        new_blk := blk
          || jsonb_build_object('status','closed')
          || jsonb_build_object('closed_at', COALESCE(blk->>'closed_at', now_ts));
      ELSIF (NOT complete) AND cur_status = 'closed' THEN
        -- Previously closed under looser rule; reopen to reflect Section D gap.
        new_blk := blk
          || jsonb_build_object('status','open','closed_by',NULL,'closed_by_name',NULL,'closed_at',NULL);
      ELSE
        new_blk := blk;
      END IF;
      out_arr := out_arr || jsonb_build_array(new_blk);
    END LOOP;
    IF out_arr IS DISTINCT FROM arr THEN
      UPDATE public.indents SET oracles_data = out_arr, updated_at = now() WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;


-- =====================================================================
-- SOURCE: 20260721090307_105a77fc-819d-4f29-bb48-a0df70ca025f.sql
-- =====================================================================

-- ============================================================
-- Backfill: DC → IMS
-- Idempotent per (DC reference + serial). Best-effort stock update.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_dc_to_ims(_dc_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dc public.delivery_challans%ROWTYPE;
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  ref TEXT;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  target_status public.ims_stock_status;
  stock_row public.ims_stock_items%ROWTYPE;
  inserted_count int := 0;
  exists_txn boolean;
BEGIN
  SELECT * INTO dc FROM public.delivery_challans WHERE id = _dc_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF dc.status NOT IN ('Challan Generated','Submitted') THEN RETURN 0; END IF;
  IF dc.items IS NULL OR jsonb_typeof(dc.items) <> 'array' THEN RETURN 0; END IF;

  IF dc.doc_type = 'customer' THEN
    target_type := 'good'::public.ims_stock_type;
    txn_type_v := 'good_out'::public.ims_txn_type;
    target_status := 'issued'::public.ims_stock_status;
  ELSIF dc.doc_type = 'oem' THEN
    target_type := 'defective'::public.ims_stock_type;
    txn_type_v := 'defective_out'::public.ims_txn_type;
    target_status := 'returned_to_oem'::public.ims_stock_status;
  ELSE
    RETURN 0;
  END IF;

  ref := 'DC ' || dc.challan_no;

  FOR it IN SELECT * FROM jsonb_array_elements(dc.items) LOOP
    serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
    model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
    part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
    oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
    qty        := COALESCE((it->>'qty')::NUMERIC, 1);
    IF qty <= 0 THEN CONTINUE; END IF;

    -- Duplicate check: match on reference + serial (or reference + part_name when no serial)
    SELECT EXISTS (
      SELECT 1 FROM public.ims_transactions
       WHERE reference = ref
         AND ((serial IS NOT NULL AND part_serial_no = serial)
           OR (serial IS NULL AND part_serial_no IS NULL
               AND COALESCE(part_name,'') = COALESCE(part_name_v,'')
               AND COALESCE(part_model_no,'') = COALESCE(model,'')))
    ) INTO exists_txn;
    IF exists_txn THEN CONTINUE; END IF;

    stock_row := NULL;
    IF serial IS NOT NULL THEN
      SELECT * INTO stock_row FROM public.ims_stock_items
        WHERE part_serial_no = serial AND stock_type = target_type
          AND stock_status = 'available'::public.ims_stock_status
        LIMIT 1;
      IF FOUND THEN
        UPDATE public.ims_stock_items
           SET stock_status = target_status,
               transaction_ref = ref,
               updated_at = now()
         WHERE id = stock_row.id;
      END IF;
    END IF;

    INSERT INTO public.ims_transactions(
      txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
      from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by, txn_date
    ) VALUES (
      txn_type_v, stock_row.id,
      COALESCE(part_name_v, stock_row.part_name),
      COALESCE(model, stock_row.part_model_no),
      serial,
      COALESCE(oem_v, stock_row.oem),
      stock_row.warehouse_id,
      COALESCE(dc.party_name, CASE WHEN dc.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
      qty, dc.indent_id, ref,
      'Backfilled from historical Delivery Challan', dc.created_by,
      COALESCE(dc.challan_date::timestamptz, dc.created_at)
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END $$;

-- ============================================================
-- Backfill: GRN → IMS (Submitted only)
-- Idempotent per (GRN reference + serial). Creates fresh stock rows only when missing.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_grn_to_ims(_grn_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gr public.grns%ROWTYPE;
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT; cond TEXT;
  ref TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  base_type public.ims_stock_type;
  base_txn public.ims_txn_type;
  new_id uuid;
  inserted_count int := 0;
  exists_txn boolean;
BEGIN
  SELECT * INTO gr FROM public.grns WHERE id = _grn_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF gr.status <> 'Submitted' THEN RETURN 0; END IF;
  IF gr.items IS NULL OR jsonb_typeof(gr.items) <> 'array' THEN RETURN 0; END IF;

  IF gr.category = 'customer' THEN
    base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
  ELSIF gr.category = 'oem' THEN
    base_type := 'good'::public.ims_stock_type; base_txn := 'good_in'::public.ims_txn_type;
  ELSE
    IF COALESCE(gr.stock_category,'good') = 'defective' THEN
      base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
    ELSE
      base_type := 'good'::public.ims_stock_type; base_txn := 'good_in'::public.ims_txn_type;
    END IF;
  END IF;

  ref := 'GRN ' || gr.grn_no;

  FOR it IN SELECT * FROM jsonb_array_elements(gr.items) LOOP
    serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
    model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
    part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
    oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
    batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
    cond       := lower(btrim(COALESCE(it->>'condition','')));
    qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
    IF qty <= 0 THEN CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.ims_transactions
       WHERE reference = ref
         AND ((serial IS NOT NULL AND part_serial_no = serial)
           OR (serial IS NULL AND part_serial_no IS NULL
               AND COALESCE(part_name,'') = COALESCE(part_name_v,'')
               AND COALESCE(part_model_no,'') = COALESCE(model,'')))
    ) INTO exists_txn;
    IF exists_txn THEN CONTINUE; END IF;

    IF gr.category = 'customer' THEN
      IF cond = 'good' THEN
        target_type := 'good'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'good_in'::public.ims_txn_type;
      ELSIF cond = 'scrap' THEN
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'scrapped'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      ELSE
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      END IF;
    ELSE
      target_type := base_type;
      target_status := 'available'::public.ims_stock_status;
      txn_type_v := base_txn;
    END IF;

    INSERT INTO public.ims_stock_items(
      oem, part_name, part_model_no, part_serial_no, warehouse_id,
      stock_type, stock_status, qty, transaction_ref, notes, created_by
    ) VALUES (
      oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, gr.warehouse_id,
      target_type, target_status, qty, ref, batch_v, gr.created_by
    ) RETURNING id INTO new_id;

    INSERT INTO public.ims_transactions(
      txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
      to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by, txn_date
    ) VALUES (
      txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
      gr.warehouse_id,
      COALESCE(gr.source_name, CASE gr.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
      qty, gr.indent_id, ref,
      'Backfilled from historical GRN', gr.created_by,
      COALESCE(gr.grn_date::timestamptz, gr.created_at)
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END $$;

-- ============================================================
-- Run backfill for ALL existing historical documents
-- ============================================================
DO $$
DECLARE
  r RECORD;
  total_dc int := 0;
  total_grn int := 0;
  n int;
BEGIN
  FOR r IN SELECT id FROM public.delivery_challans
           WHERE status IN ('Challan Generated','Submitted')
           ORDER BY created_at LOOP
    n := public.sync_dc_to_ims(r.id);
    total_dc := total_dc + n;
  END LOOP;

  FOR r IN SELECT id FROM public.grns
           WHERE status = 'Submitted'
           ORDER BY created_at LOOP
    n := public.sync_grn_to_ims(r.id);
    total_grn := total_grn + n;
  END LOOP;

  RAISE NOTICE 'IMS backfill complete — DC transactions created: %, GRN transactions created: %', total_dc, total_grn;
END $$;


-- =====================================================================
-- SOURCE: 20260721175918_a4190756-03ad-4ef7-87df-56eeb182a015.sql
-- =====================================================================

-- Part 1: admin_edit_grn_reverse — reverses stock for a Submitted GRN and flips it back to Draft
CREATE OR REPLACE FUNCTION public.admin_edit_grn_reverse(_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gr public.grns%ROWTYPE;
  ref TEXT;
  locked_count INT;
  invoice_hit INT;
  serials TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can edit submitted GRNs';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT * INTO gr FROM public.grns WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF gr.status <> 'Submitted' THEN
    RAISE EXCEPTION 'Only Submitted GRNs can be edited';
  END IF;

  ref := 'GRN ' || gr.grn_no;

  -- collect serials from this GRN's stock rows
  SELECT COALESCE(array_agg(part_serial_no) FILTER (WHERE part_serial_no IS NOT NULL), '{}')
    INTO serials
    FROM public.ims_stock_items WHERE transaction_ref = ref;

  -- invoice linkage guard
  IF array_length(serials, 1) > 0 THEN
    SELECT count(*) INTO invoice_hit
      FROM public.invoice_items
     WHERE serial_numbers && serials;
    IF invoice_hit > 0 THEN
      RAISE EXCEPTION 'Invoice exists. Create correction entry instead';
    END IF;
  END IF;

  -- downstream consumption guard
  SELECT count(*) INTO locked_count
    FROM public.ims_stock_items
   WHERE transaction_ref = ref
     AND stock_status NOT IN ('available'::public.ims_stock_status,
                              'scrapped'::public.ims_stock_status);
  IF locked_count > 0 THEN
    RAISE EXCEPTION 'Cannot edit GRN %: % stock item(s) already issued/reserved. Reverse those first.', gr.grn_no, locked_count;
  END IF;

  -- audit before reversal
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason,
     deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('grn_edit_reverse', gr.category, gr.grn_no, gr.id, _reason,
     auth.uid(), gr.created_by, gr.created_at, to_jsonb(gr));

  -- reverse
  DELETE FROM public.ims_transactions WHERE reference = ref;
  DELETE FROM public.ims_stock_items  WHERE transaction_ref = ref;

  -- flip back to Draft; re-posting handled by grn_post_inventory on next Submit
  UPDATE public.grns
     SET status = 'Draft',
         submitted_at = NULL,
         submitted_by = NULL,
         updated_at = now()
   WHERE id = _id;

  IF gr.indent_id IS NOT NULL THEN
    PERFORM public.recalc_indent_status(gr.indent_id);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_edit_grn_reverse(uuid, text) TO authenticated;

-- Part 2: admin_reopen_oracle
CREATE OR REPLACE FUNCTION public.admin_reopen_oracle(_indent_id uuid, _oracle_no text, _reason text, _scope text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ind public.indents%ROWTYPE;
  g RECORD;
  d RECORD;
  ref TEXT;
  serials TEXT[];
  invoice_hit INT;
  new_od JSONB;
  i INT;
  blk JSONB;
  found_blk BOOLEAN := false;
  locked_count INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can reopen an Oracle';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF _scope NOT IN ('grn','dc','full') THEN
    RAISE EXCEPTION 'Invalid scope. Use grn, dc, or full';
  END IF;

  SELECT * INTO ind FROM public.indents WHERE id = _indent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Indent not found'; END IF;

  -- Invoice guard across every GRN on this indent
  SELECT COALESCE(array_agg(DISTINCT s.part_serial_no) FILTER (WHERE s.part_serial_no IS NOT NULL), '{}')
    INTO serials
    FROM public.grns g2
    JOIN public.ims_stock_items s ON s.transaction_ref = 'GRN ' || g2.grn_no
   WHERE g2.indent_id = _indent_id;
  IF array_length(serials,1) > 0 THEN
    SELECT count(*) INTO invoice_hit FROM public.invoice_items WHERE serial_numbers && serials;
    IF invoice_hit > 0 THEN
      RAISE EXCEPTION 'Invoice exists. Use correction workflow';
    END IF;
  END IF;

  -- GRN reversal
  IF _scope IN ('grn','full') THEN
    FOR g IN
      SELECT * FROM public.grns
       WHERE indent_id = _indent_id AND status = 'Submitted'
    LOOP
      ref := 'GRN ' || g.grn_no;
      SELECT count(*) INTO locked_count
        FROM public.ims_stock_items
       WHERE transaction_ref = ref
         AND stock_status NOT IN ('available'::public.ims_stock_status,
                                  'scrapped'::public.ims_stock_status);
      IF locked_count > 0 THEN
        RAISE EXCEPTION 'Cannot reopen: GRN % has % consumed stock item(s)', g.grn_no, locked_count;
      END IF;

      INSERT INTO public.document_deletion_audit
        (document_type, document_subtype, document_no, document_id, reason,
         deleted_by, original_created_by, original_created_at, snapshot)
      VALUES
        ('grn_reopen', g.category, g.grn_no, g.id, _reason,
         auth.uid(), g.created_by, g.created_at, to_jsonb(g));

      DELETE FROM public.ims_transactions WHERE reference = ref;
      DELETE FROM public.ims_stock_items  WHERE transaction_ref = ref;

      UPDATE public.grns
         SET status = 'Draft',
             submitted_at = NULL,
             submitted_by = NULL,
             updated_at = now()
       WHERE id = g.id;
    END LOOP;
  END IF;

  -- DC reversal
  IF _scope IN ('dc','full') THEN
    FOR d IN
      SELECT * FROM public.delivery_challans
       WHERE indent_id = _indent_id
         AND status IN ('Challan Generated','Submitted')
    LOOP
      ref := 'DC ' || d.challan_no;

      INSERT INTO public.document_deletion_audit
        (document_type, document_subtype, document_no, document_id, reason,
         deleted_by, original_created_by, original_created_at, snapshot)
      VALUES
        ('dc_reopen', d.doc_type, d.challan_no, d.id, _reason,
         auth.uid(), d.created_by, d.created_at, to_jsonb(d));

      -- release stock back to available
      UPDATE public.ims_stock_items
         SET stock_status = 'available'::public.ims_stock_status,
             transaction_ref = NULL,
             updated_at = now()
       WHERE transaction_ref = ref
         AND stock_status IN ('issued'::public.ims_stock_status,
                              'returned_to_oem'::public.ims_stock_status,
                              'reserved'::public.ims_stock_status);

      DELETE FROM public.ims_transactions WHERE reference = ref;
      DELETE FROM public.ims_reservations WHERE reference = ref;

      UPDATE public.delivery_challans
         SET status = 'Draft', updated_at = now()
       WHERE id = d.id;
    END LOOP;
  END IF;

  -- Patch the oracle block with reopened flag
  new_od := COALESCE(ind.oracles_data, '[]'::jsonb);
  IF jsonb_typeof(new_od) = 'array' THEN
    FOR i IN 0..jsonb_array_length(new_od)-1 LOOP
      blk := new_od -> i;
      IF btrim(COALESCE(blk->>'oracle_no','')) = btrim(COALESCE(_oracle_no,'')) THEN
        blk := blk || jsonb_build_object('reopened', jsonb_build_object(
          'at', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSOF'),
          'by', auth.uid()::text,
          'reason', _reason,
          'scope', _scope
        ));
        new_od := jsonb_set(new_od, ARRAY[i::text], blk, false);
        found_blk := true;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.indents
     SET oracles_data = new_od,
         updated_at = now()
   WHERE id = _indent_id;

  PERFORM public.recalc_indent_status(_indent_id);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_reopen_oracle(uuid, text, text, text) TO authenticated;


-- =====================================================================
-- SOURCE: 20260721181023_ff9e9191-4f8d-4985-9d4f-5d0fc08f65cd.sql
-- =====================================================================
ALTER TABLE public.grns DROP CONSTRAINT grns_status_check;
ALTER TABLE public.grns ADD CONSTRAINT grns_status_check CHECK (status = ANY (ARRAY['Draft','Received','QC Pending','Approved','Rejected','Submitted','Cancelled']));

-- =====================================================================
-- SOURCE: 20260722041907_abc47914-03c9-45e4-80bb-eca8725d07fe.sql
-- =====================================================================

-- Company profile / master (single-row table for the operating company)
CREATE TABLE IF NOT EXISTS public.company_profile (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'PROKON HI-TECH SYSTEMS PVT. LTD.',
  regd_address TEXT NOT NULL DEFAULT 'Regd. Office: B-505, Picasso Centre, Sector-61, Gurgaon, Haryana',
  factory_address TEXT DEFAULT 'Factory: Plot 12, Industrial Area, Gurgaon',
  gstin TEXT DEFAULT '06AAACP1234A1Z5',
  phone TEXT DEFAULT '+91-124-0000000',
  email TEXT DEFAULT 'info@prokon.in',
  website TEXT DEFAULT 'www.prokon.in',
  logo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.company_profile TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.company_profile TO authenticated;
GRANT ALL ON public.company_profile TO service_role;

ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_profile_read_all" ON public.company_profile;
CREATE POLICY "company_profile_read_all" ON public.company_profile
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "company_profile_admin_write" ON public.company_profile;
CREATE POLICY "company_profile_admin_write" ON public.company_profile
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.company_profile_touch()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_company_profile_touch ON public.company_profile;
CREATE TRIGGER trg_company_profile_touch BEFORE UPDATE ON public.company_profile
FOR EACH ROW EXECUTE FUNCTION public.company_profile_touch();

-- Seed a single default row (only if empty)
INSERT INTO public.company_profile (name)
SELECT 'PROKON HI-TECH SYSTEMS PVT. LTD.'
WHERE NOT EXISTS (SELECT 1 FROM public.company_profile);


-- =====================================================================
-- SOURCE: 20260722091019_c34cfef2-bfcc-4720-95d2-e7a04db02ada.sql
-- =====================================================================
ALTER TABLE public.amcs ADD COLUMN IF NOT EXISTS bill_date date;
UPDATE public.amcs SET bill_date = start_date WHERE bill_date IS NULL;

-- =====================================================================
-- SOURCE: 20260723084450_640d7376-da59-47cf-9441-82ac55882635.sql
-- =====================================================================
DROP POLICY IF EXISTS "Owner or admin update delivery_challans" ON public.delivery_challans;
CREATE POLICY "Authenticated update delivery_challans"
  ON public.delivery_challans
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- =====================================================================
-- SOURCE: 20260725074138_d2a58db0-f942-4cf6-b339-cbd4cc4bab97.sql
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_tickets_status ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_status_created_at ON public.tickets(status, created_at DESC);

-- =====================================================================
-- SOURCE: 20260726124209_5a0040ba-542a-4bf5-8aa5-e731f9fd34b9.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.letterhead_settings (
  document_type TEXT PRIMARY KEY CHECK (document_type IN ('quotation','sales_order','delivery_challan','pi','invoice')),
  use_letterhead BOOLEAN NOT NULL DEFAULT true,
  show_supply_from BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.letterhead_settings TO authenticated;
GRANT ALL ON public.letterhead_settings TO service_role;

ALTER TABLE public.letterhead_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "letterhead_settings read" ON public.letterhead_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "letterhead_settings write" ON public.letterhead_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.letterhead_settings (document_type, use_letterhead, show_supply_from) VALUES
  ('quotation', true, false),
  ('sales_order', true, false),
  ('delivery_challan', true, false),
  ('pi', true, false),
  ('invoice', true, false)
ON CONFLICT (document_type) DO NOTHING;


-- =====================================================================
-- SOURCE: 20260726172434_705e4984-3e8a-46c9-b128-82b2c1ae37c9.sql
-- =====================================================================

ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS sales_office_address text,
  ADD COLUMN IF NOT EXISTS registered_office_address text,
  ADD COLUMN IF NOT EXISTS accent_color text DEFAULT '#1f3864',
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text,
  ADD COLUMN IF NOT EXISTS bank_branch text;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS delivery_terms text;


-- =====================================================================
-- SOURCE: 20260726184128_6b382c4f-7d05-451e-9c51-3adae2592601.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_quote_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  d date := COALESCE(NEW.quote_date, CURRENT_DATE);
  start_yr int;
  end_yr int;
  fy text;
  seq int;
  candidate text;
BEGIN
  IF NEW.quote_no IS NULL OR NEW.quote_no = '' THEN
    IF EXTRACT(MONTH FROM d) >= 4 THEN
      start_yr := EXTRACT(YEAR FROM d)::int;
    ELSE
      start_yr := EXTRACT(YEAR FROM d)::int - 1;
    END IF;
    end_yr := start_yr + 1;
    fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

    -- Serialize quote-number allocation per FY to avoid race duplicates
    PERFORM pg_advisory_xact_lock(hashtextextended('quotations_quote_no:' || fy, 0));

    SELECT COALESCE(MAX(CAST(split_part(quote_no,'/',3) AS int)),0)+1 INTO seq
      FROM public.quotations WHERE quote_no LIKE 'PHS/'||fy||'/%';

    candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');

    -- Defensive: skip any already-taken numbers (in case of manual entries)
    WHILE EXISTS (SELECT 1 FROM public.quotations WHERE quote_no = candidate) LOOP
      seq := seq + 1;
      candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');
    END LOOP;

    NEW.quote_no := candidate;
  END IF;
  RETURN NEW;
END $function$;

-- =====================================================================
-- SOURCE: 20260727070106_896ca3cf-55ac-4ec6-994f-d7f36e906955.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.set_quote_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d date := COALESCE(NEW.quote_date, CURRENT_DATE);
  start_yr int;
  end_yr int;
  fy text;
  seq int;
  candidate text;
BEGIN
  IF NEW.quote_no IS NULL OR NEW.quote_no = '' THEN
    IF EXTRACT(MONTH FROM d) >= 4 THEN
      start_yr := EXTRACT(YEAR FROM d)::int;
    ELSE
      start_yr := EXTRACT(YEAR FROM d)::int - 1;
    END IF;
    end_yr := start_yr + 1;
    fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

    -- Serialize allocation for the financial year and bypass per-user RLS visibility.
    PERFORM pg_advisory_xact_lock(hashtextextended('quotations_quote_no:' || fy, 0));

    SELECT COALESCE(MAX((regexp_match(quote_no, '^PHS/' || fy || '/([0-9]+)$'))[1]::int), 0) + 1
      INTO seq
      FROM public.quotations
     WHERE quote_no ~ ('^PHS/' || fy || '/[0-9]+$');

    candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');

    WHILE EXISTS (SELECT 1 FROM public.quotations WHERE quote_no = candidate) LOOP
      seq := seq + 1;
      candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');
    END LOOP;

    NEW.quote_no := candidate;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.set_quote_no() FROM PUBLIC;

DROP POLICY IF EXISTS "own q insert" ON public.quotations;
DROP POLICY IF EXISTS "own q select" ON public.quotations;
DROP POLICY IF EXISTS "own q update" ON public.quotations;
DROP POLICY IF EXISTS "own q delete" ON public.quotations;
DROP POLICY IF EXISTS "quotations_insert_own_with_permission" ON public.quotations;
DROP POLICY IF EXISTS "quotations_select_with_permission" ON public.quotations;
DROP POLICY IF EXISTS "quotations_update_own_with_permission" ON public.quotations;
DROP POLICY IF EXISTS "quotations_delete_own_with_permission" ON public.quotations;

CREATE POLICY "quotations_insert_own_with_permission"
ON public.quotations
FOR INSERT
TO authenticated
WITH CHECK (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'create')
);

CREATE POLICY "quotations_select_with_permission"
ON public.quotations
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR public.has_permission(auth.uid(), 'quotations', 'read')
);

CREATE POLICY "quotations_update_own_with_permission"
ON public.quotations
FOR UPDATE
TO authenticated
USING (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'edit')
)
WITH CHECK (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'edit')
);

CREATE POLICY "quotations_delete_own_with_permission"
ON public.quotations
FOR DELETE
TO authenticated
USING (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'delete')
);

-- =====================================================================
-- SOURCE: 20260727070315_ddace67f-65db-425c-888c-10c68c2711df.sql
-- =====================================================================
DROP POLICY IF EXISTS "quotations_insert_own_with_permission" ON public.quotations;

CREATE POLICY "quotations_insert_own_with_permission"
ON public.quotations
FOR INSERT
TO authenticated
WITH CHECK (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'access')
);

-- =====================================================================
-- SOURCE: 20260727070400_b9364ecc-0007-4b8e-90aa-cbb2add8f0a2.sql
-- =====================================================================
REVOKE ALL ON FUNCTION public.set_quote_no() FROM anon;
REVOKE ALL ON FUNCTION public.set_quote_no() FROM authenticated;
REVOKE ALL ON FUNCTION public.set_quote_no() FROM service_role;

-- =====================================================================
-- SOURCE: 20260727073210_9b4d9772-f9d3-4b72-be8b-5bbc2f91fc56.sql
-- =====================================================================
GRANT SELECT ON public.crm_settings TO authenticated;
GRANT ALL ON public.crm_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_terms_templates TO authenticated;
GRANT ALL ON public.quote_terms_templates TO service_role;

-- =====================================================================
-- SOURCE: 20260731071021_09e7030c-3a3a-49cc-b197-a538ca23fafb.sql
-- =====================================================================
ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS asp_code text,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_warehouses_branch_id ON public.warehouses(branch_id);

-- =====================================================================
-- SOURCE: 20260731073842_03e3b2d9-b7f5-4333-bb83-9f0a0aadfdb8.sql
-- =====================================================================
CREATE TABLE public.defective_tag_sequence (
  fy text PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);
GRANT SELECT ON public.defective_tag_sequence TO authenticated;
GRANT ALL ON public.defective_tag_sequence TO service_role;
ALTER TABLE public.defective_tag_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read defective tag sequence" ON public.defective_tag_sequence FOR SELECT TO authenticated USING (true);

CREATE TABLE public.defective_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_no text,
  tag_date date NOT NULL DEFAULT CURRENT_DATE,
  txn_id uuid NOT NULL REFERENCES public.ims_transactions(id) ON DELETE CASCADE,
  txn_no text,
  txn_date date,
  service_request_no text,
  oracle_order_no text,
  model_no text,
  serial_no text,
  customer_name text,
  asp_code text,
  engineer_name text,
  replacement_date date,
  replacement_count integer NOT NULL DEFAULT 1,
  reason text,
  warehouse_id uuid REFERENCES public.warehouses(id),
  status text NOT NULL DEFAULT 'generated',
  printed_at timestamptz,
  printed_by text,
  print_count integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX defective_tags_txn_id_key ON public.defective_tags(txn_id);
CREATE UNIQUE INDEX defective_tags_tag_no_key ON public.defective_tags(tag_no);
CREATE INDEX defective_tags_tag_date_idx ON public.defective_tags(tag_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defective_tags TO authenticated;
GRANT ALL ON public.defective_tags TO service_role;
ALTER TABLE public.defective_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view defective tags" ON public.defective_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can create defective tags" ON public.defective_tags FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update defective tags" ON public.defective_tags FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can delete defective tags" ON public.defective_tags FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_defective_tag_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date := COALESCE(NEW.tag_date, CURRENT_DATE);
  y int := CASE WHEN EXTRACT(MONTH FROM d) >= 4 THEN EXTRACT(YEAR FROM d) ELSE EXTRACT(YEAR FROM d) - 1 END;
  fy_key text := y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  n int;
BEGIN
  IF NEW.tag_no IS NOT NULL AND NEW.tag_no <> '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('defective_tag_seq_' || fy_key));
  INSERT INTO public.defective_tag_sequence(fy, last_no) VALUES (fy_key, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = public.defective_tag_sequence.last_no + 1
  RETURNING last_no INTO n;
  NEW.tag_no := 'DT/' || fy_key || '/' || lpad(n::text, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_defective_tag_no
BEFORE INSERT ON public.defective_tags
FOR EACH ROW EXECUTE FUNCTION public.set_defective_tag_no();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_defective_tags_updated_at
BEFORE UPDATE ON public.defective_tags
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- SOURCE: 20260731120743_6419c0b8-fdff-4a80-a743-09a824f522cb.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_delete_challan(_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  dc public.delivery_challans%ROWTYPE;
  ref TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete Delivery Challans';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for deletion';
  END IF;

  SELECT * INTO dc FROM public.delivery_challans WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery Challan not found'; END IF;

  ref := 'DC ' || dc.challan_no;

  -- Remove reservations tied to stock touched by this DC (no reference column here)
  DELETE FROM public.ims_reservations r
   WHERE r.stock_item_id IN (
     SELECT s.id FROM public.ims_stock_items s WHERE s.transaction_ref = ref
   );

  -- Reverse stock statuses touched by this DC
  UPDATE public.ims_stock_items
     SET stock_status = 'available'::public.ims_stock_status,
         transaction_ref = NULL,
         updated_at = now()
   WHERE transaction_ref = ref
     AND stock_status IN ('issued'::public.ims_stock_status,
                          'returned_to_oem'::public.ims_stock_status,
                          'reserved'::public.ims_stock_status);

  -- Remove ledger entries tied to this DC
  DELETE FROM public.ims_transactions WHERE reference = ref;

  -- Audit
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason,
     deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('delivery_challan', dc.doc_type, dc.challan_no, dc.id, _reason,
     auth.uid(), dc.created_by, dc.created_at, to_jsonb(dc));

  DELETE FROM public.delivery_challans WHERE id = _id;
END $function$;

-- =====================================================================
-- SOURCE: 20260802164925_517d0615-98ec-4a2c-b333-a9dc849c25b6.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.grn_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  cond TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  new_id UUID;
  base_type public.ims_stock_type;
  base_txn public.ims_txn_type;
BEGIN
  IF NEW.category = 'customer' THEN
    base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
  ELSIF NEW.category = 'oem' THEN
    base_type := 'good'::public.ims_stock_type;      base_txn := 'good_in'::public.ims_txn_type;
  ELSE
    IF COALESCE(NEW.stock_category,'good') = 'defective' THEN
      base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
    ELSE
      base_type := 'good'::public.ims_stock_type;      base_txn := 'good_in'::public.ims_txn_type;
    END IF;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      cond       := lower(btrim(COALESCE(it->>'condition','')));
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      IF NEW.category = 'customer' THEN
        -- Unchanged: Customer GRNs treat a blank/unknown condition as Defective.
        IF cond = 'good' THEN
          target_type := 'good'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'good_in'::public.ims_txn_type;
        ELSIF cond = 'scrap' THEN
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'scrapped'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        ELSE
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        END IF;
      ELSE
        -- General / OEM: classify per line item from its own condition.
        IF cond = 'good' THEN
          target_type := 'good'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'good_in'::public.ims_txn_type;
        ELSIF cond = 'scrap' THEN
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'scrapped'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        ELSIF cond = 'defective' THEN
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        ELSE
          -- No per-item condition: fall back to the header/category default.
          target_type := base_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := base_txn;
        END IF;
      END IF;

      INSERT INTO public.ims_stock_items(
        oem, part_name, part_model_no, part_serial_no, warehouse_id,
        stock_type, stock_status, qty, transaction_ref, notes, created_by
      ) VALUES (
        oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, NEW.warehouse_id,
        target_type, target_status, qty, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
      ) RETURNING id INTO new_id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
        NEW.warehouse_id,
        COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
        qty, NEW.indent_id, 'GRN ' || NEW.grn_no,
        'Auto-posted from GRN submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available'::public.ims_stock_status;

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment'::public.ims_txn_type, 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $function$;

-- =====================================================================
-- SOURCE: 20260803105655_2a7163bc-5e44-4d36-ad7b-a3d1e01a06e0.sql
-- =====================================================================
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS closed_remarks text,
  ADD COLUMN IF NOT EXISTS lost_reason text;

-- =====================================================================
-- SOURCE: 20260803110447_7ea0b930-baee-48d0-9a95-52ea78ec974c.sql
-- =====================================================================
DROP POLICY IF EXISTS "own act select" ON public.lead_activities;

CREATE POLICY "lead act select owner assignee or admin"
ON public.lead_activities
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_activities.lead_id
      AND (l.owner_id = auth.uid() OR l.assigned_to = auth.uid())
  )
);

-- =====================================================================
-- SOURCE: 20260803122104_45391fa9-94e0-4348-a347-a4493f21bb58.sql
-- =====================================================================
DELETE FROM public.customers WHERE company = 'Zeta Test Industries' AND email = 'ravi@zetatest.in';

-- =====================================================================
-- SOURCE: 20260803130516_13dadd82-0a90-4319-b0f8-c9b465459967.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.is_designated_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND lower(u.email) IN ('gaurav@prokonhitech.com', 'prokonerp@gmail.com')
  );
$$;

REVOKE ALL ON FUNCTION public.is_designated_owner() FROM public;
GRANT EXECUTE ON FUNCTION public.is_designated_owner() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  IF NOT public.is_designated_owner() THEN
    RAISE EXCEPTION 'Contact your workspace owner to be granted admin access.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'An admin already exists. Ask an existing admin to grant you access.';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'admin')
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.claim_admin() TO authenticated;

-- =====================================================================
-- SOURCE: 20260805064635_e08a1da2-9256-4dd5-9b88-6c2fd323aaec.sql
-- =====================================================================
ALTER TABLE public.defective_tags ALTER COLUMN txn_id DROP NOT NULL;
ALTER TABLE public.defective_tags ADD COLUMN IF NOT EXISTS stock_item_id uuid REFERENCES public.ims_stock_items(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS defective_tags_stock_item_id_key ON public.defective_tags (stock_item_id);

-- =====================================================================
-- SOURCE: 20260806100801_4527b181-ff10-4ef1-a08b-ff2489e86705.sql
-- =====================================================================
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_increment_date DATE,
  ADD COLUMN IF NOT EXISTS increment_cycle_months INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS exit_date DATE;

CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  code TEXT NOT NULL DEFAULT 'P',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view attendance" ON public.attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins attendance" ON public.attendance FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd attendance" ON public.attendance FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin del attendance" ON public.attendance FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS attendance_emp_date_idx ON public.attendance (employee_id, work_date);
CREATE TRIGGER attendance_touch BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.employee_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  period_year INTEGER,
  period_month INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_advances TO authenticated;
GRANT ALL ON public.employee_advances TO service_role;
ALTER TABLE public.employee_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view advances" ON public.employee_advances FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins advances" ON public.employee_advances FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd advances" ON public.employee_advances FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin del advances" ON public.employee_advances FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS advances_emp_period_idx ON public.employee_advances (employee_id, period_year, period_month);
CREATE TRIGGER advances_touch BEFORE UPDATE ON public.employee_advances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.salary_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  days_in_month INTEGER NOT NULL,
  monthly_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  per_day_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  working_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  total_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  advance NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_year, period_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_records TO authenticated;
GRANT ALL ON public.salary_records TO service_role;
ALTER TABLE public.salary_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view salary" ON public.salary_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins salary" ON public.salary_records FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd salary" ON public.salary_records FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin del salary" ON public.salary_records FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin') AND status <> 'paid');
CREATE TRIGGER salary_touch BEFORE UPDATE ON public.salary_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- SOURCE: 20260806104206_903db2e8-5cb9-4e36-892b-8e6299f1da04.sql
-- =====================================================================
ALTER TABLE public.employee_advances
  ADD COLUMN IF NOT EXISTS emi_months integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS emi_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_months integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS start_year integer,
  ADD COLUMN IF NOT EXISTS start_month integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

UPDATE public.employee_advances
SET emi_months = 1,
    emi_amount = COALESCE(amount, 0),
    remaining_months = 0,
    start_year = COALESCE(start_year, period_year, EXTRACT(YEAR FROM advance_date)::int),
    start_month = COALESCE(start_month, period_month, EXTRACT(MONTH FROM advance_date)::int),
    status = 'closed'
WHERE emi_amount = 0;

ALTER TABLE public.salary_records
  ADD COLUMN IF NOT EXISTS present_days numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_leave_benefit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_days numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_salary numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emi_deduction numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emi_carry_forward numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS override_paid_days numeric,
  ADD COLUMN IF NOT EXISTS override_emi numeric,
  ADD COLUMN IF NOT EXISTS override_net numeric;

-- =====================================================================
-- SOURCE: 20260806104929_f8abd1c1-f20b-47ff-939f-fb35e95a201f.sql
-- =====================================================================
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS work_hours numeric,
  ADD COLUMN IF NOT EXISTS day_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_sunday boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

UPDATE public.attendance
SET day_value = CASE code WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END,
    is_sunday = (EXTRACT(DOW FROM work_date) = 0)
WHERE day_value = 0;

CREATE TABLE IF NOT EXISTS public.attendance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  action text NOT NULL,
  old_code text,
  old_hours numeric,
  old_day_value numeric,
  new_code text,
  new_hours numeric,
  new_day_value numeric,
  changed_by uuid,
  changed_by_email text,
  undone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_audit_batch_idx ON public.attendance_audit(batch_id);
CREATE INDEX IF NOT EXISTS attendance_audit_date_idx ON public.attendance_audit(work_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_audit TO authenticated;
GRANT ALL ON public.attendance_audit TO service_role;
ALTER TABLE public.attendance_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_audit_select" ON public.attendance_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "attendance_audit_insert" ON public.attendance_audit FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "attendance_audit_update" ON public.attendance_audit FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "attendance_audit_delete" ON public.attendance_audit FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.attendance_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year int NOT NULL,
  period_month int NOT NULL,
  locked boolean NOT NULL DEFAULT true,
  locked_by uuid,
  locked_by_email text,
  locked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_year, period_month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_locks TO authenticated;
GRANT ALL ON public.attendance_locks TO service_role;
ALTER TABLE public.attendance_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_locks_select" ON public.attendance_locks FOR SELECT TO authenticated USING (true);
CREATE POLICY "attendance_locks_insert" ON public.attendance_locks FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "attendance_locks_update" ON public.attendance_locks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "attendance_locks_delete" ON public.attendance_locks FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER attendance_locks_touch BEFORE UPDATE ON public.attendance_locks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- SOURCE: 20260806113418_0fe7a41c-218b-415a-9975-93a2c01de19e.sql
-- =====================================================================
ALTER TABLE public.employee_advances
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_installments integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.advance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id uuid NOT NULL REFERENCES public.employee_advances(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_year integer NOT NULL,
  period_month integer NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'emi',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (advance_id, period_year, period_month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advance_payments TO authenticated;
GRANT ALL ON public.advance_payments TO service_role;

ALTER TABLE public.advance_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advance_payments_select" ON public.advance_payments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "advance_payments_insert" ON public.advance_payments
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "advance_payments_update" ON public.advance_payments
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "advance_payments_delete" ON public.advance_payments
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER advance_payments_touch BEFORE UPDATE ON public.advance_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- SOURCE: 20260807043621_535e7516-ccfb-41b1-8106-36e73af1fea8.sql
-- =====================================================================
ALTER TABLE public.ims_stock_items
  ADD CONSTRAINT ims_stock_items_serial_qty_one
  CHECK (part_serial_no IS NULL OR qty = 1);

CREATE OR REPLACE FUNCTION public.grn_post_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  cond TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  new_id UUID;
  base_type public.ims_stock_type;
  base_txn public.ims_txn_type;
  serial_list TEXT[];
  s TEXT;
  remainder NUMERIC;
BEGIN
  IF NEW.category = 'customer' THEN
    base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
  ELSIF NEW.category = 'oem' THEN
    base_type := 'good'::public.ims_stock_type;      base_txn := 'good_in'::public.ims_txn_type;
  ELSE
    IF COALESCE(NEW.stock_category,'good') = 'defective' THEN
      base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
    ELSE
      base_type := 'good'::public.ims_stock_type;      base_txn := 'good_in'::public.ims_txn_type;
    END IF;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      cond       := lower(btrim(COALESCE(it->>'condition','')));
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      IF NEW.category = 'customer' THEN
        IF cond = 'good' THEN
          target_type := 'good'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'good_in'::public.ims_txn_type;
        ELSIF cond = 'scrap' THEN
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'scrapped'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        ELSE
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        END IF;
      ELSE
        IF cond = 'good' THEN
          target_type := 'good'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'good_in'::public.ims_txn_type;
        ELSIF cond = 'scrap' THEN
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'scrapped'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        ELSIF cond = 'defective' THEN
          target_type := 'defective'::public.ims_stock_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := 'defective_in'::public.ims_txn_type;
        ELSE
          target_type := base_type;
          target_status := 'available'::public.ims_stock_status;
          txn_type_v := base_txn;
        END IF;
      END IF;

      -- Build the serial list: prefer an explicit serials[] array, else split a
      -- legacy comma-joined serial string. One stock row per serial, qty = 1.
      IF jsonb_typeof(it->'serials') = 'array' THEN
        SELECT array_agg(btrim(x)) INTO serial_list
        FROM jsonb_array_elements_text(it->'serials') AS x
        WHERE btrim(x) <> '';
      ELSIF serial IS NOT NULL THEN
        SELECT array_agg(btrim(x)) INTO serial_list
        FROM unnest(string_to_array(serial, ',')) AS x
        WHERE btrim(x) <> '';
      ELSE
        serial_list := NULL;
      END IF;

      IF serial_list IS NOT NULL AND array_length(serial_list, 1) > 0 THEN
        FOREACH s IN ARRAY serial_list LOOP
          INSERT INTO public.ims_stock_items(
            oem, part_name, part_model_no, part_serial_no, warehouse_id,
            stock_type, stock_status, qty, transaction_ref, notes, created_by
          ) VALUES (
            oem_v, COALESCE(part_name_v,'(unnamed)'), model, s, NEW.warehouse_id,
            target_type, target_status, 1, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
          ) RETURNING id INTO new_id;

          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
          ) VALUES (
            txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, s, oem_v,
            NEW.warehouse_id,
            COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
            1, NEW.indent_id, 'GRN ' || NEW.grn_no,
            'Auto-posted from GRN submission', NEW.created_by
          );
        END LOOP;

        remainder := qty - array_length(serial_list, 1);
      ELSE
        remainder := qty;
      END IF;

      IF remainder > 0 THEN
        INSERT INTO public.ims_stock_items(
          oem, part_name, part_model_no, part_serial_no, warehouse_id,
          stock_type, stock_status, qty, transaction_ref, notes, created_by
        ) VALUES (
          oem_v, COALESCE(part_name_v,'(unnamed)'), model, NULL, NEW.warehouse_id,
          target_type, target_status, remainder, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
        ) RETURNING id INTO new_id;

        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
        ) VALUES (
          txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, NULL, oem_v,
          NEW.warehouse_id,
          COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
          remainder, NEW.indent_id, 'GRN ' || NEW.grn_no,
          'Auto-posted from GRN submission', NEW.created_by
        );
      END IF;
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available'::public.ims_stock_status;

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment'::public.ims_txn_type, 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END
$fn$;

-- =====================================================================
-- SOURCE: 20260807100221_1b3ca954-1201-49ff-82fd-eb5cef4b730d.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  item_stock_type TEXT;
  is_posting_new BOOLEAN;
  was_posting_old BOOLEAN;
BEGIN
  IF NEW.doc_type NOT IN ('customer','oem') THEN RETURN NEW; END IF;

  is_posting_new  := NEW.status IN ('Challan Generated','Submitted');
  was_posting_old := TG_OP = 'UPDATE' AND OLD.status IN ('Challan Generated','Submitted');

  IF is_posting_new AND (TG_OP = 'INSERT' OR NOT was_posting_old) THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      -- Per-item stock type: customers always receive Good stock;
      -- OEM DCs honour each line item's own Stock Type selection.
      IF NEW.doc_type = 'customer' THEN
        target_type := 'good'::public.ims_stock_type;
      ELSE
        item_stock_type := lower(btrim(COALESCE(it->>'stock_type','')));
        IF item_stock_type LIKE 'defect%' THEN
          target_type := 'defective'::public.ims_stock_type;
        ELSIF item_stock_type LIKE 'good%' THEN
          target_type := 'good'::public.ims_stock_type;
        ELSE
          target_type := 'defective'::public.ims_stock_type; -- legacy default
        END IF;
      END IF;

      txn_type_v := CASE WHEN target_type = 'good'::public.ims_stock_type
                         THEN 'good_out'::public.ims_txn_type
                         ELSE 'defective_out'::public.ims_txn_type END;

      stock_row := NULL;
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot post DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = CASE WHEN NEW.doc_type='oem' THEN 'returned_to_oem'::public.ims_stock_status ELSE 'issued'::public.ims_stock_status END,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial, COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND was_posting_old AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status);
  END IF;

  RETURN NEW;
END $function$;

-- =====================================================================
-- SOURCE: 20260807115131_4e54748e-b18e-417d-8212-51a04e3d9ce8.sql
-- =====================================================================
-- 1. Item type on products
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'product';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_item_type_chk') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_item_type_chk CHECK (item_type IN ('product','service'));
  END IF;
END $$;

UPDATE public.products
   SET item_type = 'service'
 WHERE name ILIKE '%freight%' OR name ILIKE '%installation charge%';

-- 2. FIFO quantity deduction helper for non-serialised stock
CREATE OR REPLACE FUNCTION public.ims_deduct_qty(
  _model text,
  _warehouse uuid,
  _stock_type public.ims_stock_type,
  _qty numeric,
  _ref text,
  _new_status public.ims_stock_status,
  _doc_label text DEFAULT 'document'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  remaining numeric := _qty;
  take numeric;
  avail numeric;
  r public.ims_stock_items%ROWTYPE;
  first_id uuid;
BEGIN
  IF _model IS NULL OR _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(qty),0) INTO avail
    FROM public.ims_stock_items
   WHERE part_model_no = _model
     AND stock_type = _stock_type
     AND stock_status = 'available'::public.ims_stock_status
     AND (_warehouse IS NULL OR warehouse_id = _warehouse);

  IF avail < _qty THEN
    RAISE EXCEPTION 'Cannot post %: only % unit(s) of "%" available in % stock, % requested',
      _doc_label, avail, _model, _stock_type, _qty;
  END IF;

  FOR r IN
    SELECT * FROM public.ims_stock_items
     WHERE part_model_no = _model
       AND stock_type = _stock_type
       AND stock_status = 'available'::public.ims_stock_status
       AND (_warehouse IS NULL OR warehouse_id = _warehouse)
     ORDER BY created_at ASC, id ASC
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(r.qty, remaining);

    IF take >= r.qty THEN
      UPDATE public.ims_stock_items
         SET stock_status = _new_status,
             transaction_ref = COALESCE(_ref, transaction_ref),
             updated_at = now()
       WHERE id = r.id;
      first_id := COALESCE(first_id, r.id);
    ELSE
      UPDATE public.ims_stock_items
         SET qty = r.qty - take, updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.ims_stock_items(
        oem, category, part_name, part_model_no, part_serial_no,
        warehouse_id, warehouse_type, stock_type, stock_status, qty,
        transaction_ref, notes, created_by
      ) VALUES (
        r.oem, r.category, r.part_name, r.part_model_no, NULL,
        r.warehouse_id, r.warehouse_type, r.stock_type, _new_status, take,
        _ref, 'Quantity split from pooled stock', r.created_by
      ) RETURNING id INTO first_id;
    END IF;

    remaining := remaining - take;
  END LOOP;

  RETURN first_id;
END $$;

REVOKE ALL ON FUNCTION public.ims_deduct_qty(text, uuid, public.ims_stock_type, numeric, text, public.ims_stock_status, text) FROM public, anon;

-- Add quantity into a warehouse pool (used by transfer receipt)
CREATE OR REPLACE FUNCTION public.ims_add_qty(
  _model text,
  _warehouse uuid,
  _stock_type public.ims_stock_type,
  _qty numeric,
  _part_name text,
  _oem text,
  _ref text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target uuid;
BEGIN
  IF _model IS NULL OR _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO target
    FROM public.ims_stock_items
   WHERE part_model_no = _model
     AND stock_type = _stock_type
     AND stock_status = 'available'::public.ims_stock_status
     AND part_serial_no IS NULL
     AND warehouse_id IS NOT DISTINCT FROM _warehouse
   ORDER BY created_at ASC LIMIT 1;

  IF target IS NOT NULL THEN
    UPDATE public.ims_stock_items
       SET qty = qty + _qty, updated_at = now()
     WHERE id = target;
    RETURN target;
  END IF;

  INSERT INTO public.ims_stock_items(
    oem, part_name, part_model_no, part_serial_no, warehouse_id,
    stock_type, stock_status, qty, transaction_ref, notes
  ) VALUES (
    _oem, COALESCE(_part_name, _model), _model, NULL, _warehouse,
    _stock_type, 'available'::public.ims_stock_status, _qty, _ref,
    'Quantity received into warehouse pool'
  ) RETURNING id INTO target;

  RETURN target;
END $$;

REVOKE ALL ON FUNCTION public.ims_add_qty(text, uuid, public.ims_stock_type, numeric, text, text, text) FROM public, anon;

-- 3. Delivery Challan: handle non-serial quantity deduction
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  item_stock_type TEXT;
  is_posting_new BOOLEAN;
  was_posting_old BOOLEAN;
  out_status public.ims_stock_status;
  pooled_id UUID;
  is_service BOOLEAN;
BEGIN
  IF NEW.doc_type NOT IN ('customer','oem') THEN RETURN NEW; END IF;

  is_posting_new  := NEW.status IN ('Challan Generated','Submitted');
  was_posting_old := TG_OP = 'UPDATE' AND OLD.status IN ('Challan Generated','Submitted');

  IF is_posting_new AND (TG_OP = 'INSERT' OR NOT was_posting_old) THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      -- Services never touch inventory
      is_service := FALSE;
      IF NULLIF(it->>'product_id','') IS NOT NULL THEN
        SELECT (item_type = 'service') INTO is_service
          FROM public.products WHERE id = (it->>'product_id')::uuid;
      END IF;
      IF COALESCE(is_service, FALSE) THEN CONTINUE; END IF;

      IF NEW.doc_type = 'customer' THEN
        target_type := 'good'::public.ims_stock_type;
      ELSE
        item_stock_type := lower(btrim(COALESCE(it->>'stock_type','')));
        IF item_stock_type LIKE 'defect%' THEN
          target_type := 'defective'::public.ims_stock_type;
        ELSIF item_stock_type LIKE 'good%' THEN
          target_type := 'good'::public.ims_stock_type;
        ELSE
          target_type := 'defective'::public.ims_stock_type; -- legacy default
        END IF;
      END IF;

      txn_type_v := CASE WHEN target_type = 'good'::public.ims_stock_type
                         THEN 'good_out'::public.ims_txn_type
                         ELSE 'defective_out'::public.ims_txn_type END;

      out_status := CASE WHEN NEW.doc_type = 'oem'
                         THEN 'returned_to_oem'::public.ims_stock_status
                         ELSE 'issued'::public.ims_stock_status END;

      stock_row := NULL;
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot post DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = out_status,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;
      ELSIF model IS NOT NULL THEN
        -- Quantity-tracked (non-serial) product: deduct FIFO from the pool
        pooled_id := public.ims_deduct_qty(
          model, NULL, target_type, qty,
          'DC ' || COALESCE(NEW.challan_no,''), out_status,
          'DC ' || COALESCE(NEW.challan_no,'')
        );
        IF pooled_id IS NOT NULL THEN
          SELECT * INTO stock_row FROM public.ims_stock_items WHERE id = pooled_id;
        END IF;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial, COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND was_posting_old AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status);
  END IF;

  RETURN NEW;
END $function$;

-- 4. Stock transfer: non-serial quantity movement
CREATE OR REPLACE FUNCTION public.ims_transfer_status_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  linked_id UUID := NEW.stock_item_id;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('in_transit','completed') THEN

    IF linked_id IS NULL AND NEW.part_serial_no IS NOT NULL THEN
      SELECT id INTO linked_id
        FROM public.ims_stock_items
       WHERE part_serial_no = NEW.part_serial_no
         AND (NEW.source_warehouse_id IS NULL OR warehouse_id = NEW.source_warehouse_id)
       LIMIT 1;
      IF linked_id IS NOT NULL THEN
        NEW.stock_item_id := linked_id;
      END IF;
    END IF;

    IF NEW.status = 'in_transit' THEN
      IF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET stock_status = 'in_transit', updated_at = now()
         WHERE id = linked_id;
      ELSIF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        linked_id := public.ims_deduct_qty(
          NEW.part_model_no, NEW.source_warehouse_id, NEW.stock_type, NEW.qty,
          COALESCE(NEW.transfer_no,'Transfer'), 'in_transit'::public.ims_stock_status,
          'Transfer ' || COALESCE(NEW.transfer_no,'')
        );
        NEW.stock_item_id := linked_id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
      ) VALUES (
        'transfer_out', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
        NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
        'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
      );

    ELSIF NEW.status = 'completed' THEN
      IF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        -- Remove the in-transit pooled slice and add it at the destination
        IF linked_id IS NOT NULL THEN
          DELETE FROM public.ims_stock_items WHERE id = linked_id;
        END IF;
        linked_id := public.ims_add_qty(
          NEW.part_model_no, NEW.destination_warehouse_id, NEW.stock_type, NEW.qty,
          NEW.part_name, NEW.oem, COALESCE(NEW.transfer_no,'Transfer')
        );
        NEW.stock_item_id := linked_id;
      ELSIF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET warehouse_id  = NEW.destination_warehouse_id,
               stock_status  = 'available',
               updated_at    = now()
         WHERE id = linked_id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
      ) VALUES (
        'transfer_in', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
        NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
        'Transfer received', NEW.received_by
      );
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 5. Invoice items: non-serial quantity deduction
CREATE OR REPLACE FUNCTION public.invoice_item_sync_serials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  removed TEXT[];
  added TEXT[];
  p_model TEXT;
  p_item_type TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.serial_numbers IS NOT NULL AND array_length(NEW.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(NEW.serial_numbers)
         AND stock_status = 'available';
    ELSIF NEW.product_id IS NOT NULL AND COALESCE(NEW.qty,0) > 0 THEN
      SELECT model, item_type INTO p_model, p_item_type
        FROM public.products WHERE id = NEW.product_id;
      IF COALESCE(p_item_type,'product') <> 'service' AND p_model IS NOT NULL THEN
        PERFORM public.ims_deduct_qty(
          p_model, NEW.warehouse_id, 'good'::public.ims_stock_type, NEW.qty,
          'Invoice item', 'issued'::public.ims_stock_status, 'invoice'
        );
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    removed := ARRAY(SELECT unnest(COALESCE(OLD.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(NEW.serial_numbers,'{}')));
    added   := ARRAY(SELECT unnest(COALESCE(NEW.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(OLD.serial_numbers,'{}')));
    IF array_length(removed,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(removed)
         AND stock_status = 'issued';
    END IF;
    IF array_length(added,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(added)
         AND stock_status = 'available';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.serial_numbers IS NOT NULL AND array_length(OLD.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(OLD.serial_numbers)
         AND stock_status = 'issued';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- =====================================================================
-- SOURCE: 20260807180120_c7684f6f-273b-45dc-85bc-3acc19cda407.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.grn_post_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  cond TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  new_id UUID;
  serial_list TEXT[];
  s TEXT;
  remainder NUMERIC;
BEGIN
  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      cond       := lower(btrim(COALESCE(it->>'condition','')));
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      IF cond NOT IN ('good','defective','scrap') THEN
        RAISE EXCEPTION 'GRN %: line item "%" has an invalid or missing condition (%). Allowed values: Good, Defective, Scrap.',
          NEW.grn_no, COALESCE(part_name_v, model, '(unnamed)'), COALESCE(NULLIF(cond,''),'empty');
      END IF;

      IF cond = 'good' THEN
        target_type := 'good'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'good_in'::public.ims_txn_type;
      ELSIF cond = 'defective' THEN
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      ELSE
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'scrapped'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      END IF;

      IF jsonb_typeof(it->'serials') = 'array' THEN
        SELECT array_agg(btrim(x)) INTO serial_list
        FROM jsonb_array_elements_text(it->'serials') AS x
        WHERE btrim(x) <> '';
      ELSIF serial IS NOT NULL THEN
        SELECT array_agg(btrim(x)) INTO serial_list
        FROM unnest(string_to_array(serial, ',')) AS x
        WHERE btrim(x) <> '';
      ELSE
        serial_list := NULL;
      END IF;

      IF serial_list IS NOT NULL AND array_length(serial_list, 1) > 0 THEN
        FOREACH s IN ARRAY serial_list LOOP
          INSERT INTO public.ims_stock_items(
            oem, part_name, part_model_no, part_serial_no, warehouse_id,
            stock_type, stock_status, qty, transaction_ref, notes, created_by
          ) VALUES (
            oem_v, COALESCE(part_name_v,'(unnamed)'), model, s, NEW.warehouse_id,
            target_type, target_status, 1, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
          ) RETURNING id INTO new_id;

          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
          ) VALUES (
            txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, s, oem_v,
            NEW.warehouse_id,
            COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
            1, NEW.indent_id, 'GRN ' || NEW.grn_no,
            'Auto-posted from GRN submission', NEW.created_by
          );
        END LOOP;

        remainder := qty - array_length(serial_list, 1);
      ELSE
        remainder := qty;
      END IF;

      IF remainder > 0 THEN
        INSERT INTO public.ims_stock_items(
          oem, part_name, part_model_no, part_serial_no, warehouse_id,
          stock_type, stock_status, qty, transaction_ref, notes, created_by
        ) VALUES (
          oem_v, COALESCE(part_name_v,'(unnamed)'), model, NULL, NEW.warehouse_id,
          target_type, target_status, remainder, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
        ) RETURNING id INTO new_id;

        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
        ) VALUES (
          txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, NULL, oem_v,
          NEW.warehouse_id,
          COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
          remainder, NEW.indent_id, 'GRN ' || NEW.grn_no,
          'Auto-posted from GRN submission', NEW.created_by
        );
      END IF;
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available'::public.ims_stock_status;

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment'::public.ims_txn_type, 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION public.sync_grn_to_ims(_grn_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  gr public.grns%ROWTYPE;
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT; cond TEXT;
  ref TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  new_id uuid;
  inserted_count int := 0;
  exists_txn boolean;
BEGIN
  SELECT * INTO gr FROM public.grns WHERE id = _grn_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF gr.status <> 'Submitted' THEN RETURN 0; END IF;
  IF gr.items IS NULL OR jsonb_typeof(gr.items) <> 'array' THEN RETURN 0; END IF;

  ref := 'GRN ' || gr.grn_no;

  FOR it IN SELECT * FROM jsonb_array_elements(gr.items) LOOP
    serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
    model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
    part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
    oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
    batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
    cond       := lower(btrim(COALESCE(it->>'condition','')));
    qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
    IF qty <= 0 THEN CONTINUE; END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.ims_transactions
       WHERE reference = ref
         AND ((serial IS NOT NULL AND part_serial_no = serial)
           OR (serial IS NULL AND part_serial_no IS NULL
               AND COALESCE(part_name,'') = COALESCE(part_name_v,'')
               AND COALESCE(part_model_no,'') = COALESCE(model,'')))
    ) INTO exists_txn;
    IF exists_txn THEN CONTINUE; END IF;

    IF cond NOT IN ('good','defective','scrap') THEN
      RAISE EXCEPTION 'GRN %: line item "%" has an invalid or missing condition (%). Allowed values: Good, Defective, Scrap.',
        gr.grn_no, COALESCE(part_name_v, model, '(unnamed)'), COALESCE(NULLIF(cond,''),'empty');
    END IF;

    IF cond = 'good' THEN
      target_type := 'good'::public.ims_stock_type;
      target_status := 'available'::public.ims_stock_status;
      txn_type_v := 'good_in'::public.ims_txn_type;
    ELSIF cond = 'defective' THEN
      target_type := 'defective'::public.ims_stock_type;
      target_status := 'available'::public.ims_stock_status;
      txn_type_v := 'defective_in'::public.ims_txn_type;
    ELSE
      target_type := 'defective'::public.ims_stock_type;
      target_status := 'scrapped'::public.ims_stock_status;
      txn_type_v := 'defective_in'::public.ims_txn_type;
    END IF;

    INSERT INTO public.ims_stock_items(
      oem, part_name, part_model_no, part_serial_no, warehouse_id,
      stock_type, stock_status, qty, transaction_ref, notes, created_by
    ) VALUES (
      oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, gr.warehouse_id,
      target_type, target_status, qty, ref, batch_v, gr.created_by
    ) RETURNING id INTO new_id;

    INSERT INTO public.ims_transactions(
      txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
      to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by, txn_date
    ) VALUES (
      txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
      gr.warehouse_id,
      COALESCE(gr.source_name, CASE gr.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
      qty, gr.indent_id, ref,
      'Backfilled from historical GRN', gr.created_by,
      COALESCE(gr.grn_date::timestamptz, gr.created_at)
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END
$fn$;

-- =====================================================================
-- SOURCE: 20260808163619_9d0b3d35-3ec9-479e-bf1c-65e39ba09277.sql
-- =====================================================================
-- 1. New standardized columns
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS is_serialized boolean NOT NULL DEFAULT false;

UPDATE public.products SET is_serialized = COALESCE(serial_tracking, false);

-- 2. Merge duplicates by normalized model
WITH ranked AS (
  SELECT id, lower(btrim(model)) AS m,
         first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products
  WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (
  SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id
)
, u1 AS (UPDATE public.invoice_items t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
, u2 AS (UPDATE public.purchase_order_items t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
, u3 AS (UPDATE public.serials t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
, u4 AS (UPDATE public.inventory t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
, u5 AS (UPDATE public.battery_catalog t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
SELECT count(*) FROM dupes;

-- bundles / spare parts (may have unique pairs) -- delete rows that would collide, then repoint
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
UPDATE public.product_bundles t SET parent_product_id = d.keep_id FROM dupes d WHERE t.parent_product_id = d.dup_id;

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
UPDATE public.product_bundles t SET child_product_id = d.keep_id FROM dupes d WHERE t.child_product_id = d.dup_id;

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
DELETE FROM public.product_spare_parts t
USING dupes d
WHERE t.parent_product_id = d.dup_id
  AND EXISTS (SELECT 1 FROM public.product_spare_parts x
              WHERE x.parent_product_id = d.keep_id AND x.spare_part_id = t.spare_part_id);

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
UPDATE public.product_spare_parts t SET parent_product_id = d.keep_id FROM dupes d WHERE t.parent_product_id = d.dup_id;

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
DELETE FROM public.product_spare_parts t
USING dupes d
WHERE t.spare_part_id = d.dup_id
  AND EXISTS (SELECT 1 FROM public.product_spare_parts x
              WHERE x.spare_part_id = d.keep_id AND x.parent_product_id = t.parent_product_id);

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
UPDATE public.product_spare_parts t SET spare_part_id = d.keep_id FROM dupes d WHERE t.spare_part_id = d.dup_id;

-- drop exact duplicate link rows created by the merge
DELETE FROM public.product_spare_parts a
USING public.product_spare_parts b
WHERE a.ctid > b.ctid
  AND a.parent_product_id = b.parent_product_id
  AND a.spare_part_id = b.spare_part_id;

DELETE FROM public.product_bundles a
USING public.product_bundles b
WHERE a.ctid > b.ctid
  AND a.parent_product_id = b.parent_product_id
  AND a.child_product_id = b.child_product_id;

-- finally remove duplicate product rows
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
)
DELETE FROM public.products p USING ranked r WHERE p.id = r.id AND r.id <> r.keep_id;

-- 3. Backfill names
UPDATE public.products
SET short_name = btrim(model),
    display_name = btrim(COALESCE(NULLIF(btrim(brand),'') || ' ', '') || btrim(model))
WHERE model IS NOT NULL AND btrim(model) <> '';

UPDATE public.products
SET short_name = COALESCE(NULLIF(btrim(short_name),''), NULLIF(btrim(name),''), '(unnamed)'),
    display_name = COALESCE(NULLIF(btrim(display_name),''), NULLIF(btrim(name),''), '(unnamed)');

-- 4. Keep names in sync + enforce uniqueness
CREATE OR REPLACE FUNCTION public.products_normalize_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE m text; b text;
BEGIN
  m := NULLIF(btrim(COALESCE(NEW.model,'')), '');
  b := NULLIF(btrim(COALESCE(NEW.brand,'')), '');
  NEW.model := m;
  IF m IS NOT NULL THEN
    NEW.short_name := m;
    NEW.display_name := btrim(COALESCE(b || ' ', '') || m);
  ELSE
    NEW.short_name := COALESCE(NULLIF(btrim(COALESCE(NEW.short_name,'')),''), NULLIF(btrim(COALESCE(NEW.name,'')),''), '(unnamed)');
    NEW.display_name := COALESCE(NULLIF(btrim(COALESCE(NEW.display_name,'')),''), NEW.short_name);
  END IF;
  NEW.is_serialized := COALESCE(NEW.is_serialized, false) OR COALESCE(NEW.serial_tracking, false);
  NEW.serial_tracking := NEW.is_serialized;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_products_normalize_names ON public.products;
CREATE TRIGGER trg_products_normalize_names
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_normalize_names();

CREATE UNIQUE INDEX IF NOT EXISTS products_model_unique
  ON public.products (lower(btrim(model)))
  WHERE model IS NOT NULL AND btrim(model) <> '';

-- =====================================================================
-- SOURCE: 20260809073721_39a7ca75-024a-4ca1-bd1e-7b0878614fa7.sql
-- =====================================================================
CREATE TABLE public.stock_negative_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL CHECK (document_type IN ('invoice','dc')),
  document_id UUID,
  document_no TEXT,
  product_model TEXT NOT NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  requested_qty NUMERIC NOT NULL,
  available_qty NUMERIC NOT NULL,
  resulting_negative_qty NUMERIC NOT NULL,
  overridden_by UUID REFERENCES auth.users(id),
  overridden_by_name TEXT,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stock_negative_overrides TO authenticated;
GRANT ALL ON public.stock_negative_overrides TO service_role;

ALTER TABLE public.stock_negative_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view negative stock overrides"
  ON public.stock_negative_overrides FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can log negative stock overrides"
  ON public.stock_negative_overrides FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND overridden_by = auth.uid());

CREATE TRIGGER trg_sno_touch BEFORE UPDATE ON public.stock_negative_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.delivery_challans ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.ims_deduct_qty(_model text, _warehouse uuid, _stock_type ims_stock_type, _qty numeric, _ref text, _new_status ims_stock_status, _doc_label text DEFAULT 'document'::text, _allow_negative boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  remaining numeric := _qty;
  take numeric;
  avail numeric;
  r public.ims_stock_items%ROWTYPE;
  first_id uuid;
  tmpl public.ims_stock_items%ROWTYPE;
BEGIN
  IF _model IS NULL OR _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(qty),0) INTO avail
    FROM public.ims_stock_items
   WHERE part_model_no = _model
     AND stock_type = _stock_type
     AND stock_status = 'available'::public.ims_stock_status
     AND part_serial_no IS NULL
     AND (_warehouse IS NULL OR warehouse_id = _warehouse);

  IF avail < _qty AND NOT COALESCE(_allow_negative, false) THEN
    RAISE EXCEPTION 'Cannot post %: only % unit(s) of "%" available in % stock, % requested',
      _doc_label, avail, _model, _stock_type, _qty;
  END IF;

  FOR r IN
    SELECT * FROM public.ims_stock_items
     WHERE part_model_no = _model
       AND stock_type = _stock_type
       AND stock_status = 'available'::public.ims_stock_status
       AND part_serial_no IS NULL
       AND qty > 0
       AND (_warehouse IS NULL OR warehouse_id = _warehouse)
     ORDER BY created_at ASC, id ASC
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(r.qty, remaining);

    IF take >= r.qty THEN
      UPDATE public.ims_stock_items
         SET stock_status = _new_status,
             transaction_ref = COALESCE(_ref, transaction_ref),
             updated_at = now()
       WHERE id = r.id;
      first_id := COALESCE(first_id, r.id);
    ELSE
      UPDATE public.ims_stock_items
         SET qty = r.qty - take, updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.ims_stock_items(
        oem, category, part_name, part_model_no, part_serial_no,
        warehouse_id, warehouse_type, stock_type, stock_status, qty,
        transaction_ref, notes, created_by
      ) VALUES (
        r.oem, r.category, r.part_name, r.part_model_no, NULL,
        r.warehouse_id, r.warehouse_type, r.stock_type, _new_status, take,
        _ref, 'Quantity split from pooled stock', r.created_by
      ) RETURNING id INTO first_id;
    END IF;

    remaining := remaining - take;
  END LOOP;

  -- Approved override: represent the shortfall as negative available quantity
  IF remaining > 0 AND COALESCE(_allow_negative, false) THEN
    SELECT * INTO tmpl FROM public.ims_stock_items
      WHERE part_model_no = _model AND part_serial_no IS NULL
      ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.ims_stock_items(
      oem, category, part_name, part_model_no, part_serial_no,
      warehouse_id, warehouse_type, stock_type, stock_status, qty,
      transaction_ref, notes
    ) VALUES (
      tmpl.oem, tmpl.category, COALESCE(tmpl.part_name, _model), _model, NULL,
      COALESCE(_warehouse, tmpl.warehouse_id), tmpl.warehouse_type, _stock_type,
      'available'::public.ims_stock_status, -remaining,
      _ref, 'Negative stock: approved override shortfall'
    );
    remaining := 0;
  END IF;

  RETURN first_id;
END $function$;

CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  item_stock_type TEXT;
  is_posting_new BOOLEAN;
  was_posting_old BOOLEAN;
  out_status public.ims_stock_status;
  pooled_id UUID;
  is_service BOOLEAN;
BEGIN
  IF NEW.doc_type NOT IN ('customer','oem') THEN RETURN NEW; END IF;

  is_posting_new  := NEW.status IN ('Challan Generated','Submitted');
  was_posting_old := TG_OP = 'UPDATE' AND OLD.status IN ('Challan Generated','Submitted');

  IF is_posting_new AND (TG_OP = 'INSERT' OR NOT was_posting_old) THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      is_service := FALSE;
      IF NULLIF(it->>'product_id','') IS NOT NULL THEN
        SELECT (item_type = 'service') INTO is_service
          FROM public.products WHERE id = (it->>'product_id')::uuid;
      END IF;
      IF COALESCE(is_service, FALSE) THEN CONTINUE; END IF;

      IF NEW.doc_type = 'customer' THEN
        target_type := 'good'::public.ims_stock_type;
      ELSE
        item_stock_type := lower(btrim(COALESCE(it->>'stock_type','')));
        IF item_stock_type LIKE 'defect%' THEN
          target_type := 'defective'::public.ims_stock_type;
        ELSIF item_stock_type LIKE 'good%' THEN
          target_type := 'good'::public.ims_stock_type;
        ELSE
          target_type := 'defective'::public.ims_stock_type;
        END IF;
      END IF;

      txn_type_v := CASE WHEN target_type = 'good'::public.ims_stock_type
                         THEN 'good_out'::public.ims_txn_type
                         ELSE 'defective_out'::public.ims_txn_type END;

      out_status := CASE WHEN NEW.doc_type = 'oem'
                         THEN 'returned_to_oem'::public.ims_stock_status
                         ELSE 'issued'::public.ims_stock_status END;

      stock_row := NULL;
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot post DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = out_status,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;
      ELSIF model IS NOT NULL THEN
        pooled_id := public.ims_deduct_qty(
          model, NULL, target_type, qty,
          'DC ' || COALESCE(NEW.challan_no,''), out_status,
          'DC ' || COALESCE(NEW.challan_no,''),
          (NEW.doc_type = 'customer' AND COALESCE(NEW.allow_negative_stock, false))
        );
        IF pooled_id IS NOT NULL THEN
          SELECT * INTO stock_row FROM public.ims_stock_items WHERE id = pooled_id;
        END IF;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial, COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND was_posting_old AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status);
  END IF;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.invoice_item_sync_serials()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  removed TEXT[];
  added TEXT[];
  p_model TEXT;
  p_item_type TEXT;
  allow_neg BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.serial_numbers IS NOT NULL AND array_length(NEW.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(NEW.serial_numbers)
         AND stock_status = 'available';
    ELSIF NEW.product_id IS NOT NULL AND COALESCE(NEW.qty,0) > 0 THEN
      SELECT model, item_type INTO p_model, p_item_type
        FROM public.products WHERE id = NEW.product_id;
      SELECT COALESCE(allow_negative_stock, false) INTO allow_neg
        FROM public.invoices WHERE id = NEW.invoice_id;
      IF COALESCE(p_item_type,'product') <> 'service' AND p_model IS NOT NULL THEN
        PERFORM public.ims_deduct_qty(
          p_model, NEW.warehouse_id, 'good'::public.ims_stock_type, NEW.qty,
          'Invoice item', 'issued'::public.ims_stock_status, 'invoice',
          COALESCE(allow_neg, false)
        );
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    removed := ARRAY(SELECT unnest(COALESCE(OLD.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(NEW.serial_numbers,'{}')));
    added   := ARRAY(SELECT unnest(COALESCE(NEW.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(OLD.serial_numbers,'{}')));
    IF array_length(removed,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(removed)
         AND stock_status = 'issued';
    END IF;
    IF array_length(added,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(added)
         AND stock_status = 'available';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.serial_numbers IS NOT NULL AND array_length(OLD.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(OLD.serial_numbers)
         AND stock_status = 'issued';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- =====================================================================
-- SOURCE: 20260809114529_614ad1a9-ee21-418f-9254-f8fd7103efab.sql
-- =====================================================================
-- 1. ims_deduct_qty now returns one row per batch consumed
DROP FUNCTION IF EXISTS public.ims_deduct_qty(text, uuid, public.ims_stock_type, numeric, text, public.ims_stock_status, text);
DROP FUNCTION IF EXISTS public.ims_deduct_qty(text, uuid, public.ims_stock_type, numeric, text, public.ims_stock_status, text, boolean);

CREATE OR REPLACE FUNCTION public.ims_deduct_qty(
  _model text, _warehouse uuid, _stock_type public.ims_stock_type, _qty numeric,
  _ref text, _new_status public.ims_stock_status, _doc_label text DEFAULT 'document',
  _allow_negative boolean DEFAULT false
)
RETURNS TABLE(stock_item_id uuid, qty_taken numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  remaining numeric := _qty;
  take numeric;
  avail numeric;
  r public.ims_stock_items%ROWTYPE;
  new_id uuid;
  tmpl public.ims_stock_items%ROWTYPE;
BEGIN
  IF _model IS NULL OR _qty IS NULL OR _qty <= 0 THEN RETURN; END IF;

  SELECT COALESCE(SUM(qty),0) INTO avail
    FROM public.ims_stock_items
   WHERE part_model_no = _model
     AND stock_type = _stock_type
     AND stock_status = 'available'::public.ims_stock_status
     AND part_serial_no IS NULL
     AND (_warehouse IS NULL OR warehouse_id = _warehouse);

  IF avail < _qty AND NOT COALESCE(_allow_negative, false) THEN
    RAISE EXCEPTION 'Cannot post %: only % unit(s) of "%" available in % stock, % requested',
      _doc_label, avail, _model, _stock_type, _qty;
  END IF;

  FOR r IN
    SELECT * FROM public.ims_stock_items
     WHERE part_model_no = _model
       AND stock_type = _stock_type
       AND stock_status = 'available'::public.ims_stock_status
       AND part_serial_no IS NULL
       AND qty > 0
       AND (_warehouse IS NULL OR warehouse_id = _warehouse)
     ORDER BY created_at ASC, id ASC
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(r.qty, remaining);

    IF take >= r.qty THEN
      UPDATE public.ims_stock_items
         SET stock_status = _new_status,
             transaction_ref = COALESCE(_ref, transaction_ref),
             updated_at = now()
       WHERE id = r.id;
      new_id := r.id;
    ELSE
      UPDATE public.ims_stock_items
         SET qty = r.qty - take, updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.ims_stock_items(
        oem, category, part_name, part_model_no, part_serial_no,
        warehouse_id, warehouse_type, stock_type, stock_status, qty,
        transaction_ref, notes, created_by
      ) VALUES (
        r.oem, r.category, r.part_name, r.part_model_no, NULL,
        r.warehouse_id, r.warehouse_type, r.stock_type, _new_status, take,
        _ref, 'Quantity split from pooled stock', r.created_by
      ) RETURNING id INTO new_id;
    END IF;

    stock_item_id := new_id; qty_taken := take; RETURN NEXT;
    remaining := remaining - take;
  END LOOP;

  IF remaining > 0 AND COALESCE(_allow_negative, false) THEN
    SELECT * INTO tmpl FROM public.ims_stock_items
      WHERE part_model_no = _model AND part_serial_no IS NULL
      ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.ims_stock_items(
      oem, category, part_name, part_model_no, part_serial_no,
      warehouse_id, warehouse_type, stock_type, stock_status, qty,
      transaction_ref, notes
    ) VALUES (
      tmpl.oem, tmpl.category, COALESCE(tmpl.part_name, _model), _model, NULL,
      COALESCE(_warehouse, tmpl.warehouse_id), tmpl.warehouse_type, _stock_type,
      'available'::public.ims_stock_status, -remaining,
      _ref, 'Negative stock: approved override shortfall'
    ) RETURNING id INTO new_id;

    stock_item_id := new_id; qty_taken := remaining; RETURN NEXT;
    remaining := 0;
  END IF;

  RETURN;
END $function$;

GRANT EXECUTE ON FUNCTION public.ims_deduct_qty(text, uuid, public.ims_stock_type, numeric, text, public.ims_stock_status, text, boolean) TO authenticated, service_role;

-- 2. DC posting: one transaction per batch + cancellation reversal
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  item_stock_type TEXT;
  is_posting_new BOOLEAN;
  was_posting_old BOOLEAN;
  out_status public.ims_stock_status;
  is_service BOOLEAN;
  d RECORD;
  rev RECORD;
BEGIN
  IF NEW.doc_type NOT IN ('customer','oem') THEN RETURN NEW; END IF;

  is_posting_new  := NEW.status IN ('Challan Generated','Submitted');
  was_posting_old := TG_OP = 'UPDATE' AND OLD.status IN ('Challan Generated','Submitted');

  IF is_posting_new AND (TG_OP = 'INSERT' OR NOT was_posting_old) THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      is_service := FALSE;
      IF NULLIF(it->>'product_id','') IS NOT NULL THEN
        SELECT (item_type = 'service') INTO is_service
          FROM public.products WHERE id = (it->>'product_id')::uuid;
      END IF;
      IF COALESCE(is_service, FALSE) THEN CONTINUE; END IF;

      IF NEW.doc_type = 'customer' THEN
        target_type := 'good'::public.ims_stock_type;
      ELSE
        item_stock_type := lower(btrim(COALESCE(it->>'stock_type','')));
        IF item_stock_type LIKE 'defect%' THEN
          target_type := 'defective'::public.ims_stock_type;
        ELSIF item_stock_type LIKE 'good%' THEN
          target_type := 'good'::public.ims_stock_type;
        ELSE
          target_type := 'defective'::public.ims_stock_type;
        END IF;
      END IF;

      txn_type_v := CASE WHEN target_type = 'good'::public.ims_stock_type
                         THEN 'good_out'::public.ims_txn_type
                         ELSE 'defective_out'::public.ims_txn_type END;

      out_status := CASE WHEN NEW.doc_type = 'oem'
                         THEN 'returned_to_oem'::public.ims_stock_status
                         ELSE 'issued'::public.ims_stock_status END;

      IF serial IS NOT NULL THEN
        stock_row := NULL;
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot post DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = out_status,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;

        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
        ) VALUES (
          txn_type_v, stock_row.id,
          COALESCE(part_name_v, stock_row.part_name),
          COALESCE(model, stock_row.part_model_no),
          serial, COALESCE(oem_v, stock_row.oem),
          stock_row.warehouse_id,
          COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
          qty, NEW.indent_id, 'DC ' || NEW.challan_no,
          'Auto-posted from Delivery Challan', NEW.created_by
        );

      ELSIF model IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            model, NULL, target_type, qty,
            'DC ' || COALESCE(NEW.challan_no,''), out_status,
            'DC ' || COALESCE(NEW.challan_no,''),
            (NEW.doc_type = 'customer' AND COALESCE(NEW.allow_negative_stock, false))
          )
        LOOP
          stock_row := NULL;
          SELECT * INTO stock_row FROM public.ims_stock_items WHERE id = d.stock_item_id;

          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
          ) VALUES (
            txn_type_v, d.stock_item_id,
            COALESCE(part_name_v, stock_row.part_name),
            COALESCE(model, stock_row.part_model_no),
            NULL, COALESCE(oem_v, stock_row.oem),
            stock_row.warehouse_id,
            COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
            d.qty_taken, NEW.indent_id, 'DC ' || NEW.challan_no,
            'Auto-posted from Delivery Challan', NEW.created_by
          );
        END LOOP;
      END IF;
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND was_posting_old AND NEW.status = 'Cancelled' THEN
    FOR rev IN
      SELECT * FROM public.ims_stock_items
       WHERE transaction_ref = 'DC ' || NEW.challan_no
         AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status)
    LOOP
      UPDATE public.ims_stock_items
         SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
       WHERE id = rev.id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        CASE WHEN rev.stock_type = 'good'::public.ims_stock_type
             THEN 'good_in'::public.ims_txn_type
             ELSE 'defective_in'::public.ims_txn_type END,
        rev.id, rev.part_name, rev.part_model_no, rev.part_serial_no, rev.oem,
        rev.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        rev.qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Reversal: DC cancelled after posting', NEW.created_by
      );
    END LOOP;
  END IF;

  RETURN NEW;
END $function$;

-- 3. Stock transfer: one out-transaction per batch
CREATE OR REPLACE FUNCTION public.ims_transfer_status_effects()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  linked_id UUID := NEW.stock_item_id;
  d RECORD;
  wrote_out BOOLEAN := FALSE;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('in_transit','completed') THEN

    IF linked_id IS NULL AND NEW.part_serial_no IS NOT NULL THEN
      SELECT id INTO linked_id
        FROM public.ims_stock_items
       WHERE part_serial_no = NEW.part_serial_no
         AND (NEW.source_warehouse_id IS NULL OR warehouse_id = NEW.source_warehouse_id)
       LIMIT 1;
      IF linked_id IS NOT NULL THEN
        NEW.stock_item_id := linked_id;
      END IF;
    END IF;

    IF NEW.status = 'in_transit' THEN
      IF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET stock_status = 'in_transit', updated_at = now()
         WHERE id = linked_id;
      ELSIF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            NEW.part_model_no, NEW.source_warehouse_id, NEW.stock_type, NEW.qty,
            COALESCE(NEW.transfer_no,'Transfer'), 'in_transit'::public.ims_stock_status,
            'Transfer ' || COALESCE(NEW.transfer_no,'')
          )
        LOOP
          IF linked_id IS NULL THEN
            linked_id := d.stock_item_id;
            NEW.stock_item_id := linked_id;
          END IF;
          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
          ) VALUES (
            'transfer_out', d.stock_item_id, NEW.part_name, NEW.part_model_no, NULL, NEW.oem,
            NEW.source_warehouse_id, NEW.destination_warehouse_id, d.qty_taken, NEW.id, NEW.transfer_no,
            'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
          );
          wrote_out := TRUE;
        END LOOP;
      END IF;

      IF NOT wrote_out THEN
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
        ) VALUES (
          'transfer_out', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
          NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
          'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
        );
      END IF;

    ELSIF NEW.status = 'completed' THEN
      IF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        IF linked_id IS NOT NULL THEN
          DELETE FROM public.ims_stock_items WHERE id = linked_id;
        END IF;
        linked_id := public.ims_add_qty(
          NEW.part_model_no, NEW.destination_warehouse_id, NEW.stock_type, NEW.qty,
          NEW.part_name, NEW.oem, COALESCE(NEW.transfer_no,'Transfer')
        );
        NEW.stock_item_id := linked_id;
      ELSIF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET warehouse_id  = NEW.destination_warehouse_id,
               stock_status  = 'available',
               updated_at    = now()
         WHERE id = linked_id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
      ) VALUES (
        'transfer_in', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
        NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
        'Transfer received', NEW.received_by
      );
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 4. Invoice items: write stock movement transactions
CREATE OR REPLACE FUNCTION public.invoice_item_sync_serials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  removed TEXT[];
  added TEXT[];
  p_model TEXT;
  p_item_type TEXT;
  allow_neg BOOLEAN := false;
  inv_no TEXT;
  inv_party TEXT;
  s TEXT;
  sr public.ims_stock_items%ROWTYPE;
  d RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT invoice_no, buyer_name INTO inv_no, inv_party FROM public.invoices WHERE id = OLD.invoice_id;
  ELSE
    SELECT invoice_no, buyer_name, COALESCE(allow_negative_stock,false)
      INTO inv_no, inv_party, allow_neg FROM public.invoices WHERE id = NEW.invoice_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.serial_numbers IS NOT NULL AND array_length(NEW.serial_numbers,1) > 0 THEN
      FOREACH s IN ARRAY NEW.serial_numbers LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'available' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes
        ) VALUES (
          'good_out', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Auto-posted from Sales Invoice'
        );
      END LOOP;
    ELSIF NEW.product_id IS NOT NULL AND COALESCE(NEW.qty,0) > 0 THEN
      SELECT model, item_type INTO p_model, p_item_type
        FROM public.products WHERE id = NEW.product_id;
      IF COALESCE(p_item_type,'product') <> 'service' AND p_model IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            p_model, NEW.warehouse_id, 'good'::public.ims_stock_type, NEW.qty,
            'Invoice ' || COALESCE(inv_no,''), 'issued'::public.ims_stock_status, 'invoice',
            COALESCE(allow_neg, false)
          )
        LOOP
          sr := NULL;
          SELECT * INTO sr FROM public.ims_stock_items WHERE id = d.stock_item_id;
          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_party, qty, reference, notes
          ) VALUES (
            'good_out', d.stock_item_id, sr.part_name, sr.part_model_no, NULL, sr.oem,
            sr.warehouse_id, COALESCE(inv_party,'Customer'), d.qty_taken,
            'Invoice ' || COALESCE(inv_no,''), 'Auto-posted from Sales Invoice'
          );
        END LOOP;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    removed := ARRAY(SELECT unnest(COALESCE(OLD.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(NEW.serial_numbers,'{}')));
    added   := ARRAY(SELECT unnest(COALESCE(NEW.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(OLD.serial_numbers,'{}')));

    IF array_length(removed,1) > 0 THEN
      FOREACH s IN ARRAY removed LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'issued' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'available', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, reference, notes
        ) VALUES (
          'good_in', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Reversal: serial removed from Sales Invoice'
        );
      END LOOP;
    END IF;

    IF array_length(added,1) > 0 THEN
      FOREACH s IN ARRAY added LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'available' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes
        ) VALUES (
          'good_out', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Auto-posted from Sales Invoice'
        );
      END LOOP;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.serial_numbers IS NOT NULL AND array_length(OLD.serial_numbers,1) > 0 THEN
      FOREACH s IN ARRAY OLD.serial_numbers LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'issued' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'available', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, reference, notes
        ) VALUES (
          'good_in', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Reversal: invoice item deleted'
        );
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- =====================================================================
-- SOURCE: 20260809115615_6a4c672c-a231-4f27-99f5-8cec09e67f9d.sql
-- =====================================================================
ALTER TYPE public.ims_transfer_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE public.ims_transfers ADD COLUMN IF NOT EXISTS cancelled_reason text;

CREATE OR REPLACE FUNCTION public.ims_transfer_status_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  linked_id UUID := NEW.stock_item_id;
  d RECORD;
  s RECORD;
  wrote_out BOOLEAN := FALSE;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('in_transit','completed','cancelled') THEN

    IF linked_id IS NULL AND NEW.part_serial_no IS NOT NULL THEN
      SELECT id INTO linked_id
        FROM public.ims_stock_items
       WHERE part_serial_no = NEW.part_serial_no
         AND (NEW.source_warehouse_id IS NULL OR warehouse_id = NEW.source_warehouse_id)
       LIMIT 1;
      IF linked_id IS NOT NULL THEN
        NEW.stock_item_id := linked_id;
      END IF;
    END IF;

    IF NEW.status = 'in_transit' THEN
      IF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET stock_status = 'in_transit', updated_at = now()
         WHERE id = linked_id;
      ELSIF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            NEW.part_model_no, NEW.source_warehouse_id, NEW.stock_type, NEW.qty,
            COALESCE(NEW.transfer_no,'Transfer'), 'in_transit'::public.ims_stock_status,
            'Transfer ' || COALESCE(NEW.transfer_no,'')
          )
        LOOP
          IF linked_id IS NULL THEN
            linked_id := d.stock_item_id;
            NEW.stock_item_id := linked_id;
          END IF;
          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
          ) VALUES (
            'transfer_out', d.stock_item_id, NEW.part_name, NEW.part_model_no, NULL, NEW.oem,
            NEW.source_warehouse_id, NEW.destination_warehouse_id, d.qty_taken, NEW.id, NEW.transfer_no,
            'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
          );
          wrote_out := TRUE;
        END LOOP;
      END IF;

      IF NOT wrote_out THEN
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
        ) VALUES (
          'transfer_out', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
          NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
          'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
        );
      END IF;

    ELSIF NEW.status = 'cancelled' THEN
      IF OLD.status = 'in_transit' THEN
        IF NEW.part_serial_no IS NOT NULL OR (linked_id IS NOT NULL AND NEW.part_model_no IS NULL) THEN
          FOR s IN
            SELECT * FROM public.ims_stock_items
             WHERE id = linked_id AND stock_status = 'in_transit'
          LOOP
            UPDATE public.ims_stock_items
               SET stock_status = 'available',
                   warehouse_id = COALESCE(NEW.source_warehouse_id, warehouse_id),
                   updated_at = now()
             WHERE id = s.id;
            INSERT INTO public.ims_transactions(
              txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
              from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
            ) VALUES (
              'transfer_in', s.id, NEW.part_name, NEW.part_model_no, s.part_serial_no, NEW.oem,
              NEW.destination_warehouse_id, NEW.source_warehouse_id, s.qty, NEW.id, NEW.transfer_no,
              'Reversal: Transfer cancelled while in transit', COALESCE(NEW.approved_by, NEW.requested_by)
            );
          END LOOP;
        ELSE
          FOR s IN
            SELECT * FROM public.ims_stock_items
             WHERE stock_status = 'in_transit'
               AND part_serial_no IS NULL
               AND part_model_no = NEW.part_model_no
               AND stock_type = NEW.stock_type
               AND (NEW.source_warehouse_id IS NULL OR warehouse_id = NEW.source_warehouse_id)
               AND transaction_ref = COALESCE(NEW.transfer_no,'Transfer')
          LOOP
            UPDATE public.ims_stock_items
               SET stock_status = 'available', updated_at = now()
             WHERE id = s.id;
            INSERT INTO public.ims_transactions(
              txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
              from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
            ) VALUES (
              'transfer_in', s.id, NEW.part_name, NEW.part_model_no, NULL, NEW.oem,
              NEW.destination_warehouse_id, NEW.source_warehouse_id, s.qty, NEW.id, NEW.transfer_no,
              'Reversal: Transfer cancelled while in transit', COALESCE(NEW.approved_by, NEW.requested_by)
            );
          END LOOP;
        END IF;
      END IF;

    ELSIF NEW.status = 'completed' THEN
      IF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        IF linked_id IS NOT NULL THEN
          DELETE FROM public.ims_stock_items WHERE id = linked_id;
        END IF;
        linked_id := public.ims_add_qty(
          NEW.part_model_no, NEW.destination_warehouse_id, NEW.stock_type, NEW.qty,
          NEW.part_name, NEW.oem, COALESCE(NEW.transfer_no,'Transfer')
        );
        NEW.stock_item_id := linked_id;
      ELSIF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET warehouse_id  = NEW.destination_warehouse_id,
               stock_status  = 'available',
               updated_at    = now()
         WHERE id = linked_id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
      ) VALUES (
        'transfer_in', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
        NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
        'Transfer received', NEW.received_by
      );
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- =====================================================================
-- SOURCE: 20260810045912_5fa0da1c-c5b3-4b2c-a708-7447168f1272.sql
-- =====================================================================
-- 1. Completeness check, with customer-return section made conditional
DROP FUNCTION IF EXISTS public._oracle_block_complete(jsonb);

CREATE OR REPLACE FUNCTION public._oracle_block_complete(blk jsonb, _require_customer boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  drows JSONB := COALESCE(blk->'defective_rows','[]'::jsonb);
  erows JSONB := COALESCE(blk->'exchange_rows','[]'::jsonb);
  rrows JSONB := COALESCE(blk->'received_rows','[]'::jsonb);
  crows JSONB := COALESCE(blk->'customer_received_rows','[]'::jsonb);
  n INT := jsonb_array_length(drows);
  i INT;
  d JSONB; e JSONB; r JSONB; c JSONB;
  need_cust BOOLEAN := _require_customer;
  cust_touched BOOLEAN := false;
BEGIN
  IF n = 0 THEN RETURN FALSE; END IF;
  IF jsonb_array_length(erows) < n OR jsonb_array_length(rrows) < n THEN RETURN FALSE; END IF;

  -- Any partially-filled customer-return row makes section D mandatory.
  IF jsonb_array_length(crows) > 0 THEN
    FOR i IN 0..jsonb_array_length(crows)-1 LOOP
      c := crows -> i;
      IF public._oracle_row_str(c,'warehouse_id') <> ''
         OR public._oracle_row_str(c,'serial_no') <> ''
         OR public._oracle_row_str(c,'received_date') <> '' THEN
        cust_touched := true;
      END IF;
    END LOOP;
  END IF;
  IF cust_touched THEN need_cust := true; END IF;

  IF need_cust AND jsonb_array_length(crows) < n THEN RETURN FALSE; END IF;

  FOR i IN 0..n-1 LOOP
    d := drows -> i; e := erows -> i; r := rrows -> i;
    -- Section A: Defective
    IF public._oracle_row_str(d,'def_model_no') = '' OR public._oracle_row_str(d,'def_serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(d,'qty') = '' OR (public._oracle_row_str(d,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    -- Section B: Exchange
    IF public._oracle_row_str(e,'warehouse_id') = '' OR public._oracle_row_str(e,'model_no') = '' OR public._oracle_row_str(e,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(e,'qty') = '' OR (public._oracle_row_str(e,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    -- Section C: Material Received (from OEM)
    IF public._oracle_row_str(r,'warehouse_id') = '' OR public._oracle_row_str(r,'model_no') = '' OR public._oracle_row_str(r,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'qty') = '' OR (public._oracle_row_str(r,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'received_date') = '' THEN RETURN FALSE; END IF;
    -- Section D: Material Received (from Customer) — conditional
    IF need_cust THEN
      c := crows -> i;
      IF public._oracle_row_str(c,'warehouse_id') = '' OR public._oracle_row_str(c,'model_no') = '' OR public._oracle_row_str(c,'serial_no') = '' THEN RETURN FALSE; END IF;
      IF public._oracle_row_str(c,'qty') = '' OR (public._oracle_row_str(c,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
      IF public._oracle_row_str(c,'received_date') = '' THEN RETURN FALSE; END IF;
      IF public._oracle_row_str(c,'product_tag') = '' THEN RETURN FALSE; END IF;
    END IF;
  END LOOP;

  RETURN TRUE;
END
$fn$;

-- 2. Are there DC/GRN docs for this indent + oracle that are not yet settled?
CREATE OR REPLACE FUNCTION public.oracle_docs_pending(_indent_id uuid, _oracle_no text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  key TEXT := upper(btrim(COALESCE(_oracle_no,'')));
  hit INT := 0;
BEGIN
  IF _indent_id IS NULL THEN RETURN FALSE; END IF;

  SELECT count(*) INTO hit
    FROM public.delivery_challans dc
   WHERE dc.indent_id = _indent_id
     AND lower(COALESCE(dc.status,'')) <> 'cancelled'
     AND COALESCE(dc.status,'') NOT IN ('Submitted','Closed')
     AND (
       key = '' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(dc.items,'[]'::jsonb)) it
          WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key
       )
     );
  IF hit > 0 THEN RETURN TRUE; END IF;

  SELECT count(*) INTO hit
    FROM public.grns g
   WHERE g.indent_id = _indent_id
     AND lower(COALESCE(g.status,'')) <> 'cancelled'
     AND COALESCE(g.status,'') NOT IN ('Submitted','Closed')
     AND (
       key = '' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
          WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key
       )
     );
  RETURN hit > 0;
END
$fn$;

-- 3. Recompute closed-state for every block of an indent
CREATE OR REPLACE FUNCTION public.oracles_autoclose(_oracles jsonb, _indent_id uuid, _indent_type text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  out_arr JSONB := '[]'::jsonb;
  blk JSONB;
  need_cust BOOLEAN := COALESCE(_indent_type,'') <> 'rma_service_ship';
BEGIN
  IF _oracles IS NULL OR jsonb_typeof(_oracles) <> 'array' THEN RETURN _oracles; END IF;

  FOR blk IN SELECT value FROM jsonb_array_elements(_oracles) LOOP
    IF COALESCE(blk->>'status','open') <> 'closed'
       AND public._oracle_block_complete(blk, need_cust)
       AND NOT public.oracle_docs_pending(_indent_id, blk->>'oracle_no')
    THEN
      blk := blk
        || jsonb_build_object('status','closed')
        || jsonb_build_object('closed_at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        || jsonb_build_object('closed_by_name', COALESCE(blk->>'closed_by_name','System (auto)'));
    END IF;
    out_arr := out_arr || jsonb_build_array(blk);
  END LOOP;

  RETURN out_arr;
END
$fn$;

-- 4. Apply on every indent write
CREATE OR REPLACE FUNCTION public.indents_autoclose_oracles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  NEW.oracles_data := public.oracles_autoclose(NEW.oracles_data, NEW.id, NEW.indent_type::text);
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_indents_autoclose_oracles ON public.indents;
CREATE TRIGGER trg_indents_autoclose_oracles
BEFORE INSERT OR UPDATE ON public.indents
FOR EACH ROW EXECUTE FUNCTION public.indents_autoclose_oracles();

-- 5. Re-evaluate the indent when a linked DC / GRN changes
CREATE OR REPLACE FUNCTION public.trg_indent_recalc_from_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _iid UUID := COALESCE(NEW.indent_id, OLD.indent_id);
BEGIN
  PERFORM public.recalc_indent_status(_iid);
  IF _iid IS NOT NULL THEN
    -- touching the row fires trg_indents_autoclose_oracles
    UPDATE public.indents SET updated_at = now() WHERE id = _iid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$fn$;

-- 6. Backfill: re-evaluate every existing indent once
UPDATE public.indents SET updated_at = updated_at WHERE oracles_data IS NOT NULL;


-- =====================================================================
-- SOURCE: 20260810131746_96f5c830-6c66-43bf-8ddf-c152e6af31ac.sql
-- =====================================================================
ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS oracle_number text
  GENERATED ALWAYS AS ((oracles_data -> 0 ->> 'oracle_no')) STORED;

CREATE INDEX IF NOT EXISTS idx_indents_oracle_number
  ON public.indents (oracle_number);

-- =====================================================================
-- SOURCE: 20260811175501_fa4b1d7a-d3dc-4ef4-8bee-eed43d7017e1.sql
-- =====================================================================

CREATE OR REPLACE FUNCTION public.oracle_docs_satisfied(_indent_id uuid, blk jsonb, _require_customer boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  key TEXT := upper(btrim(COALESCE(blk->>'oracle_no','')));
  erows JSONB := COALESCE(blk->'exchange_rows','[]'::jsonb);
  rrows JSONB := COALESCE(blk->'received_rows','[]'::jsonb);
  crows JSONB := COALESCE(blk->'customer_received_rows','[]'::jsonb);
  need_dc BOOLEAN := false;
  need_oem BOOLEAN := false;
  need_cust BOOLEAN := false;
  cust_touched BOOLEAN := false;
  el JSONB;
  pend INT; done INT;
BEGIN
  IF _indent_id IS NULL THEN RETURN FALSE; END IF;

  FOR el IN SELECT value FROM jsonb_array_elements(erows) LOOP
    IF public._oracle_row_str(el,'warehouse_id') <> '' OR public._oracle_row_str(el,'model_no') <> ''
       OR public._oracle_row_str(el,'serial_no') <> '' OR public._oracle_row_str(el,'qty') <> '' THEN
      need_dc := true;
    END IF;
  END LOOP;

  FOR el IN SELECT value FROM jsonb_array_elements(rrows) LOOP
    IF public._oracle_row_str(el,'warehouse_id') <> '' OR public._oracle_row_str(el,'model_no') <> ''
       OR public._oracle_row_str(el,'serial_no') <> '' OR public._oracle_row_str(el,'qty') <> '' THEN
      need_oem := true;
    END IF;
  END LOOP;

  FOR el IN SELECT value FROM jsonb_array_elements(crows) LOOP
    IF public._oracle_row_str(el,'warehouse_id') <> '' OR public._oracle_row_str(el,'model_no') <> ''
       OR public._oracle_row_str(el,'serial_no') <> '' OR public._oracle_row_str(el,'qty') <> '' THEN
      cust_touched := true;
    END IF;
  END LOOP;
  need_cust := (_require_customer AND jsonb_array_length(crows) > 0) OR cust_touched;

  -- Delivery Challan (Section B)
  IF need_dc THEN
    SELECT
      count(*) FILTER (WHERE COALESCE(dc.status,'') NOT IN ('Submitted','Closed')),
      count(*) FILTER (WHERE COALESCE(dc.status,'') IN ('Submitted','Closed'))
      INTO pend, done
      FROM public.delivery_challans dc
     WHERE dc.indent_id = _indent_id
       AND lower(COALESCE(dc.status,'')) <> 'cancelled'
       AND (key = '' OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(dc.items,'[]'::jsonb)) it
              WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key));
    IF COALESCE(done,0) = 0 OR COALESCE(pend,0) > 0 THEN RETURN FALSE; END IF;
  END IF;

  -- OEM GRN (Section C)
  IF need_oem THEN
    SELECT
      count(*) FILTER (WHERE COALESCE(g.status,'') NOT IN ('Submitted','Closed')),
      count(*) FILTER (WHERE COALESCE(g.status,'') IN ('Submitted','Closed'))
      INTO pend, done
      FROM public.grns g
     WHERE g.indent_id = _indent_id
       AND lower(COALESCE(g.status,'')) <> 'cancelled'
       AND COALESCE(g.category,'') <> 'customer'
       AND (key = '' OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
              WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key));
    IF COALESCE(done,0) = 0 OR COALESCE(pend,0) > 0 THEN RETURN FALSE; END IF;
  END IF;

  -- Customer GRN (Section D)
  IF need_cust THEN
    SELECT
      count(*) FILTER (WHERE COALESCE(g.status,'') NOT IN ('Submitted','Closed')),
      count(*) FILTER (WHERE COALESCE(g.status,'') IN ('Submitted','Closed'))
      INTO pend, done
      FROM public.grns g
     WHERE g.indent_id = _indent_id
       AND lower(COALESCE(g.status,'')) <> 'cancelled'
       AND COALESCE(g.category,'') = 'customer'
       AND (key = '' OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
              WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key));
    IF COALESCE(done,0) = 0 OR COALESCE(pend,0) > 0 THEN RETURN FALSE; END IF;
  END IF;

  RETURN TRUE;
END
$function$;

CREATE OR REPLACE FUNCTION public.oracles_autoclose(_oracles jsonb, _indent_id uuid, _indent_type text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  out_arr JSONB := '[]'::jsonb;
  blk JSONB;
  need_cust BOOLEAN := COALESCE(_indent_type,'') <> 'rma_service_ship';
BEGIN
  IF _oracles IS NULL OR jsonb_typeof(_oracles) <> 'array' THEN RETURN _oracles; END IF;

  FOR blk IN SELECT value FROM jsonb_array_elements(_oracles) LOOP
    IF COALESCE(blk->>'status','open') <> 'closed'
       AND public._oracle_block_complete(blk, need_cust)
       AND public.oracle_docs_satisfied(_indent_id, blk, need_cust)
    THEN
      blk := blk
        || jsonb_build_object('status','closed')
        || jsonb_build_object('closed_at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        || jsonb_build_object('closed_by_name', COALESCE(blk->>'closed_by_name','System (auto)'));
    END IF;
    out_arr := out_arr || jsonb_build_array(blk);
  END LOOP;

  RETURN out_arr;
END
$function$;


-- =====================================================================
-- SOURCE: 20260813040003_8f3b2b77-dc4b-4670-8faa-228ccf469977.sql
-- =====================================================================
CREATE SEQUENCE IF NOT EXISTS public.gdc_seq;

CREATE TABLE public.general_delivery_challans (
  id uuid primary key default gen_random_uuid(),
  dc_no text unique,
  dc_date date not null default current_date,
  returnable boolean not null default false,
  customer_id uuid references public.customers(id),
  customer_name text,
  billing_address text,
  shipping_address text,
  purpose text,
  branch_id uuid references public.branches(id),
  items jsonb not null default '[]'::jsonb,
  status text not null default 'Draft' check (status in ('Draft','Issued','Converted')),
  converted_invoice_id uuid references public.invoices(id),
  allow_negative_stock boolean not null default false,
  notes text,
  terms text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.general_delivery_challans TO authenticated;
GRANT ALL ON public.general_delivery_challans TO service_role;
GRANT USAGE ON SEQUENCE public.gdc_seq TO authenticated, service_role;
ALTER TABLE public.general_delivery_challans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gdc_select" ON public.general_delivery_challans FOR SELECT TO authenticated USING (true);
CREATE POLICY "gdc_insert" ON public.general_delivery_challans FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "gdc_update" ON public.general_delivery_challans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "gdc_delete" ON public.general_delivery_challans FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.set_gdc_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.dc_no IS NULL OR NEW.dc_no = '' THEN
    NEW.dc_no := 'GDC/' || to_char(now(),'YYYY') || '/' || lpad(nextval('public.gdc_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_set_gdc_no BEFORE INSERT ON public.general_delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.set_gdc_no();

CREATE TRIGGER trg_gdc_touch BEFORE UPDATE ON public.general_delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Post stock on Issue, reusing the same helpers as DC / Invoice.
CREATE OR REPLACE FUNCTION public.gdc_post_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it jsonb; s text; qty numeric; model text; part_name_v text;
  is_service boolean; sr public.ims_stock_items%ROWTYPE; d RECORD;
  wh uuid; party text;
BEGIN
  IF NEW.status <> 'Issued' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Issued' THEN RETURN NEW; END IF;
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

  party := COALESCE(NEW.customer_name, 'Customer');

  FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    model := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
    part_name_v := NULLIF(btrim(COALESCE(it->>'part_name','')), '');
    qty := COALESCE(NULLIF(it->>'qty','')::numeric, 0);
    wh := NULLIF(it->>'warehouse_id','')::uuid;
    IF qty <= 0 THEN CONTINUE; END IF;

    is_service := false;
    IF NULLIF(it->>'product_id','') IS NOT NULL THEN
      SELECT (item_type = 'service') INTO is_service FROM public.products WHERE id = (it->>'product_id')::uuid;
    END IF;
    IF COALESCE(is_service,false) THEN CONTINUE; END IF;

    IF COALESCE(jsonb_array_length(COALESCE(it->'serial_numbers','[]'::jsonb)),0) > 0 THEN
      FOR s IN SELECT jsonb_array_elements_text(it->'serial_numbers') LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
          WHERE part_serial_no = s AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF sr.id IS NULL THEN
          RAISE EXCEPTION 'Cannot issue %: serial "%" is not available in stock', NEW.dc_no, s;
        END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued'::public.ims_stock_status,
               transaction_ref = 'GDC ' || NEW.dc_no, updated_at = now()
         WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes, created_by
        ) VALUES (
          'good_out'::public.ims_txn_type, sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, party, 1, 'GDC ' || NEW.dc_no,
          'Auto-posted from General Delivery Challan', NEW.created_by
        );
      END LOOP;
    ELSIF model IS NOT NULL THEN
      FOR d IN SELECT * FROM public.ims_deduct_qty(
          model, wh, 'good'::public.ims_stock_type, qty,
          'GDC ' || COALESCE(NEW.dc_no,''), 'issued'::public.ims_stock_status,
          'General Delivery Challan', COALESCE(NEW.allow_negative_stock,false))
      LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items WHERE id = d.stock_item_id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes, created_by
        ) VALUES (
          'good_out'::public.ims_txn_type, d.stock_item_id,
          COALESCE(part_name_v, sr.part_name), COALESCE(model, sr.part_model_no), NULL, sr.oem,
          sr.warehouse_id, party, d.qty_taken, 'GDC ' || COALESCE(NEW.dc_no,''),
          'Auto-posted from General Delivery Challan', NEW.created_by
        );
      END LOOP;
    END IF;
  END LOOP;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_gdc_post_inventory AFTER INSERT OR UPDATE ON public.general_delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.gdc_post_inventory();

-- Invoices created from an already-issued General DC must not deduct stock again.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS skip_stock_posting boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS source_general_dc_id uuid REFERENCES public.general_delivery_challans(id);

CREATE OR REPLACE FUNCTION public.invoice_item_sync_serials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  removed TEXT[];
  added TEXT[];
  p_model TEXT;
  p_item_type TEXT;
  allow_neg BOOLEAN := false;
  skip_post BOOLEAN := false;
  inv_no TEXT;
  inv_party TEXT;
  s TEXT;
  sr public.ims_stock_items%ROWTYPE;
  d RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT invoice_no, buyer_name, COALESCE(skip_stock_posting,false)
      INTO inv_no, inv_party, skip_post FROM public.invoices WHERE id = OLD.invoice_id;
  ELSE
    SELECT invoice_no, buyer_name, COALESCE(allow_negative_stock,false), COALESCE(skip_stock_posting,false)
      INTO inv_no, inv_party, allow_neg, skip_post FROM public.invoices WHERE id = NEW.invoice_id;
  END IF;

  IF COALESCE(skip_post,false) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.serial_numbers IS NOT NULL AND array_length(NEW.serial_numbers,1) > 0 THEN
      FOREACH s IN ARRAY NEW.serial_numbers LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'available' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes
        ) VALUES (
          'good_out', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Auto-posted from Sales Invoice'
        );
      END LOOP;
    ELSIF NEW.product_id IS NOT NULL AND COALESCE(NEW.qty,0) > 0 THEN
      SELECT model, item_type INTO p_model, p_item_type
        FROM public.products WHERE id = NEW.product_id;
      IF COALESCE(p_item_type,'product') <> 'service' AND p_model IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            p_model, NEW.warehouse_id, 'good'::public.ims_stock_type, NEW.qty,
            'Invoice ' || COALESCE(inv_no,''), 'issued'::public.ims_stock_status, 'invoice',
            COALESCE(allow_neg, false)
          )
        LOOP
          sr := NULL;
          SELECT * INTO sr FROM public.ims_stock_items WHERE id = d.stock_item_id;
          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_party, qty, reference, notes
          ) VALUES (
            'good_out', d.stock_item_id, sr.part_name, sr.part_model_no, NULL, sr.oem,
            sr.warehouse_id, COALESCE(inv_party,'Customer'), d.qty_taken,
            'Invoice ' || COALESCE(inv_no,''), 'Auto-posted from Sales Invoice'
          );
        END LOOP;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    removed := ARRAY(SELECT unnest(COALESCE(OLD.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(NEW.serial_numbers,'{}')));
    added   := ARRAY(SELECT unnest(COALESCE(NEW.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(OLD.serial_numbers,'{}')));

    IF array_length(removed,1) > 0 THEN
      FOREACH s IN ARRAY removed LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'issued' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'available', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, reference, notes
        ) VALUES (
          'good_in', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Reversal: serial removed from Sales Invoice'
        );
      END LOOP;
    END IF;

    IF array_length(added,1) > 0 THEN
      FOREACH s IN ARRAY added LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'available' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes
        ) VALUES (
          'good_out', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Auto-posted from Sales Invoice'
        );
      END LOOP;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.serial_numbers IS NOT NULL AND array_length(OLD.serial_numbers,1) > 0 THEN
      FOREACH s IN ARRAY OLD.serial_numbers LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'issued' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'available', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, reference, notes
        ) VALUES (
          'good_in', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Reversal: invoice item deleted'
        );
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;

-- =====================================================================
-- SOURCE: 20260813093051_9f965449-0580-4506-9d75-dd7f3a340c1d.sql
-- =====================================================================
ALTER TABLE public.general_delivery_challans
  DROP CONSTRAINT IF EXISTS general_delivery_challans_status_check;
ALTER TABLE public.general_delivery_challans
  ADD CONSTRAINT general_delivery_challans_status_check
  CHECK (status = ANY (ARRAY['Draft'::text, 'Issued'::text, 'Converted'::text, 'Cancelled'::text]));

ALTER TABLE public.general_delivery_challans
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid;

-- Guard terminal states / legal transitions
CREATE OR REPLACE FUNCTION public.gdc_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IN ('Cancelled','Converted') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'General DC % is % — it is a terminal state and cannot change', OLD.dc_no, OLD.status;
  END IF;
  IF NEW.status = 'Cancelled' AND OLD.status <> 'Issued' THEN
    RAISE EXCEPTION 'Only an Issued General DC can be cancelled (current: %)', OLD.status;
  END IF;
  IF NEW.status = 'Cancelled' AND NULLIF(btrim(COALESCE(NEW.cancelled_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to cancel a General DC';
  END IF;
  IF NEW.status = 'Cancelled' AND OLD.status = 'Issued' THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    NEW.cancelled_by := COALESCE(NEW.cancelled_by, auth.uid());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gdc_guard_status ON public.general_delivery_challans;
CREATE TRIGGER trg_gdc_guard_status
  BEFORE UPDATE ON public.general_delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.gdc_guard_status();

-- Stock posting + reversal on cancel
CREATE OR REPLACE FUNCTION public.gdc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  it jsonb; s text; qty numeric; model text; part_name_v text;
  is_service boolean; sr public.ims_stock_items%ROWTYPE; d RECORD; r RECORD;
  wh uuid; party text; ref text;
BEGIN
  -- Reversal: Issued -> Cancelled restores every batch this DC consumed.
  IF TG_OP = 'UPDATE' AND NEW.status = 'Cancelled' AND OLD.status = 'Issued' THEN
    ref := 'GDC ' || COALESCE(OLD.dc_no,'');
    FOR r IN SELECT * FROM public.ims_stock_items WHERE transaction_ref = ref LOOP
      UPDATE public.ims_stock_items
         SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, qty, reference, notes, created_by
      ) VALUES (
        'good_in'::public.ims_txn_type, r.id, r.part_name, r.part_model_no, r.part_serial_no, r.oem,
        r.warehouse_id, r.qty, ref,
        'Reversal: General DC cancelled after issuing', COALESCE(NEW.cancelled_by, NEW.created_by)
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'Issued' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Issued' THEN RETURN NEW; END IF;
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

  party := COALESCE(NEW.customer_name, 'Customer');

  FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    model := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
    part_name_v := NULLIF(btrim(COALESCE(it->>'part_name','')), '');
    qty := COALESCE(NULLIF(it->>'qty','')::numeric, 0);
    wh := NULLIF(it->>'warehouse_id','')::uuid;
    IF qty <= 0 THEN CONTINUE; END IF;

    is_service := false;
    IF NULLIF(it->>'product_id','') IS NOT NULL THEN
      SELECT (item_type = 'service') INTO is_service FROM public.products WHERE id = (it->>'product_id')::uuid;
    END IF;
    IF COALESCE(is_service,false) THEN CONTINUE; END IF;

    IF COALESCE(jsonb_array_length(COALESCE(it->'serial_numbers','[]'::jsonb)),0) > 0 THEN
      FOR s IN SELECT jsonb_array_elements_text(it->'serial_numbers') LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
          WHERE part_serial_no = s AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF sr.id IS NULL THEN
          RAISE EXCEPTION 'Cannot issue %: serial "%" is not available in stock', NEW.dc_no, s;
        END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued'::public.ims_stock_status,
               transaction_ref = 'GDC ' || NEW.dc_no, updated_at = now()
         WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes, created_by
        ) VALUES (
          'good_out'::public.ims_txn_type, sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, party, 1, 'GDC ' || NEW.dc_no,
          'Auto-posted from General Delivery Challan', NEW.created_by
        );
      END LOOP;
    ELSIF model IS NOT NULL THEN
      FOR d IN SELECT * FROM public.ims_deduct_qty(
          model, wh, 'good'::public.ims_stock_type, qty,
          'GDC ' || COALESCE(NEW.dc_no,''), 'issued'::public.ims_stock_status,
          'General Delivery Challan', COALESCE(NEW.allow_negative_stock,false))
      LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items WHERE id = d.stock_item_id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes, created_by
        ) VALUES (
          'good_out'::public.ims_txn_type, d.stock_item_id,
          COALESCE(part_name_v, sr.part_name), COALESCE(model, sr.part_model_no), NULL, sr.oem,
          sr.warehouse_id, party, d.qty_taken, 'GDC ' || COALESCE(NEW.dc_no,''),
          'Auto-posted from General Delivery Challan', NEW.created_by
        );
      END LOOP;
    END IF;
  END LOOP;

  RETURN NEW;
END $function$;

-- Delete allowed only on Drafts, for admins or users with General DC delete rights
DROP POLICY IF EXISTS gdc_delete ON public.general_delivery_challans;
CREATE POLICY gdc_delete ON public.general_delivery_challans
  FOR DELETE TO authenticated
  USING (
    status = 'Draft'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'general_dc', 'delete'))
  );

INSERT INTO public.app_modules(key, label, sort_order)
VALUES ('general_dc', 'General DC', 26)
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- SOURCE: 20260814025156_f960171a-2d85-4310-af47-f61cd6f8e8d2.sql
-- =====================================================================
ALTER TABLE public.general_delivery_challans
  ADD COLUMN IF NOT EXISTS expected_return_date date,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_by uuid;

-- =====================================================================
-- SOURCE: 20260814030638_f4ee5181-0150-4e4b-8ced-ea911d87fa99.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.grn_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  cond TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  new_id UUID;
  serial_list TEXT[];
  s TEXT;
  remainder NUMERIC;
BEGIN
  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      cond       := lower(btrim(COALESCE(it->>'condition','')));
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      IF cond NOT IN ('good','defective','scrap') THEN
        RAISE EXCEPTION 'GRN %: line item "%" has an invalid or missing condition (%). Allowed values: Good, Defective, Scrap.',
          NEW.grn_no, COALESCE(part_name_v, model, '(unnamed)'), COALESCE(NULLIF(cond,''),'empty');
      END IF;

      IF cond = 'good' THEN
        target_type := 'good'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'good_in'::public.ims_txn_type;
      ELSIF cond = 'defective' THEN
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      ELSE
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'scrapped'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      END IF;

      IF jsonb_typeof(it->'serials') = 'array' THEN
        SELECT array_agg(btrim(x)) INTO serial_list
        FROM jsonb_array_elements_text(it->'serials') AS x
        WHERE btrim(x) <> '';
      ELSIF serial IS NOT NULL THEN
        SELECT array_agg(btrim(x)) INTO serial_list
        FROM unnest(string_to_array(serial, ',')) AS x
        WHERE btrim(x) <> '';
      ELSE
        serial_list := NULL;
      END IF;

      IF serial_list IS NOT NULL AND array_length(serial_list, 1) > 0 THEN
        FOREACH s IN ARRAY serial_list LOOP
          INSERT INTO public.ims_stock_items(
            oem, part_name, part_model_no, part_serial_no, warehouse_id,
            stock_type, stock_status, qty, transaction_ref, notes, created_by
          ) VALUES (
            oem_v, COALESCE(part_name_v,'(unnamed)'), model, s, NEW.warehouse_id,
            target_type, target_status, 1, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
          )
          ON CONFLICT (part_serial_no) DO UPDATE SET
            warehouse_id    = EXCLUDED.warehouse_id,
            stock_type      = EXCLUDED.stock_type,
            stock_status    = EXCLUDED.stock_status,
            qty             = 1,
            part_name       = COALESCE(EXCLUDED.part_name, public.ims_stock_items.part_name),
            part_model_no   = COALESCE(EXCLUDED.part_model_no, public.ims_stock_items.part_model_no),
            oem             = COALESCE(EXCLUDED.oem, public.ims_stock_items.oem),
            transaction_ref = EXCLUDED.transaction_ref,
            updated_at      = now()
          RETURNING id INTO new_id;

          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
          ) VALUES (
            txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, s, oem_v,
            NEW.warehouse_id,
            COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
            1, NEW.indent_id, 'GRN ' || NEW.grn_no,
            'Auto-posted from GRN submission', NEW.created_by
          );
        END LOOP;

        remainder := qty - array_length(serial_list, 1);
      ELSE
        remainder := qty;
      END IF;

      IF remainder > 0 THEN
        INSERT INTO public.ims_stock_items(
          oem, part_name, part_model_no, part_serial_no, warehouse_id,
          stock_type, stock_status, qty, transaction_ref, notes, created_by
        ) VALUES (
          oem_v, COALESCE(part_name_v,'(unnamed)'), model, NULL, NEW.warehouse_id,
          target_type, target_status, remainder, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
        ) RETURNING id INTO new_id;

        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
        ) VALUES (
          txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, NULL, oem_v,
          NEW.warehouse_id,
          COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
          remainder, NEW.indent_id, 'GRN ' || NEW.grn_no,
          'Auto-posted from GRN submission', NEW.created_by
        );
      END IF;
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available'::public.ims_stock_status;

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment'::public.ims_txn_type, 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END
$function$;

-- =====================================================================
-- SOURCE: 20260814092054_afba0cd3-205f-404a-ad51-141e573d5ddf.sql
-- =====================================================================
DROP POLICY IF EXISTS gdc_update ON public.general_delivery_challans;
CREATE POLICY gdc_update ON public.general_delivery_challans
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'general_dc', 'edit')
  OR created_by = auth.uid()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'general_dc', 'edit')
  OR created_by = auth.uid()
);

-- =====================================================================
-- SOURCE: 20260815084804_cc3cb075-bb7b-48c0-86a2-58431a986b24.sql
-- =====================================================================
ALTER TABLE public.defective_tags ADD COLUMN IF NOT EXISTS oem_case_id text;

-- =====================================================================
-- SOURCE: 20260816035635_f2ed1fc0-0f70-4b59-97c2-f6c75a360cd1.sql
-- =====================================================================
DELETE FROM public.defective_tags t
USING public.defective_tags k
WHERE lower(trim(coalesce(t.model_no,''))) = lower(trim(coalesce(k.model_no,'')))
  AND lower(trim(coalesce(t.serial_no,''))) = lower(trim(coalesce(k.serial_no,'')))
  AND trim(coalesce(t.serial_no,'')) <> ''
  AND (t.created_at, t.id) > (k.created_at, k.id);

CREATE UNIQUE INDEX IF NOT EXISTS defective_tags_unique_model_serial
  ON public.defective_tags (lower(trim(coalesce(model_no,''))), lower(trim(serial_no)))
  WHERE trim(coalesce(serial_no,'')) <> '';

-- =====================================================================
-- SOURCE: 20260816143950_a25659e2-da2a-46d3-a0db-bf0286f013bd.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  item_stock_type TEXT;
  is_posting_new BOOLEAN;
  was_posting_old BOOLEAN;
  out_status public.ims_stock_status;
  is_service BOOLEAN;
  d RECORD;
  rev RECORD;
BEGIN
  IF NEW.doc_type NOT IN ('customer','oem') THEN RETURN NEW; END IF;

  is_posting_new  := NEW.status IN ('Challan Generated','Submitted');
  was_posting_old := TG_OP = 'UPDATE' AND OLD.status IN ('Challan Generated','Submitted');

  IF is_posting_new AND (TG_OP = 'INSERT' OR NOT was_posting_old) THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      IF NEW.doc_type = 'oem' THEN
        serial := NULLIF(btrim(COALESCE(it->>'good_defective_serial','')), '');
      ELSE
        serial := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      END IF;
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      is_service := FALSE;
      IF NULLIF(it->>'product_id','') IS NOT NULL THEN
        SELECT (item_type = 'service') INTO is_service
          FROM public.products WHERE id = (it->>'product_id')::uuid;
      END IF;
      IF COALESCE(is_service, FALSE) THEN CONTINUE; END IF;

      IF NEW.doc_type = 'customer' THEN
        target_type := 'good'::public.ims_stock_type;
      ELSE
        item_stock_type := lower(btrim(COALESCE(it->>'stock_type','')));
        IF item_stock_type LIKE 'defect%' THEN
          target_type := 'defective'::public.ims_stock_type;
        ELSIF item_stock_type LIKE 'good%' THEN
          target_type := 'good'::public.ims_stock_type;
        ELSE
          target_type := 'defective'::public.ims_stock_type;
        END IF;
      END IF;

      txn_type_v := CASE WHEN target_type = 'good'::public.ims_stock_type
                         THEN 'good_out'::public.ims_txn_type
                         ELSE 'defective_out'::public.ims_txn_type END;

      out_status := CASE WHEN NEW.doc_type = 'oem'
                         THEN 'returned_to_oem'::public.ims_stock_status
                         ELSE 'issued'::public.ims_stock_status END;

      IF serial IS NOT NULL THEN
        stock_row := NULL;
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot post DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = out_status,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;

        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
        ) VALUES (
          txn_type_v, stock_row.id,
          COALESCE(part_name_v, stock_row.part_name),
          COALESCE(model, stock_row.part_model_no),
          serial, COALESCE(oem_v, stock_row.oem),
          stock_row.warehouse_id,
          COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
          qty, NEW.indent_id, 'DC ' || NEW.challan_no,
          'Auto-posted from Delivery Challan', NEW.created_by
        );

      ELSIF model IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            model, NULL, target_type, qty,
            'DC ' || COALESCE(NEW.challan_no,''), out_status,
            'DC ' || COALESCE(NEW.challan_no,''),
            (NEW.doc_type = 'customer' AND COALESCE(NEW.allow_negative_stock, false))
          )
        LOOP
          stock_row := NULL;
          SELECT * INTO stock_row FROM public.ims_stock_items WHERE id = d.stock_item_id;

          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
          ) VALUES (
            txn_type_v, d.stock_item_id,
            COALESCE(part_name_v, stock_row.part_name),
            COALESCE(model, stock_row.part_model_no),
            NULL, COALESCE(oem_v, stock_row.oem),
            stock_row.warehouse_id,
            COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
            d.qty_taken, NEW.indent_id, 'DC ' || NEW.challan_no,
            'Auto-posted from Delivery Challan', NEW.created_by
          );
        END LOOP;
      END IF;
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND was_posting_old AND NEW.status = 'Cancelled' THEN
    FOR rev IN
      SELECT * FROM public.ims_stock_items
       WHERE transaction_ref = 'DC ' || NEW.challan_no
         AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status)
    LOOP
      UPDATE public.ims_stock_items
         SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
       WHERE id = rev.id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        CASE WHEN rev.stock_type = 'good'::public.ims_stock_type
             THEN 'good_in'::public.ims_txn_type
             ELSE 'defective_in'::public.ims_txn_type END,
        rev.id, rev.part_name, rev.part_model_no, rev.part_serial_no, rev.oem,
        rev.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        rev.qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Reversal: DC cancelled after posting', NEW.created_by
      );
    END LOOP;
  END IF;

  RETURN NEW;
END $function$;

-- =====================================================================
-- SOURCE: 20260818092504_caa4f45e-bd36-4c2c-a2d7-88a432b86a92.sql
-- =====================================================================
ALTER TABLE public.quotations ADD COLUMN IF NOT EXISTS discount_label text DEFAULT 'Discount';

-- =====================================================================
-- SOURCE: 20260818123025_82d6ba4a-403a-4c25-ad73-f48894251938.sql
-- =====================================================================
DROP POLICY IF EXISTS "view employees" ON public.employees;
CREATE POLICY "view employees" ON public.employees FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_permission(auth.uid(),'employees','read'));

DROP POLICY IF EXISTS "view salary" ON public.salary_records;
CREATE POLICY "view salary" ON public.salary_records FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_permission(auth.uid(),'payroll','read'));

-- =====================================================================
-- SOURCE: 20260818133351_6b334631-b96c-451d-8c35-8619d707e00b.sql
-- =====================================================================
INSERT INTO public.app_modules (key, label, sort_order, supports_import, is_active)
VALUES ('accounts', 'Accounts', 90, false, true)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "view advances" ON public.employee_advances;
CREATE POLICY "employee_advances_read_permission" ON public.employee_advances
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'payroll'::text, 'read'::text));

DROP POLICY IF EXISTS "view ledger" ON public.accounts_ledger;
CREATE POLICY "accounts_ledger_read_permission" ON public.accounts_ledger
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'accounts'::text, 'read'::text));

DROP POLICY IF EXISTS "payments_read" ON public.payments_received;
CREATE POLICY "payments_received_read_permission" ON public.payments_received
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'sales'::text, 'read'::text) OR has_permission(auth.uid(), 'accounts'::text, 'read'::text));

DROP POLICY IF EXISTS "payment_allocations_read_auth" ON public.payment_allocations;
CREATE POLICY "payment_allocations_read_permission" ON public.payment_allocations
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'sales'::text, 'read'::text) OR has_permission(auth.uid(), 'accounts'::text, 'read'::text));

DROP POLICY IF EXISTS "advance_payments_select" ON public.advance_payments;
CREATE POLICY "advance_payments_read_permission" ON public.advance_payments
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'sales'::text, 'read'::text) OR has_permission(auth.uid(), 'accounts'::text, 'read'::text));

DROP POLICY IF EXISTS "invoices_read" ON public.invoices;
CREATE POLICY "invoices_read_permission" ON public.invoices
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'sales'::text, 'read'::text));

DROP POLICY IF EXISTS "view attendance" ON public.attendance;
CREATE POLICY "attendance_read_permission" ON public.attendance
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'payroll'::text, 'read'::text));

DROP POLICY IF EXISTS "view vendors" ON public.vendors;
CREATE POLICY "vendors_read_permission" ON public.vendors
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'po'::text, 'read'::text));

-- =====================================================================
-- SOURCE: 20260819094957_16b4f7ac-9e29-45bf-8532-4f7d02779479.sql
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_assignable_engineers()
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  department text,
  role text,
  active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, phone, department, role, active
  FROM public.employees
  WHERE active = true
  ORDER BY name;
$$;

CREATE OR REPLACE VIEW public.assignable_engineers AS
SELECT id, name, phone, department, role, active
FROM public.get_assignable_engineers();

GRANT SELECT ON public.assignable_engineers TO authenticated;
GRANT ALL ON public.assignable_engineers TO service_role;

-- =====================================================================
-- SOURCE: 20260819095130_4afc98bb-4ec0-4123-b384-6965ac141ba5.sql
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.get_assignable_engineers() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_assignable_engineers() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_assignable_engineers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_assignable_engineers() TO service_role;

-- =====================================================================
-- SOURCE: 20260819095637_174bd5dc-78b5-44d8-b2a8-90124e48c7e5.sql
-- =====================================================================
DROP VIEW IF EXISTS public.assignable_engineers;
DROP FUNCTION IF EXISTS public.get_assignable_engineers();

CREATE TABLE public.assignable_engineers (
    id UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT,
    department TEXT,
    role TEXT,
    active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO public.assignable_engineers (id, name, phone, department, role, active)
SELECT id, name, phone, department, role, active
FROM public.employees
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    department = EXCLUDED.department,
    role = EXCLUDED.role,
    active = EXCLUDED.active;

CREATE OR REPLACE FUNCTION public.sync_assignable_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.assignable_engineers (id, name, phone, department, role, active)
        VALUES (NEW.id, NEW.name, NEW.phone, NEW.department, NEW.role, COALESCE(NEW.active, true))
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name, phone = EXCLUDED.phone, department = EXCLUDED.department,
            role = EXCLUDED.role, active = EXCLUDED.active;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE public.assignable_engineers
        SET name = NEW.name, phone = NEW.phone, department = NEW.department, role = NEW.role,
            active = COALESCE(NEW.active, true)
        WHERE id = NEW.id;
        IF NOT FOUND THEN
            INSERT INTO public.assignable_engineers (id, name, phone, department, role, active)
            VALUES (NEW.id, NEW.name, NEW.phone, NEW.department, NEW.role, COALESCE(NEW.active, true));
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM public.assignable_engineers WHERE id = OLD.id;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_assignable_employee_insert
AFTER INSERT ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.sync_assignable_employee();

CREATE TRIGGER trg_sync_assignable_employee_update
AFTER UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.sync_assignable_employee();

CREATE TRIGGER trg_sync_assignable_employee_delete
AFTER DELETE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.sync_assignable_employee();

GRANT SELECT ON public.assignable_engineers TO authenticated;
GRANT ALL ON public.assignable_engineers TO service_role;

ALTER TABLE public.assignable_engineers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read assignable engineers"
ON public.assignable_engineers
FOR SELECT
TO authenticated
USING (true);

REVOKE EXECUTE ON FUNCTION public.sync_assignable_employee() FROM public;
GRANT EXECUTE ON FUNCTION public.sync_assignable_employee() TO service_role;

COMMENT ON TABLE public.assignable_engineers IS 'Read-only mirror of safe employee fields (id, name, phone, department, role, active) for ticket assignment and other non-HR workflows. Kept in sync via triggers on employees.';

-- =====================================================================
-- SOURCE: 20260819095729_78bf773c-2672-4610-a26b-148d7e4424d4.sql
-- =====================================================================
REVOKE EXECUTE ON FUNCTION public.sync_assignable_employee() FROM public;
REVOKE EXECUTE ON FUNCTION public.sync_assignable_employee() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_assignable_employee() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_assignable_employee() TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_assignable_employee() TO service_role;

-- =====================================================================
-- SOURCE: 20260819095801_8a16cb24-8d5c-416a-88e9-618e179c2797.sql
-- =====================================================================
DO $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.employees (name, active, department, phone, role) 
    VALUES ('__TEST_TRIGGER_ASSIGNABLE__', true, 'Test', '0000000000', 'technician')
    RETURNING id INTO v_id;
    
    IF NOT EXISTS (SELECT 1 FROM public.assignable_engineers WHERE id = v_id) THEN
        RAISE EXCEPTION 'Trigger did not sync row to assignable_engineers';
    END IF;
    
    DELETE FROM public.employees WHERE id = v_id;
    
    IF EXISTS (SELECT 1 FROM public.assignable_engineers WHERE id = v_id) THEN
        RAISE EXCEPTION 'Trigger did not delete row from assignable_engineers';
    END IF;
END $$;

-- =====================================================================
-- SOURCE: 20260819105756_3d4833ae-2f98-4160-ba8c-85b98e3c7f1a.sql
-- =====================================================================
DROP POLICY IF EXISTS "vendors_read_permission" ON public.vendors;
CREATE POLICY "vendors_read_all_authenticated" ON public.vendors FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;

-- =====================================================================
-- SOURCE: 20260819135724_e80448ca-5569-40da-9688-30e1a83bfa96.sql
-- =====================================================================
UPDATE public.indents i
SET oracles_data = (
  SELECT jsonb_agg(
    CASE WHEN o->>'oracle_no' = '41208103'
      THEN (o - 'force_closed' - 'force_close_reason' - 'closed_by' - 'closed_by_name' - 'closed_at') || '{"status":"open"}'::jsonb
      ELSE o END
  )
  FROM jsonb_array_elements(i.oracles_data) o
)
WHERE i.id = 'f1354c89-53e3-4149-ac90-dadb9df803b3';

-- =====================================================================
-- SOURCE: 20260820120547_e33c7402-d78b-45f4-bea4-a845c9aa65b3.sql
-- =====================================================================
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

-- =====================================================================
-- SOURCE: 20260820130911_24768d38-bbdd-419f-a9d3-fdb887ff0ef1.sql
-- =====================================================================
ALTER TABLE public.installed_equipment ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS installed_equipment_product_id_idx ON public.installed_equipment(product_id);

-- ============================================================================
-- APPENDIX - STORAGE BUCKETS
-- ----------------------------------------------------------------------------
-- These buckets were previously created through the Supabase Dashboard (not in
-- migrations). All three are PRIVATE buckets - access is granted via the RLS
-- policies on storage.objects that were created in the migrations above.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('ticket-attachments', 'ticket-attachments', false, 10485760, NULL),   -- 10 MB
  ('amc-agreements',     'amc-agreements',     false, 20971520, NULL),   -- 20 MB
  ('oem-logos',          'oem-logos',          false, 5242880,  NULL)    -- 5 MB
ON CONFLICT (id) DO NOTHING;
