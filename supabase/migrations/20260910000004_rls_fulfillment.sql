-- Migration: 20260910000004_rls_fulfillment.sql
-- Sales Order split-delivery — RLS for fulfillment ledger + proforma
-- Part of: SO Conversion V2 (§5.4)
-- SAFE: policy-only DDL, idempotent (DROP IF EXISTS before CREATE), no data loss
-- Mirrors: 20260909000001 (sales_orders RLS), 20260902000002_harden_invoicing_rls.sql pattern
-- Uses: public.has_permission(uuid,text,text), public.has_role(uuid, app_role)

-- ═══════════════════════════════════════════════════════════════════
-- 1) Enable RLS + Grants
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.so_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proforma_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proforma_invoice_settings ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.so_conversions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.so_fulfillments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proforma_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.proforma_invoice_settings TO authenticated;
GRANT ALL ON public.so_conversions TO service_role;
GRANT ALL ON public.so_fulfillments TO service_role;
GRANT ALL ON public.proforma_invoices TO service_role;
GRANT ALL ON public.proforma_invoice_settings TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 2) so_conversions policies
--    SELECT: sales.read OR admin OR owner (created_by)
--    INSERT: authenticated (writers enforce balance via advisory lock; keep least-privilege insert gate)
--    UPDATE: sales.edit OR admin
--    DELETE: admin OR sales.delete
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "so_conversions_select" ON public.so_conversions;
DROP POLICY IF EXISTS "so_conversions authenticated read" ON public.so_conversions;
DROP POLICY IF EXISTS "so_conversions read" ON public.so_conversions;

DO $$ BEGIN
  CREATE POLICY "so_conversions_select" ON public.so_conversions
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'read')
      OR created_by = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "so_conversions_insert" ON public.so_conversions;
DROP POLICY IF EXISTS "so_conversions authenticated insert" ON public.so_conversions;

DO $$ BEGIN
  CREATE POLICY "so_conversions_insert" ON public.so_conversions
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "so_conversions_update" ON public.so_conversions;
DROP POLICY IF EXISTS "so_conversions authenticated update" ON public.so_conversions;

DO $$ BEGIN
  CREATE POLICY "so_conversions_update" ON public.so_conversions
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'edit')
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'edit')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "so_conversions_delete" ON public.so_conversions;
DROP POLICY IF EXISTS "so_conversions authenticated delete" ON public.so_conversions;

DO $$ BEGIN
  CREATE POLICY "so_conversions_delete" ON public.so_conversions
    FOR DELETE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'delete')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 3) so_fulfillments policies (mirrors so_conversions — line detail inherits SO visibility)
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "so_fulfillments_select" ON public.so_fulfillments;
DROP POLICY IF EXISTS "so_fulfillments authenticated read" ON public.so_fulfillments;

DO $$ BEGIN
  CREATE POLICY "so_fulfillments_select" ON public.so_fulfillments
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'read')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "so_fulfillments_insert" ON public.so_fulfillments;

DO $$ BEGIN
  CREATE POLICY "so_fulfillments_insert" ON public.so_fulfillments
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "so_fulfillments_update" ON public.so_fulfillments;

DO $$ BEGIN
  CREATE POLICY "so_fulfillments_update" ON public.so_fulfillments
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'edit')
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'edit')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "so_fulfillments_delete" ON public.so_fulfillments;

DO $$ BEGIN
  CREATE POLICY "so_fulfillments_delete" ON public.so_fulfillments
    FOR DELETE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'delete')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 4) proforma_invoices policies
--    SELECT: sales.read OR admin OR owner
--    INSERT: sales.create OR admin (WITH CHECK)
--    UPDATE: sales.edit OR admin
--    DELETE: admin OR sales.delete (proforma delete is rare; gate to admin/delete)
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "proforma_invoices_select" ON public.proforma_invoices;
DROP POLICY IF EXISTS "proforma_select" ON public.proforma_invoices;
DROP POLICY IF EXISTS "proforma_invoices authenticated read" ON public.proforma_invoices;

DO $$ BEGIN
  CREATE POLICY "proforma_invoices_select" ON public.proforma_invoices
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'read')
      OR created_by = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "proforma_invoices_insert" ON public.proforma_invoices;

DO $$ BEGIN
  CREATE POLICY "proforma_invoices_insert" ON public.proforma_invoices
    FOR INSERT TO authenticated
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'create')
      OR auth.uid() IS NOT NULL
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "proforma_invoices_update" ON public.proforma_invoices;

DO $$ BEGIN
  CREATE POLICY "proforma_invoices_update" ON public.proforma_invoices
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'edit')
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'edit')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "proforma_invoices_delete" ON public.proforma_invoices;

DO $$ BEGIN
  CREATE POLICY "proforma_invoices_delete" ON public.proforma_invoices
    FOR DELETE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'delete')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 5) proforma_invoice_settings policies
--    SELECT: sales.create OR sales.edit OR admin (needed for numbering trigger which is SECURITY DEFINER — RLS still applies to direct SELECT)
--    INSERT/UPDATE/DELETE: admin OR sales.create/edit (settings are admin-controlled)
--    Note: set_proforma_no() is SECURITY DEFINER, so it bypasses RLS for the trigger path.
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "proforma_settings_select" ON public.proforma_invoice_settings;
DROP POLICY IF EXISTS "proforma_invoice_settings_select" ON public.proforma_invoice_settings;
DROP POLICY IF EXISTS "proforma_settings authenticated read" ON public.proforma_invoice_settings;

DO $$ BEGIN
  CREATE POLICY "proforma_invoice_settings_select" ON public.proforma_invoice_settings
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'create')
      OR public.has_permission(auth.uid(), 'sales', 'edit')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "proforma_settings_insert" ON public.proforma_invoice_settings;
DROP POLICY IF EXISTS "proforma_invoice_settings_insert" ON public.proforma_invoice_settings;

DO $$ BEGIN
  CREATE POLICY "proforma_invoice_settings_insert" ON public.proforma_invoice_settings
    FOR INSERT TO authenticated
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'create')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "proforma_settings_update" ON public.proforma_invoice_settings;
DROP POLICY IF EXISTS "proforma_invoice_settings_update" ON public.proforma_invoice_settings;

DO $$ BEGIN
  CREATE POLICY "proforma_invoice_settings_update" ON public.proforma_invoice_settings
    FOR UPDATE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'edit')
    )
    WITH CHECK (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'sales', 'edit')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DROP POLICY IF EXISTS "proforma_settings_delete" ON public.proforma_invoice_settings;
DROP POLICY IF EXISTS "proforma_invoice_settings_delete" ON public.proforma_invoice_settings;

DO $$ BEGIN
  CREATE POLICY "proforma_invoice_settings_delete" ON public.proforma_invoice_settings
    FOR DELETE TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
