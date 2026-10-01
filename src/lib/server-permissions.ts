/**
 * src/lib/server-permissions.ts — server-side module permission resolution.
 *
 * `PermGate` / `usePermissions()` are client-side and exist only to tighten
 * UX. They are explicitly *not* an access control: a caller with a valid
 * session can invoke a server function directly. Any server function that
 * performs a privileged action — minting an IRN, raising an e-way bill — must
 * enforce the permission itself.
 *
 * This module is the server mirror of `usePermissions().can()`, sharing the
 * same precedence so the two can never disagree:
 *
 *   1. admin (`user_roles.role = 'admin'`) → allow everything
 *   2. account must be active (`app_users.status`)
 *   3. `app_users.custom_permissions[module][action]` wins if explicitly set
 *   4. otherwise fall back to `role_module_permissions` for the user's role
 *   5. otherwise deny
 *
 * Pure decision logic (`resolveModulePermission`) is separated from the
 * Supabase reads (`loadPermissionSnapshot`) so the rules are unit-testable
 * without a database.
 *
 * @module src/lib/server-permissions
 */

import { actionCol, type Action, type ModuleKey, type ModulePerm } from "./permissions";

export type PermissionError = Error & { statusCode: number; code: string };

export type AppUserSnapshot = {
  status: string | null;
  roleId?: string | null;
  customPermissions?: Record<string, Partial<ModulePerm>> | null;
};

export type PermissionSnapshot = {
  isAdmin: boolean;
  appUser: AppUserSnapshot | null;
  rolePerms: Record<string, Partial<ModulePerm>>;
};

function readFlag(
  perms: Record<string, Partial<ModulePerm>> | null | undefined,
  module: string,
  action: Action,
): boolean | null {
  if (!perms) return null;
  const mod = perms[module];
  if (!mod) return null;
  const value = mod[actionCol(action)];
  // `undefined` means "not specified" — let the role matrix decide.
  return typeof value === "boolean" ? value : null;
}

/**
 * Apply the precedence rules above. Returns `false` by default: every
 * unspecified permission is denied.
 */
export function resolveModulePermission(
  snapshot: PermissionSnapshot,
  module: ModuleKey,
  action: Action,
): boolean {
  if (snapshot.isAdmin) return true;
  if (!snapshot.appUser) return false;
  if (snapshot.appUser.status && snapshot.appUser.status !== "active") return false;

  const override = readFlag(snapshot.appUser.customPermissions, module, action);
  if (override !== null) return override;

  const fromRole = readFlag(snapshot.rolePerms, module, action);
  if (fromRole !== null) return fromRole;

  return false;
}

export function permissionError(module: string, action: string): PermissionError {
  const err = new Error(
    `You don't have permission to ${action} in ${module}. Ask an admin to grant it.`,
  ) as PermissionError;
  err.statusCode = 403;
  err.code = "FORBIDDEN";
  return err;
}

/**
 * Read the three sources the precedence rules need.
 *
 * Uses the service-role client: `app_users` and `role_module_permissions`
 * are not all readable by the caller's session, and a permission check that
 * silently returns "denied" on an RLS miss would look identical to a real
 * denial. Callers must therefore surface read failures rather than swallow
 * them — this function throws on error.
 */
export async function loadPermissionSnapshot(userId: string): Promise<PermissionSnapshot> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabaseAdmin Proxy is not narrowed to the generated row types for these tables
  const admin = supabaseAdmin as any;

  const { data: roleRows, error: roleErr } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (roleErr) throw new Error(`Permission check failed: ${roleErr.message}`);
  const isAdmin = (roleRows ?? []).some((r: { role?: string | null }) => r.role === "admin");

  const { data: appUser, error: userErr } = await admin
    .from("app_users")
    .select("status,role_id,custom_permissions")
    .eq("user_id", userId)
    .maybeSingle();
  if (userErr) throw new Error(`Permission check failed: ${userErr.message}`);

  if (!appUser) return { isAdmin, appUser: null, rolePerms: {} };
  if (isAdmin) return { isAdmin, appUser: null, rolePerms: {} };

  const rolePerms: Record<string, Partial<ModulePerm>> = {};
  if (appUser.role_id) {
    const { data: matrix, error: matrixErr } = await admin
      .from("role_module_permissions")
      .select("module,enable_access,can_read,can_create,can_edit,can_delete,can_export,can_import")
      .eq("role_id", appUser.role_id);
    if (matrixErr) throw new Error(`Permission check failed: ${matrixErr.message}`);
    for (const row of matrix ?? []) {
      rolePerms[row.module as string] = {
        enable_access: row.enable_access,
        can_read: row.can_read,
        can_create: row.can_create,
        can_edit: row.can_edit,
        can_delete: row.can_delete,
        can_export: row.can_export,
        can_import: row.can_import,
      };
    }
  }

  return {
    isAdmin: false,
    appUser: {
      status: appUser.status ?? null,
      roleId: appUser.role_id ?? null,
      customPermissions: (appUser.custom_permissions ?? null) as Record<
        string,
        Partial<ModulePerm>
      > | null,
    },
    rolePerms,
  };
}

/**
 * Server-function gate. Throws a 403-shaped `PermissionError` when the user
 * lacks `action` on `module`.
 */
export async function assertModulePermission(
  userId: string,
  module: ModuleKey,
  action: Action,
): Promise<void> {
  const snapshot = await loadPermissionSnapshot(userId);
  if (!resolveModulePermission(snapshot, module, action)) {
    throw permissionError(module, action);
  }
}
