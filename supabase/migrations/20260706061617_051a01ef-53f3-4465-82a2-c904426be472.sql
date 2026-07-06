
-- Tighten UPDATE policies on tickets, amcs, indents to require module edit permission or admin
DROP POLICY IF EXISTS "auth update tickets" ON public.tickets;
CREATE POLICY "auth update tickets" ON public.tickets
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'tickets', 'edit')
  OR created_by = auth.uid()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'tickets', 'edit')
  OR created_by = auth.uid()
);

DROP POLICY IF EXISTS "Authenticated can update amcs" ON public.amcs;
CREATE POLICY "Authenticated can update amcs" ON public.amcs
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'amc', 'edit')
  OR created_by = auth.uid()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'amc', 'edit')
  OR created_by = auth.uid()
);

DROP POLICY IF EXISTS "auth update indents" ON public.indents;
CREATE POLICY "auth update indents" ON public.indents
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'indent', 'edit')
  OR created_by = auth.uid()
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR public.has_permission(auth.uid(), 'indent', 'edit')
  OR created_by = auth.uid()
);

-- Restrict user_roles SELECT to own row or admins
DROP POLICY IF EXISTS "view roles" ON public.user_roles;
CREATE POLICY "view roles" ON public.user_roles
FOR SELECT TO authenticated
USING (
  user_id = auth.uid() OR public.has_role(auth.uid(), 'admin')
);

-- Storage: amc-agreements requires amc module permission
DROP POLICY IF EXISTS "Authenticated can read amc agreements" ON storage.objects;
CREATE POLICY "Authenticated can read amc agreements" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'read'))
);

DROP POLICY IF EXISTS "Authenticated can update amc agreements" ON storage.objects;
CREATE POLICY "Authenticated can update amc agreements" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'edit'))
)
WITH CHECK (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'edit'))
);

DROP POLICY IF EXISTS "Authenticated can delete amc agreements" ON storage.objects;
CREATE POLICY "Authenticated can delete amc agreements" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'delete') OR public.has_permission(auth.uid(), 'amc', 'edit'))
);

-- Also ensure INSERT is scoped (upload uses user-side supabase client)
DROP POLICY IF EXISTS "Authenticated can insert amc agreements" ON storage.objects;
CREATE POLICY "Authenticated can insert amc agreements" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'amc-agreements'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'amc', 'edit') OR public.has_permission(auth.uid(), 'amc', 'create'))
);

-- Storage: ticket-attachments requires tickets module permission
DROP POLICY IF EXISTS "Authenticated can read ticket attachments" ON storage.objects;
CREATE POLICY "Authenticated can read ticket attachments" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'tickets', 'read'))
);

DROP POLICY IF EXISTS "Authenticated update ticket attachments" ON storage.objects;
CREATE POLICY "Authenticated update ticket attachments" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'tickets', 'edit'))
)
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'tickets', 'edit'))
);

DROP POLICY IF EXISTS "Authenticated delete ticket attachments" ON storage.objects;
CREATE POLICY "Authenticated delete ticket attachments" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'tickets', 'delete') OR public.has_permission(auth.uid(), 'tickets', 'edit'))
);
