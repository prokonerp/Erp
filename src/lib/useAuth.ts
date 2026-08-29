import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { resetPermissionsCache } from "@/lib/usePermissions";
import { recordLogin, recordLogout } from "@/lib/useActivityTracker";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      setSession(s);
      if (e === "SIGNED_OUT" || e === "SIGNED_IN" || e === "USER_UPDATED") {
        resetPermissionsCache();
      }
      if (e === "SIGNED_IN") void recordLogin();
      if (e === "SIGNED_OUT") void recordLogout();
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) {
        const msg = (error as any)?.message || String(error);
        if (/refresh.*token/i.test(msg) || (error as any)?.status === 400) {
          // Stale/invalid refresh token (e.g. after DB restore or manual deletion).
          // Clear local session and force sign-out to avoid infinite 400 loop.
          void supabase.auth.signOut().finally(() => {
            setSession(null);
            setLoading(false);
          });
          return;
        }
        console.error("[auth] getSession failed:", msg);
      }
      setSession(data.session);
      setLoading(false);
    }).catch((err: any) => {
      const msg = err?.message || String(err);
      if (/refresh.*token/i.test(msg)) {
        void supabase.auth.signOut().finally(() => {
          setSession(null);
          setLoading(false);
        });
        return;
      }
      console.error("[auth] getSession error:", msg);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}