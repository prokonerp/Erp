
-- 1. Remove claim-first-admin escalation
DROP POLICY IF EXISTS "claim first admin" ON public.user_roles;

-- 2. Enable RLS on sequence tables; no policies = denied for authenticated/anon; service_role bypasses
ALTER TABLE public.indent_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ims_transfer_sequence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ims_txn_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.indent_sequence FROM anon, authenticated;
REVOKE ALL ON public.ims_transfer_sequence FROM anon, authenticated;
REVOKE ALL ON public.ims_txn_sequence FROM anon, authenticated;
GRANT ALL ON public.indent_sequence TO service_role;
GRANT ALL ON public.ims_transfer_sequence TO service_role;
GRANT ALL ON public.ims_txn_sequence TO service_role;

-- 3. Password history: revoke direct writes from authenticated; only service_role writes
REVOKE INSERT, UPDATE, DELETE ON public.password_history FROM authenticated, anon;
GRANT ALL ON public.password_history TO service_role;

-- 4. Storage: allow authenticated to update/delete ticket attachments
CREATE POLICY "Authenticated update ticket attachments"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'ticket-attachments')
  WITH CHECK (bucket_id = 'ticket-attachments');
CREATE POLICY "Authenticated delete ticket attachments"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'ticket-attachments');

-- 5. Replace USING(true)/WITH CHECK(true) on non-SELECT policies with auth.uid() IS NOT NULL
DO $$
DECLARE
  r record;
  using_clause text;
  check_clause text;
  cmd_text text;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname, p.polname, p.polcmd,
           pg_get_expr(p.polqual, p.polrelid) AS qual,
           pg_get_expr(p.polwithcheck, p.polrelid) AS wcheck
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND p.polcmd <> 'r'  -- skip SELECT
       AND (pg_get_expr(p.polqual, p.polrelid) = 'true'
            OR pg_get_expr(p.polwithcheck, p.polrelid) = 'true')
  LOOP
    cmd_text := CASE r.polcmd WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' WHEN '*' THEN 'ALL' END;
    EXECUTE format('DROP POLICY %I ON %I.%I', r.polname, r.nspname, r.relname);

    using_clause := CASE WHEN r.qual IS NULL THEN '' ELSE ' USING (auth.uid() IS NOT NULL)' END;
    check_clause := CASE WHEN r.wcheck IS NULL THEN '' ELSE ' WITH CHECK (auth.uid() IS NOT NULL)' END;

    EXECUTE format('CREATE POLICY %I ON %I.%I FOR %s TO authenticated%s%s',
                   r.polname, r.nspname, r.relname, cmd_text, using_clause, check_clause);
  END LOOP;
END $$;
