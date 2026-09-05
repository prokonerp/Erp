-- 20260905000001_fix_ticket_rls.sql
-- Harden tickets RLS: replace USING(true) / weak owner checks with admin OR tickets edit/delete permission
-- Similar to 20260829000002_harden_rls_permissions.sql intention

-- Update policy: restrict to admin or tickets edit permission
DROP POLICY IF EXISTS "auth update tickets" ON public.tickets;
CREATE POLICY "auth update tickets" ON public.tickets
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'edit')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'edit')
  );

-- Delete policy: restrict to admin or tickets delete permission
DROP POLICY IF EXISTS "Admin only hard delete tickets" ON public.tickets;
DROP POLICY IF EXISTS "Creator or admin delete tickets" ON public.tickets;
DROP POLICY IF EXISTS "auth delete tickets" ON public.tickets;
CREATE POLICY "auth delete tickets" ON public.tickets
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'delete')
  );

-- Insert already hardened in 20260829000002; ensure it stays strict
DROP POLICY IF EXISTS "auth insert tickets" ON public.tickets;
CREATE POLICY "auth insert tickets" ON public.tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'create')
  );
