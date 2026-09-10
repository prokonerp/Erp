import { useEffect, useState } from "react";
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
  const [isEngineer, setIsEngineer] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (!active || !uid) {
        if (active) {
          setIsEngineer(false);
          setLoading(false);
        }
        return;
      }

      const { data: au } = await supabase
        .from("app_users")
        .select("role_id")
        .eq("user_id", uid)
        .maybeSingle();

      if (!active) return;

      const hasAppUserRow = !!au;
      let roleName: string | null = null;
      if (au?.role_id) {
        const { data: role } = await supabase
          .from("app_roles")
          .select("name")
          .eq("id", au.role_id)
          .maybeSingle();
        if (!active) return;
        roleName = role?.name ?? null;
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
        if (!active) return;
        hasEmployeeMatch = !!emp;
      }

      setIsEngineer(resolveEngineerStatus(roleName, hasAppUserRow, hasEmployeeMatch));
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { isEngineer, loading };
}
