-- 20260930000003_quotations_update_permission.sql
-- Prokon ERP — let users with quotations:edit permission revise quotations
-- they do not own.
--
-- Root cause of "Revision conflict" on EVERY revise: the supersede UPDATE on
-- the predecessor quotation is restricted to the row owner
-- (policy "own q update": USING (owner_id = auth.uid())), while the list/SELECT
-- path is permission-based ("quotations_select_with_permission" allows
-- has_permission(uid,'quotations','read')). For any quotation the revising
-- user did not create, the UPDATE matches 0 rows and the app's atomic guard
-- misreports a race ("another revision was created first") and rolls back.
--
-- This adds a permissive UPDATE policy for the edit permission, which ORs
-- with the existing owner policy (RLS permissive policies are additive) and
-- mirrors the existing SELECT policy. Ownership can still revise their own
-- rows exactly as before.
--
-- AUTHOR ONLY — the harness must never push to Supabase. A human runs this
-- in the Supabase SQL editor. RLS policy changes take effect immediately
-- (no PostgREST schema-cache reload needed).
--
-- Verify after running (expect 1 row: the new policy):
--   SELECT policyname, cmd FROM pg_policies
--   WHERE schemaname = 'public' AND tablename = 'quotations' AND cmd = 'UPDATE';

DROP POLICY IF EXISTS "quotations_update_with_edit_permission" ON public.quotations;

CREATE POLICY "quotations_update_with_edit_permission"
ON public.quotations
FOR UPDATE
TO authenticated
USING (public.has_permission(auth.uid(), 'quotations', 'edit'))
WITH CHECK (public.has_permission(auth.uid(), 'quotations', 'edit'));
