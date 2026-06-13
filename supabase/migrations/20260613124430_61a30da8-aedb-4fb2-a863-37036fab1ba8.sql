
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
