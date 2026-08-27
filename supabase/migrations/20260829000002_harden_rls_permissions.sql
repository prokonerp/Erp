-- =============================================================================
-- Harden RLS + permissions (READ/WRITE only; no baseline edits)
-- IMPORTANT: UNTESTED against a live DB. Validate on a staging instance first.
-- This file only tightens INSERT/UPDATE/DELETE write paths and permission
-- logic. SELECT policies are left untouched. service_role (used by the
-- public-ticket flow) bypasses RLS, so it is unaffected.
-- =============================================================================

-- Ensure pgcrypto is available for password-history hashing (crypt / gen_salt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1) Harden has_permission()
--    - Require the calling user to be an *active* app_user.
--    - Revoke access when the module is disabled in app_modules.
--    Mirrors the existing signature (uuid, text, text).
-- -----------------------------------------------------------------------------
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
  ustatus text;
BEGIN
  -- Admin early-return: admins bypass the active-user and module gates entirely.
  IF public.has_role(_user_id, 'admin') THEN
    RETURN true;
  END IF;

  -- Active-user gate: only an active app_users row grants any permission.
  -- A missing row (NULL) is treated as not-active and is denied.
  SELECT status INTO ustatus FROM public.app_users WHERE user_id = _user_id;
  IF ustatus IS DISTINCT FROM 'active' THEN
    RETURN false;
  END IF;

  -- Disabled module revokes access for non-admin users.
  IF NOT EXISTS (SELECT 1 FROM public.app_modules WHERE key = _module AND is_active) THEN
    RETURN false;
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

-- -----------------------------------------------------------------------------
-- 2) Tighten write policies (INSERT/UPDATE/DELETE) from USING(true)/WITH CHECK(true)
--    to: admin OR has_permission(<module>, <create|edit|delete>)
--    SELECT policies are intentionally left as-is.
-- -----------------------------------------------------------------------------

-- 2a) products : all writes
DROP POLICY IF EXISTS "Authenticated can insert products" ON public.products;
CREATE POLICY "Authenticated can insert products" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'products', 'create')
  );

DROP POLICY IF EXISTS "Authenticated can update products" ON public.products;
CREATE POLICY "Authenticated can update products" ON public.products
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'products', 'edit')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'products', 'edit')
  );

DROP POLICY IF EXISTS "Authenticated can delete products" ON public.products;
CREATE POLICY "Authenticated can delete products" ON public.products
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'products', 'delete')
  );

-- 2b) customers : INSERT/UPDATE/DELETE (SELECT kept as "auth view customers")
DROP POLICY IF EXISTS "auth insert customers" ON public.customers;
CREATE POLICY "auth insert customers" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'customers', 'create')
  );

DROP POLICY IF EXISTS "auth update customers" ON public.customers;
CREATE POLICY "auth update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'customers', 'edit')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'customers', 'edit')
  );

DROP POLICY IF EXISTS "auth delete customers" ON public.customers;
CREATE POLICY "auth delete customers" ON public.customers
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'customers', 'delete')
  );

-- 2c) tickets : INSERT only (per scope; UPDATE/DELETE left as USING(true) -- see notes)
DROP POLICY IF EXISTS "auth insert tickets" ON public.tickets;
CREATE POLICY "auth insert tickets" ON public.tickets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'create')
  );

-- 2d) indents : INSERT only (per scope; UPDATE/DELETE left as-is -- see notes)
DROP POLICY IF EXISTS "auth insert indents" ON public.indents;
CREATE POLICY "auth insert indents" ON public.indents
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'indent', 'create')
  );

-- 2e) gatepasses : INSERT
--     The baseline already restricted this to created_by = auth.uid() OR admin.
--     We keep that ownership path AND add the module-permission grant, so this
--     is a strict superset (no weakening of existing semantics).
DROP POLICY IF EXISTS "Authenticated insert own gatepass" ON public.gatepasses;
CREATE POLICY "Authenticated insert own gatepass" ON public.gatepasses
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'gatepass', 'create')
    OR created_by = auth.uid()
  );

-- -----------------------------------------------------------------------------
-- 3) Seed missing module keys the UI/nav/RLS depend on.
-- -----------------------------------------------------------------------------
INSERT INTO public.app_modules (key, label, sort_order, supports_import) VALUES
  ('employees', 'Employees', 90, true),
  ('payroll',   'Payroll',   100, false)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4) Fix bootstrap privilege escalation.
--    The "claim first admin" policy previously let ANY authenticated user
--    insert {role:'admin'} while no admin existed, bypassing the owner-email
--    check that claim_admin() enforces. Require is_designated_owner().
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "claim first admin" ON public.user_roles;
CREATE POLICY "claim first admin" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    role = 'admin'
    AND user_id = auth.uid()
    AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin')
    AND public.is_designated_owner()
  );

-- -----------------------------------------------------------------------------
-- 5) Password history.
--    Revoke direct SELECT from authenticated (rows are read only via SECURITY
--    DEFINER helpers below). Provide rpc-callable helpers for the TS layer.
-- -----------------------------------------------------------------------------
REVOKE SELECT ON public.password_history FROM authenticated;

CREATE OR REPLACE FUNCTION public.record_password_history(p_user uuid, p_pw text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.password_history (user_id, password_hash)
  VALUES (p_user, crypt(p_pw, gen_salt('bf', 12)));
END $function$;

CREATE OR REPLACE FUNCTION public.check_password_reuse(p_user uuid, p_pw text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT password_hash
      FROM public.password_history
      WHERE user_id = p_user
      ORDER BY created_at DESC
      LIMIT 5
    ) recent
    WHERE crypt(p_pw, recent.password_hash) = recent.password_hash
  ) INTO result;
  RETURN result;
END $function$;

REVOKE ALL ON FUNCTION public.record_password_history(uuid, text) FROM public;
REVOKE ALL ON FUNCTION public.check_password_reuse(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_password_history(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_password_reuse(uuid, text) TO authenticated, service_role;
