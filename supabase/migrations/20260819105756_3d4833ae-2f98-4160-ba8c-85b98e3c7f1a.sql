DROP POLICY IF EXISTS "vendors_read_permission" ON public.vendors;
CREATE POLICY "vendors_read_all_authenticated" ON public.vendors FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;