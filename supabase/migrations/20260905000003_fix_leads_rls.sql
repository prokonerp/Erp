-- 20260905000003_fix_leads_rls.sql
-- Fix leads RLS to respect owner_id OR assigned_to OR admin

-- Ensure assignment / acknowledgement columns exist (added via dashboard, make idempotent)
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS assigned_by uuid,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS assignment_status text;

-- Drop legacy boolean 'acknowledged' if it was created (column doesn't exist per spec; sync types)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='leads' AND column_name='acknowledged'
  ) THEN
    ALTER TABLE public.leads DROP COLUMN acknowledged;
  END IF;
END $$;

-- Recreate RLS policies with assigned_to support
DROP POLICY IF EXISTS "own leads select" ON public.leads;
CREATE POLICY "own leads select" ON public.leads
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "own leads insert" ON public.leads;
CREATE POLICY "own leads insert" ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "own leads update" ON public.leads;
CREATE POLICY "own leads update" ON public.leads
  FOR UPDATE TO authenticated
  USING (
    owner_id = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "own leads delete" ON public.leads;
CREATE POLICY "own leads delete" ON public.leads
  FOR DELETE TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- Lead activities already hardened to owner/assignee/admin; keep but ensure recreation is idempotent
DROP POLICY IF EXISTS "lead act select owner assignee or admin" ON public.lead_activities;
CREATE POLICY "lead act select owner assignee or admin" ON public.lead_activities
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_activities.lead_id
        AND (l.owner_id = auth.uid() OR l.assigned_to = auth.uid())
    )
  );
