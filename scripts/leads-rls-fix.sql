-- scripts/leads-rls-fix.sql
-- PROKON ERP — Apply the missing policy section of
-- supabase/migrations/20260905000003_fix_leads_rls.sql (columns already live).
--
-- HOW TO RUN: paste the whole file into the Supabase SQL Editor and Run.
-- SAFE: DROP POLICY IF EXISTS + CREATE POLICY only (no data touches).
-- Idempotent — safe to re-run.
--
-- WHY: live still enforces the old owner-only policies from the snapshot
-- bootstrap, so admins/assignees see 0 leads (39 exist). After this, admins
-- see all 39 via the has_role() bypass, owners/assignees see theirs.

DROP POLICY IF EXISTS "own leads select" ON public.leads;
CREATE POLICY "own leads select" ON public.leads
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR assigned_to = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

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

-- ── Verification: expect 1 row per recreated policy (INSERT policy stays
-- owner-only by design) ──
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('leads', 'lead_activities')
ORDER BY tablename, cmd, policyname;
