
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
