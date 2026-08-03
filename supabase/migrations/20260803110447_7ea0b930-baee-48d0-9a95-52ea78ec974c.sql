DROP POLICY IF EXISTS "own act select" ON public.lead_activities;

CREATE POLICY "lead act select owner assignee or admin"
ON public.lead_activities
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = lead_activities.lead_id
      AND (l.owner_id = auth.uid() OR l.assigned_to = auth.uid())
  )
);