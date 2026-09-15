import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";

const ENGINEER_ROLE_NAMES = ["engineer", "field_engineer", "field engineer"];
const ADMIN_ROLE_NAMES = ["admin", "administrator", "superadmin", "owner"];

/**
 * Pure decision function — extracted for testability.
 *
 * Resolution order:
 *  1. An admin-ish role ANYWHERE (app_users OR legacy user_roles) → false.
 *     Admin wins over engineer (dual-role trap: otherwise an admin holding
 *     the Engineer role is bounced to /eng with no return path).
 *  2. An Engineer-ish role with ANY role row → true
 *  3. A non-engineer, non-admin role row → false
 *  4. NO role row anywhere → fall back to employee-email match
 *     (preserves legacy pre-role users)
 */
export function resolveEngineerStatus(
  roleNameOrNull: string | null,
  hasRoleRow: boolean,
  hasEmployeeMatch: boolean,
  legacyRoles: string[] = [],
): boolean {
  const allNames = [roleNameOrNull, ...legacyRoles].filter(
    (n): n is string => typeof n === "string" && n !== "",
  );
  if (allNames.some((n) => ADMIN_ROLE_NAMES.some((a) => n.toLowerCase().includes(a)))) {
    return false;
  }
  if (hasRoleRow) {
    const roleLower = (roleNameOrNull ?? "").toLowerCase();
    return ENGINEER_ROLE_NAMES.some((n) => roleLower.includes(n));
  }
  return hasEmployeeMatch;
}

export function useIsEngineer() {
  // queryKey carries the real uid: a global key poisoned the next login
  // (engineer logs out, admin logs in → cached `true` bounced admin to /eng).
  // staleTime is short so role grant/revoke propagates within ~30s.
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const query = useQuery({
    queryKey: ["auth", "is-engineer", uid] as const,
    enabled: !!uid,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<boolean> => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (!uid) return false;

      // Both role systems in parallel (legacy admins live in user_roles with
      // no app_users row — ignoring it misclassified them as engineers).
      const [auRes, rolesRes] = await Promise.all([
        supabase
          .from("app_users")
          .select("role_id, app_roles(name)")
          .eq("user_id", uid)
          .maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", uid),
      ]);

      const au = auRes.data;
      const hasAppUserRow = !!au;
      let roleName: string | null = null;
      if (au?.role_id) {
        const nested = au as unknown as {
          app_roles: { name: string | null } | null;
        };
        roleName = nested.app_roles?.name ?? null;
      }
      const legacyRoles = (rolesRes.data ?? [])
        .map((r) => (typeof r.role === "string" ? r.role : ""))
        .filter((r) => r !== "");
      if (!roleName && legacyRoles.length > 0) {
        // Prefer an engineer-ish legacy role when several exist.
        roleName =
          legacyRoles.find((r) => ENGINEER_ROLE_NAMES.some((n) => r.toLowerCase().includes(n))) ??
          legacyRoles[0];
      }
      const hasRoleRow = hasAppUserRow || legacyRoles.length > 0;

      let hasEmployeeMatch = false;
      // Only query employees when there is no role row in either system.
      // Identity by auth_user_id first (exact); email fallback for legacy rows.
      if (!hasRoleRow) {
        if (u.user?.id) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- auth_user_id pending generated types
          const { data: empByAuth, error: authErr } = await (supabase as any)
            .from("employees")
            .select("id")
            .eq("auth_user_id", u.user.id)
            .eq("active", true)
            .maybeSingle();
          if (authErr) {
            console.error("[useIsEngineer]", authErr.message);
          } else if (empByAuth) {
            hasEmployeeMatch = true;
          }
        }
        if (!hasEmployeeMatch) {
          const { data: emp, error: empErr } = await supabase
            .from("employees")
            .select("id")
            .eq("email", u.user?.email || "__none__")
            .eq("active", true)
            .maybeSingle();
          if (empErr) {
            console.error("[useIsEngineer]", empErr.message);
          } else {
            hasEmployeeMatch = !!emp;
          }
        }
      }

      return resolveEngineerStatus(roleName, hasRoleRow, hasEmployeeMatch, legacyRoles);
    },
  });

  // Fail-closed: query errors leave data undefined → false (admin shell).
  // No uid (logged out) → not loading, so route guards fall through to /auth.
  return { isEngineer: query.data ?? false, loading: !!uid && query.isLoading };
}
