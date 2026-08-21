CREATE OR REPLACE FUNCTION public.is_designated_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND lower(u.email) IN ('gaurav@prokonhitech.com', 'prokonerp@gmail.com')
  );
$$;

REVOKE ALL ON FUNCTION public.is_designated_owner() FROM public;
GRANT EXECUTE ON FUNCTION public.is_designated_owner() TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_admin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  IF NOT public.is_designated_owner() THEN
    RAISE EXCEPTION 'Contact your workspace owner to be granted admin access.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'An admin already exists. Ask an existing admin to grant you access.';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'admin')
  ON CONFLICT DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.claim_admin() TO authenticated;