-- ============================================================================
-- Data-import preparation: disable triggers + reset data tables.
-- ----------------------------------------------------------------------------
-- History data must be imported AS-IS (the old DB already reflects all stock
-- posting / sync side effects). Without disabling triggers, inserts like GRNs
-- re-run stock posting and create rows with NEW ids, which breaks FK chains
-- for the imported history (seen with ims_stock_items / ims_transactions).
--
-- The four provisioned tables (app_roles, role_module_permissions, app_users,
-- user_roles) are preserved — they were set up for the new project already.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public'
             AND tablename NOT IN ('app_roles', 'role_module_permissions', 'app_users', 'user_roles')
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public'
             AND tablename NOT IN ('app_roles', 'role_module_permissions', 'app_users', 'user_roles')
  LOOP
    EXECUTE format('TRUNCATE TABLE public.%I CASCADE', t);
  END LOOP;
END $$;