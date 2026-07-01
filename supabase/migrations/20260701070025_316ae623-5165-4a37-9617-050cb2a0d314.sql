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