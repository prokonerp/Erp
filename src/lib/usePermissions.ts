import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Action, EMPTY_PERM, FULL_PERM, ModuleKey, ModulePerm, actionCol } from "./permissions";

type PermMap = Partial<Record<ModuleKey, ModulePerm>>;
type PermSnapshot = { isAdmin: boolean; perms: PermMap };

// Module-level cache so N mounted pages don't each refetch the same rows.
// Tagged by uid: a global snapshot leaked one user's permissions into the
// next login. Bust on sign-out via `purgeAuthCaches()` (useAuth) + the
// synchronous `resetPermissionsCache()` in sign-out handlers.
let cache: { uid: string; snap: PermSnapshot } | null = null;
let inflight: { uid: string; promise: Promise<PermSnapshot> } | null = null;

export function resetPermissionsCache() {
  cache = null;
  inflight = null;
}

async function loadPermissions(): Promise<PermSnapshot> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return { isAdmin: false, perms: {} };
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
  if ((roles ?? []).some((r) => r.role === "admin")) return { isAdmin: true, perms: {} };
  const { data: au } = await supabase
    .from("app_users")
    .select("role_id,status,custom_permissions")
    .eq("user_id", uid)
    .maybeSingle();
  const map: PermMap = {};
  if (au && au.status !== "inactive") {
    if (au.custom_permissions && typeof au.custom_permissions === "object") {
      Object.assign(map, au.custom_permissions as PermMap);
    }
    if (au.role_id) {
      const { data: rp } = await supabase
        .from("role_module_permissions")
        .select(
          "module,enable_access,can_read,can_create,can_edit,can_delete,can_export,can_import",
        )
        .eq("role_id", au.role_id);
      (rp ?? []).forEach((row) => {
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
  return { isAdmin: false, perms: map };
}

export function usePermissions() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [perms, setPerms] = useState<PermMap>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (!active) return;
      if (!uid) {
        setIsAdmin(false);
        setPerms({});
        setLoading(false);
        return;
      }
      if (cache && cache.uid === uid) {
        setIsAdmin(cache.snap.isAdmin);
        setPerms(cache.snap.perms);
        setLoading(false);
        return;
      }
      if (!inflight || inflight.uid !== uid) {
        inflight = {
          uid,
          promise: loadPermissions().then((snap) => {
            cache = { uid, snap };
            return snap;
          }),
        };
      }
      try {
        const snap = await inflight.promise;
        if (!active) return;
        setIsAdmin(snap.isAdmin);
        setPerms(snap.perms);
      } catch {
        // fail-closed already (isAdmin false, empty perms)
      } finally {
        if (active) setLoading(false);
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
