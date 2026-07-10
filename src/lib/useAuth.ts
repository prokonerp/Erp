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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}