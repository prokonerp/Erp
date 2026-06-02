
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
