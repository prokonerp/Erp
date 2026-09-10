-- 20260911000001_fix_proforma_rls_tautology.sql
-- FIX: proforma_invoices INSERT policy had `OR auth.uid() IS NOT NULL` which
--      makes the permission check tautological — any authenticated user could
--      insert proformas regardless of has_role/has_permission.
--      Removing the tautology so only admin OR sales.create can insert.
--
-- SAFE: Idempotent. DROP POLICY IF EXISTS + CREATE POLICY inside DO block.
--       No data deleted. Only DDL (policy definition) changed.
--       Existing rows unaffected — RLS only gates future writes.

-- ── proforma_invoices: fix INSERT policy ──────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='proforma_invoices') THEN
    -- Drop the tautological policy (name matches 20260910000004)
    EXECUTE 'DROP POLICY IF EXISTS "proforma_invoices_insert" ON public.proforma_invoices';

    -- Recreate WITHOUT the `OR auth.uid() IS NOT NULL` fallback
    EXECUTE $q$
      CREATE POLICY "proforma_invoices_insert" ON public.proforma_invoices
        FOR INSERT TO authenticated
        WITH CHECK (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'sales', 'create')
        )
    $q$;

    RAISE NOTICE 'proforma_invoices_insert: removed auth.uid() IS NOT NULL tautology';
  ELSE
    RAISE NOTICE 'proforma_invoices table not found — skipping';
  END IF;
END $$;
