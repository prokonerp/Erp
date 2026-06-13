
-- 1. app_roles
CREATE TABLE public.app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_roles TO authenticated;
GRANT ALL ON public.app_roles TO service_role;
ALTER TABLE public.app_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view roles" ON public.app_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage roles" ON public.app_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. role_module_permissions
CREATE TABLE public.role_module_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.app_roles(id) ON DELETE CASCADE,
  module text NOT NULL,
  enable_access boolean NOT NULL DEFAULT false,
  can_read boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, module)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_module_permissions TO authenticated;
GRANT ALL ON public.role_module_permissions TO service_role;
ALTER TABLE public.role_module_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view perms" ON public.role_module_permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage perms" ON public.role_module_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. app_users
CREATE TABLE public.app_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  email text,
  phone text,
  role_id uuid REFERENCES public.app_roles(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  custom_permissions jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_users TO authenticated;
GRANT ALL ON public.app_users TO service_role;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view app_users" ON public.app_users FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage app_users" ON public.app_users FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. touch trigger
CREATE TRIGGER trg_app_roles_touch BEFORE UPDATE ON public.app_roles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_role_module_permissions_touch BEFORE UPDATE ON public.role_module_permissions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_app_users_touch BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. seed roles
INSERT INTO public.app_roles (name, description, is_system) VALUES
  ('Admin', 'Full access to all modules', true),
  ('User', 'Restricted access based on assigned permissions', true)
ON CONFLICT (name) DO NOTHING;

-- 6. seed permissions for all known modules
DO $$
DECLARE
  admin_id uuid;
  user_id uuid;
  m text;
  modules text[] := ARRAY['customers','products','tickets','amc','gatepass','reports','quotations'];
BEGIN
  SELECT id INTO admin_id FROM public.app_roles WHERE name='Admin';
  SELECT id INTO user_id  FROM public.app_roles WHERE name='User';
  FOREACH m IN ARRAY modules LOOP
    INSERT INTO public.role_module_permissions (role_id, module, enable_access, can_read, can_create, can_edit, can_delete)
    VALUES (admin_id, m, true, true, true, true, true)
    ON CONFLICT (role_id, module) DO NOTHING;
    INSERT INTO public.role_module_permissions (role_id, module, enable_access, can_read, can_create, can_edit, can_delete)
    VALUES (user_id, m,
            m <> 'reports',
            m <> 'reports',
            false, false, false)
    ON CONFLICT (role_id, module) DO NOTHING;
  END LOOP;
END $$;

-- 7. has_permission()
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rid uuid;
  cperm jsonb;
  modperm jsonb;
  col text;
BEGIN
  IF public.has_role(_user_id, 'admin') THEN
    RETURN true;
  END IF;

  SELECT role_id, custom_permissions INTO rid, cperm
  FROM public.app_users WHERE user_id = _user_id;

  -- normalize action -> column name
  col := CASE _action
    WHEN 'access' THEN 'enable_access'
    WHEN 'read'   THEN 'can_read'
    WHEN 'view'   THEN 'can_read'
    WHEN 'create' THEN 'can_create'
    WHEN 'edit'   THEN 'can_edit'
    WHEN 'update' THEN 'can_edit'
    WHEN 'delete' THEN 'can_delete'
    ELSE NULL END;
  IF col IS NULL THEN RETURN false; END IF;

  IF cperm IS NOT NULL AND cperm ? _module THEN
    modperm := cperm -> _module;
    RETURN COALESCE((modperm ->> col)::boolean, false)
       AND COALESCE((modperm ->> 'enable_access')::boolean, false);
  END IF;

  IF rid IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.role_module_permissions
    WHERE role_id = rid
      AND module = _module
      AND enable_access = true
      AND CASE col
        WHEN 'enable_access' THEN enable_access
        WHEN 'can_read'   THEN can_read
        WHEN 'can_create' THEN can_create
        WHEN 'can_edit'   THEN can_edit
        WHEN 'can_delete' THEN can_delete
      END = true
  );
END $$;
