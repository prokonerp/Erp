-- ============================================================================
-- Data-import completion: re-enable all triggers.
-- Run AFTER scripts/import-data.mjs has finished importing the history data.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables
           WHERE schemaname = 'public'
             AND tablename NOT IN ('app_roles', 'role_module_permissions', 'app_users', 'user_roles')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP;
END $$;