import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [hasAnyAdmin, setHasAnyAdmin] = useState(true);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id ?? null;
      if (!active) return;
      setUserId(uid);
      if (!uid) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role,user_id")
        .eq("role", "admin");
      if (!active) return;
      const list = roles ?? [];
      setHasAnyAdmin(list.length > 0);
      setIsAdmin(list.some((r) => r.user_id === uid));
      if (list.length === 0) {
        const { data: owner } = await (supabase as any).rpc("is_designated_owner");
        if (!active) return;
        setIsOwner(owner === true);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function claimAdmin() {
    if (!userId) return { error: "Not signed in" };
    const { error } = await (supabase as any).rpc("claim_admin");
    if (!error) {
      setIsAdmin(true);
      setHasAnyAdmin(true);
    }
    return { error: error?.message };
  }

  return { isAdmin, loading, userId, hasAnyAdmin, isOwner, claimAdmin };
}