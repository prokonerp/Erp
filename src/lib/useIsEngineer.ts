import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const ENGINEER_ROLE_NAMES = ["engineer", "field_engineer", "field engineer"];

/**
 * Pure decision function — extracted for testability.
 *
 * Resolution order:
 *  1. app_users row with an Engineer-ish role name → true
 *  2. app_users row with ANY other role → false (role removal revokes immediately)
 *  3. NO app_users row at all → fall back to employee-email match
 *     (preserves legacy pre-role users)
 */
export function resolveEngineerStatus(
  appRoleNameOrNull: string | null,
  hasAppUserRow: boolean,
  hasEmployeeMatch: boolean,
): boolean {
  if (hasAppUserRow) {
    const roleLower = (appRoleNameOrNull ?? "").toLowerCase();
    return ENGINEER_ROLE_NAMES.some((n) => roleLower.includes(n));
  }
  return hasEmployeeMatch;
}

export function useIsEngineer() {
  // Cached across layout mounts (_app bounce -> /eng): the second mount
  // reuses this instead of re-running the 3-query waterfall. Identity
  // changes (role grant/revoke) propagate on next reload after 5 min stale.
  const query = useQuery({
    queryKey: ["auth", "is-engineer"] as const,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<boolean> => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (!uid) return false;

      // Single roundtrip: app_users row + role name via embedded relation
      // (was: app_users query, then app_roles query — 2 serial RTTs).
      const { data: au } = await supabase
        .from("app_users")
        .select("role_id, app_roles(name)")
        .eq("user_id", uid)
        .maybeSingle();

      const hasAppUserRow = !!au;
      let roleName: string | null = null;
      if (au?.role_id) {
        const nested = au as unknown as {
          app_roles: { name: string | null } | null;
        };
        roleName = nested.app_roles?.name ?? null;
      }

      let hasEmployeeMatch = false;
      // Only query employees when there's no app_users row (legacy fallback path)
      if (!hasAppUserRow) {
        const { data: emp } = await supabase
          .from("employees")
          .select("id")
          .eq("email", u.user?.email || "__none__")
          .eq("active", true)
          .maybeSingle();
        hasEmployeeMatch = !!emp;
      }

      return resolveEngineerStatus(roleName, hasAppUserRow, hasEmployeeMatch);
    },
  });

  return { isEngineer: query.data ?? false, loading: query.isLoading };
}
