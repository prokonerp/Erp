DROP POLICY IF EXISTS "quotations_insert_own_with_permission" ON public.quotations;

CREATE POLICY "quotations_insert_own_with_permission"
ON public.quotations
FOR INSERT
TO authenticated
WITH CHECK (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'access')
);