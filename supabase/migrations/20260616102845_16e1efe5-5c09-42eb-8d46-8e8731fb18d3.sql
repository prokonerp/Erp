
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
