DROP POLICY IF EXISTS "Owner or admin update delivery_challans" ON public.delivery_challans;
CREATE POLICY "Authenticated update delivery_challans"
  ON public.delivery_challans
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);