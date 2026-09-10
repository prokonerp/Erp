-- Migration: 20260915000003_engineer_role_seed.sql
-- Seed the Engineer role (read assigned calls + upload notes/photos only).
-- SAFE: INSERT-only with ON CONFLICT DO NOTHING. No UPDATE/DELETE/DROP.
-- Without this row, engineer note/photo INSERTs are RLS-blocked because
-- ticket_activities INSERT requires has_permission(uid,'tickets','create').

-- 1) Engineer role (app-level RBAC; name is UNIQUE so this is idempotent)
INSERT INTO public.app_roles (name, description, is_system)
VALUES (
  'Engineer',
  'Field engineers: read assigned calls + upload notes/photos. No status, assign, close, or delete.',
  false
)
ON CONFLICT (name) DO NOTHING;

-- 2) Tickets module: read + create (create = insert notes/photos).
--    edit/delete stay false → status, assignment, closure remain Services/Admin.
--    (role_id, module) is UNIQUE so this is idempotent.
INSERT INTO public.role_module_permissions
  (role_id, module, enable_access, can_read, can_create, can_edit, can_delete)
SELECT r.id, 'tickets', true, true, true, false, false
FROM public.app_roles r
WHERE r.name = 'Engineer'
ON CONFLICT (role_id, module) DO NOTHING;

-- 3) Explicitly deny every other known module for the Engineer role,
--    so a future permissive default can never widen engineer access.
--    Unknown future modules default to no-row = no access (fail-closed).
INSERT INTO public.role_module_permissions
  (role_id, module, enable_access, can_read, can_create, can_edit, can_delete)
SELECT r.id, m.module, false, false, false, false, false
FROM public.app_roles r
CROSS JOIN (VALUES
  ('customers'), ('products'), ('indent'), ('po'), ('amc'), ('ims'),
  ('gatepass'), ('quotations'), ('sales'), ('general_dc'), ('reports')
) AS m(module)
WHERE r.name = 'Engineer'
ON CONFLICT (role_id, module) DO NOTHING;
