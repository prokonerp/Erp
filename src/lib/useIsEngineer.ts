import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const ENGINEER_ROLE_NAMES = ["engineer", "field_engineer", "field engineer"];

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

      if (au?.role_id) {
        const { data: role } = await supabase
          .from("app_roles")
          .select("name")
          .eq("id", au.role_id)
          .maybeSingle();
        if (!active) return;
        const roleName = (role?.name || "").toLowerCase();
        if (ENGINEER_ROLE_NAMES.some((n) => roleName.includes(n))) {
          setIsEngineer(true);
          setLoading(false);
          return;
        }
      }

      const { data: emp } = await supabase
        .from("employees")
        .select("id")
        .eq("email", u.user?.email || "__none__")
        .eq("active", true)
        .maybeSingle();

      if (!active) return;

      setIsEngineer(!!emp);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { isEngineer, loading };
}
