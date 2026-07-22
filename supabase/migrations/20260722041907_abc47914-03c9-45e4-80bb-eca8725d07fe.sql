
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
