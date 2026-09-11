-- Harden ticket verification RLS: replace USING(true) with permission-gated policies.
-- Design: permission-based (NOT auth.uid join) — employees.auth_user_id has no backfill.
-- Safe to re-run. Existing rows unaffected.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_permission') THEN
    RAISE NOTICE 'harden_ticket_verifications_rls: helpers missing — skipping';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "auth view tcv" ON public.ticket_customer_verifications;
  CREATE POLICY "auth view tcv" ON public.ticket_customer_verifications
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'read')
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth insert tcv" ON public.ticket_customer_verifications;
  CREATE POLICY "auth insert tcv" ON public.ticket_customer_verifications
    FOR INSERT TO authenticated
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth update tcv" ON public.ticket_customer_verifications;
  CREATE POLICY "auth update tcv" ON public.ticket_customer_verifications
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth delete tcv" ON public.ticket_customer_verifications;
  CREATE POLICY "auth delete tcv" ON public.ticket_customer_verifications
    FOR DELETE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));

  DROP POLICY IF EXISTS "auth view tev" ON public.ticket_equipment_verifications;
  CREATE POLICY "auth view tev" ON public.ticket_equipment_verifications
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'read')
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth insert tev" ON public.ticket_equipment_verifications;
  CREATE POLICY "auth insert tev" ON public.ticket_equipment_verifications
    FOR INSERT TO authenticated
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth update tev" ON public.ticket_equipment_verifications;
  CREATE POLICY "auth update tev" ON public.ticket_equipment_verifications
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'tickets', 'create')
    );

  DROP POLICY IF EXISTS "auth delete tev" ON public.ticket_equipment_verifications;
  CREATE POLICY "auth delete tev" ON public.ticket_equipment_verifications
    FOR DELETE TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
END $$;
