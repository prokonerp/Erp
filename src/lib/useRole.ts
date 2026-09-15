import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/useAuth";

type AdminVerdict = { isAdmin: boolean; hasAnyAdmin: boolean; isOwner: boolean };

async function resolveAdmin(): Promise<AdminVerdict> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id ?? null;
  if (!uid) return { isAdmin: false, hasAnyAdmin: true, isOwner: false };
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role,user_id")
    .eq("role", "admin");
  const list = roles ?? [];
  const mine = list.some((r) => r.user_id === uid);
  if (list.length > 0) return { isAdmin: mine, hasAnyAdmin: true, isOwner: false };
  const { data: owner } = await (supabase as any).rpc("is_designated_owner");
  return { isAdmin: false, hasAnyAdmin: false, isOwner: owner === true };
}

export function useIsAdmin() {
  // uid-scoped key: a global/per-mount fetch leaked the prior user's admin
  // flag across same-shell user switches.
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["auth", "is-admin", uid] as const,
    enabled: !!uid,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: resolveAdmin,
  });

  async function claimAdmin() {
    if (!uid) return { error: "Not signed in" };
    const { error } = await (supabase as any).rpc("claim_admin");
    if (!error) {
      await queryClient.invalidateQueries({ queryKey: ["auth", "is-admin", uid] });
    }
    return { error: error?.message };
  }

  const verdict = query.data;
  return {
    isAdmin: verdict?.isAdmin ?? false,
    // No uid (logged out) → not loading, so guards fall through to /auth.
    loading: !!uid && query.isLoading,
    // Derived live from the session — never a stale prior user's id, since
    // queryFn no longer caches it in component state.
    userId: uid,
    hasAnyAdmin: verdict?.hasAnyAdmin ?? true,
    isOwner: verdict?.isOwner ?? false,
    claimAdmin,
  };
}
