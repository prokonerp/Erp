
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
