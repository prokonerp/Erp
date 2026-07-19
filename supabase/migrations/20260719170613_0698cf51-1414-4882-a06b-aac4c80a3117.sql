
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
