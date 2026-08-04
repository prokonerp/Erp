CREATE TABLE public.customer_sites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL,
  address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_sites TO authenticated;
GRANT ALL ON public.customer_sites TO service_role;

ALTER TABLE public.customer_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_sites_read_permission" ON public.customer_sites
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_permission(auth.uid(), 'customers', 'read')
    OR public.has_permission(auth.uid(), 'sales', 'read')
  );

CREATE POLICY "auth insert customer_sites" ON public.customer_sites
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth update customer_sites" ON public.customer_sites
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "auth delete customer_sites" ON public.customer_sites
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE INDEX customer_sites_customer_idx ON public.customer_sites(customer_id);

CREATE TRIGGER trg_customer_sites_touch BEFORE UPDATE ON public.customer_sites
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.serials
  ADD COLUMN site_id UUID REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  ADD COLUMN warranty_override BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX serials_customer_idx ON public.serials(customer_id);
CREATE INDEX serials_site_idx ON public.serials(site_id);