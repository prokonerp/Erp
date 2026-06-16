import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Action,
  EMPTY_PERM,
  FULL_PERM,
  ModuleKey,
  ModulePerm,
  actionCol,
} from "./permissions";

type PermMap = Partial<Record<ModuleKey, ModulePerm>>;

export function usePermissions() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [perms, setPerms] = useState<PermMap>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) {
        if (active) {
          setIsAdmin(false);
          setPerms({});
          setLoading(false);
        }
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", uid);
      const admin = (roles ?? []).some((r) => r.role === "admin");
      if (admin) {
        if (active) {
          setIsAdmin(true);
          setPerms({});
          setLoading(false);
        }
        return;
      }
      const { data: au } = await supabase
        .from("app_users")
        .select("role_id,status,custom_permissions")
        .eq("user_id", uid)
        .maybeSingle();
      const map: PermMap = {};
      if (au && au.status !== "inactive") {
        if (au.custom_permissions && typeof au.custom_permissions === "object") {
          Object.assign(map, au.custom_permissions as any);
        }
        if (au.role_id) {
          const { data: rp } = await supabase
            .from("role_module_permissions")
            .select("module,enable_access,can_read,can_create,can_edit,can_delete")
            .eq("role_id", au.role_id);
          const { data: rp } = await supabase
            .from("role_module_permissions")
            .select(
              "module,enable_access,can_read,can_create,can_edit,can_delete,can_export,can_import",
            )
            .eq("role_id", au.role_id);
          (rp ?? []).forEach((row: any) => {
            const k = row.module as ModuleKey;
            if (!map[k]) {
              map[k] = {
                enable_access: row.enable_access,
                can_read: row.can_read,
                can_create: row.can_create,
                can_edit: row.can_edit,
                can_delete: row.can_delete,
                can_export: !!row.can_export,
                can_import: !!row.can_import,
              };
            }
          });
        }
      }
      if (active) {
        setIsAdmin(false);
        setPerms(map);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  function can(mod: ModuleKey, action: Action = "read"): boolean {
    if (isAdmin) return true;
    const p = perms[mod] ?? EMPTY_PERM;
    if (!p.enable_access) return false;
    if (action === "access") return true;
    return !!p[actionCol(action)];
  }

  return { loading, isAdmin, perms, can, FULL_PERM };
}