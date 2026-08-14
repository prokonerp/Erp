DROP POLICY IF EXISTS gdc_update ON public.general_delivery_challans;
CREATE POLICY gdc_update ON public.general_delivery_challans
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'general_dc', 'edit')
  OR created_by = auth.uid()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'general_dc', 'edit')
  OR created_by = auth.uid()
);