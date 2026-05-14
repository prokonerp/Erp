
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
