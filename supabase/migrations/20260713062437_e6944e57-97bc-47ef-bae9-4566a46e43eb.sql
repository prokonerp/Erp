
DROP POLICY IF EXISTS grns_update ON public.grns;
DROP POLICY IF EXISTS grns_delete ON public.grns;

CREATE POLICY grns_update ON public.grns
  FOR UPDATE TO authenticated
  USING ((auth.uid() = created_by) OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((auth.uid() = created_by) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY grns_delete ON public.grns
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
