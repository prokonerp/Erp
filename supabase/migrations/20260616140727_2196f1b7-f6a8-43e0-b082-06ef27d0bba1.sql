
-- 1) Dynamic modules registry
CREATE TABLE public.app_modules (
  key text PRIMARY KEY,
  label text NOT NULL,
  sort_order int NOT NULL DEFAULT 100,
  supports_import boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.app_modules TO authenticated;
GRANT ALL ON public.app_modules TO service_role;
ALTER TABLE public.app_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read modules" ON public.app_modules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage modules" ON public.app_modules
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_app_modules_touch BEFORE UPDATE ON public.app_modules
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.app_modules (key, label, sort_order, supports_import) VALUES
  ('customers',  'Customers',  10, true),
  ('products',   'Products',   20, true),
  ('tickets',    'Tickets',    30, true),
  ('indent',     'Indent',     40, false),
  ('amc',        'AMC',        50, true),
  ('gatepass',   'Gatepass',   60, false),
  ('quotations', 'Quotations', 70, false),
  ('reports',    'Reports',    80, false)
ON CONFLICT (key) DO NOTHING;

-- 2) Export / Import permission columns
ALTER TABLE public.role_module_permissions
  ADD COLUMN IF NOT EXISTS can_export boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_import boolean NOT NULL DEFAULT false;

-- Update has_permission to support export/import actions
CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _module text, _action text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  col := CASE _action
    WHEN 'access' THEN 'enable_access'
    WHEN 'read'   THEN 'can_read'
    WHEN 'view'   THEN 'can_read'
    WHEN 'create' THEN 'can_create'
    WHEN 'edit'   THEN 'can_edit'
    WHEN 'update' THEN 'can_edit'
    WHEN 'delete' THEN 'can_delete'
    WHEN 'export' THEN 'can_export'
    WHEN 'import' THEN 'can_import'
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
        WHEN 'can_export' THEN can_export
        WHEN 'can_import' THEN can_import
      END = true
  );
END $function$;

-- 3) Password expiry tracking on app_users
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- 4) Password history (for "no reuse of last 5")
CREATE TABLE public.password_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_history_user_idx ON public.password_history (user_id, created_at DESC);
GRANT SELECT ON public.password_history TO authenticated;
GRANT ALL ON public.password_history TO service_role;
ALTER TABLE public.password_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own history" ON public.password_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
