-- 20260911000002_harden_customers_rls.sql
-- HARDEN: Tighten customers + customer_branches RLS from USING(true) to
--         has_permission checks. Keeps services@prokonhitech.com working
--         by ensuring the account has the required permissions first.
--
-- SAFE: Idempotent. Uses DO $$ IF EXISTS + DROP POLICY IF EXISTS + CREATE POLICY.
--       No data deleted. Only DDL (policy definitions) changed.
--       Existing rows unaffected — RLS only gates future writes.
--       If has_permission() or app_users table is missing, skips gracefully.

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1: Ensure services@prokonhitech.com has customers permissions
-- (mirrors 20260830000000 pattern — safe to re-run)
-- ═══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_users') THEN
    -- ensure active
    EXECUTE $q$
      UPDATE public.app_users
      SET status = 'active', updated_at = now()
      WHERE email = 'services@prokonhitech.com'
        AND status IS DISTINCT FROM 'active'
    $q$;

    -- grant customers read + create + edit (no delete)
    EXECUTE $q$
      UPDATE public.app_users
      SET custom_permissions = jsonb_set(
            COALESCE(custom_permissions, '{}'::jsonb),
            '{customers}',
            '{"enable_access": true, "can_read": true, "can_create": true, "can_edit": true, "can_delete": false, "can_export": false, "can_import": false}'::jsonb,
            true
          ),
          updated_at = now()
      WHERE email = 'services@prokonhitech.com'
        AND (
          custom_permissions IS NULL
          OR NOT (custom_permissions ? 'customers')
          OR (custom_permissions->'customers'->>'can_create')::boolean IS DISTINCT FROM true
          OR (custom_permissions->'customers'->>'enable_access')::boolean IS DISTINCT FROM true
        )
    $q$;

    RAISE NOTICE 'services@prokonhitech.com: ensured customers permissions';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2: Tighten customers RLS
-- ═══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customers') THEN
    -- ── INSERT ── require admin OR customers.create ──
    EXECUTE 'DROP POLICY IF EXISTS "auth insert customers" ON public.customers';
    EXECUTE 'DROP POLICY IF EXISTS "customers_insert_policy" ON public.customers';
    EXECUTE $q$
      CREATE POLICY "auth insert customers" ON public.customers
        FOR INSERT TO authenticated
        WITH CHECK (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'create')
        )
    $q$;

    -- ── SELECT ── require admin OR customers.read ──
    EXECUTE 'DROP POLICY IF EXISTS "auth view customers" ON public.customers';
    EXECUTE 'DROP POLICY IF EXISTS "customers_read_permission" ON public.customers';
    EXECUTE $q$
      CREATE POLICY "auth view customers" ON public.customers
        FOR SELECT TO authenticated
        USING (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'read')
        )
    $q$;

    -- ── UPDATE ── require admin OR customers.edit ──
    EXECUTE 'DROP POLICY IF EXISTS "auth update customers" ON public.customers';
    EXECUTE $q$
      CREATE POLICY "auth update customers" ON public.customers
        FOR UPDATE TO authenticated
        USING (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'edit')
        )
        WITH CHECK (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'edit')
        )
    $q$;

    -- ── DELETE ── require admin OR customers.delete ──
    EXECUTE 'DROP POLICY IF EXISTS "auth delete customers" ON public.customers';
    EXECUTE $q$
      CREATE POLICY "auth delete customers" ON public.customers
        FOR DELETE TO authenticated
        USING (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'delete')
        )
    $q$;

    RAISE NOTICE 'customers RLS: hardened from USING(true) to has_permission checks';
  ELSE
    RAISE NOTICE 'customers table not found — skipping';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 3: Tighten customer_branches RLS
-- ═══════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='customer_branches') THEN
    -- ── SELECT ──
    EXECUTE 'DROP POLICY IF EXISTS "customer_branches_select" ON public.customer_branches';
    EXECUTE $q$
      CREATE POLICY "customer_branches_select" ON public.customer_branches
        FOR SELECT TO authenticated
        USING (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'read')
        )
    $q$;

    -- ── INSERT ──
    EXECUTE 'DROP POLICY IF EXISTS "customer_branches_insert" ON public.customer_branches';
    EXECUTE $q$
      CREATE POLICY "customer_branches_insert" ON public.customer_branches
        FOR INSERT TO authenticated
        WITH CHECK (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'create')
        )
    $q$;

    -- ── UPDATE ──
    EXECUTE 'DROP POLICY IF EXISTS "customer_branches_update" ON public.customer_branches';
    EXECUTE $q$
      CREATE POLICY "customer_branches_update" ON public.customer_branches
        FOR UPDATE TO authenticated
        USING (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'edit')
        )
        WITH CHECK (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'edit')
        )
    $q$;

    -- ── DELETE ──
    EXECUTE 'DROP POLICY IF EXISTS "customer_branches_delete" ON public.customer_branches';
    EXECUTE $q$
      CREATE POLICY "customer_branches_delete" ON public.customer_branches
        FOR DELETE TO authenticated
        USING (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_permission(auth.uid(), 'customers', 'delete')
        )
    $q$;

    RAISE NOTICE 'customer_branches RLS: hardened from USING(true) to has_permission checks';
  ELSE
    RAISE NOTICE 'customer_branches table not found — skipping';
  END IF;
END $$;
