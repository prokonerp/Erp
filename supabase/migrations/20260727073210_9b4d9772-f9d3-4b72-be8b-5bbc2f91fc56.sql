GRANT SELECT ON public.crm_settings TO authenticated;
GRANT ALL ON public.crm_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_terms_templates TO authenticated;
GRANT ALL ON public.quote_terms_templates TO service_role;