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
      // Supabase can emit TOKEN_REFRESH_FAILED on transient network issues while
      // the user is actively working — don't treat it as a logout.
      if ((e as string) === "TOKEN_REFRESH_FAILED") {
        console.warn("[auth] token refresh failed (transient), keeping session");
        return;
      }
      setSession(s);
      if (e === "SIGNED_OUT" || e === "SIGNED_IN" || e === "USER_UPDATED") {
        resetPermissionsCache();
      }
      if (e === "SIGNED_IN") void recordLogin();
      if (e === "SIGNED_OUT") void recordLogout();
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) {
          const msg = (error as any)?.message || String(error);
          const code = (error as any)?.code || "";
          const transient =
            /Failed to fetch|NetworkError|network|timeout|AbortError/i.test(msg) ||
            (typeof navigator !== "undefined" && !navigator.onLine);
          // Only treat as stale/invalid refresh token when the message/code
          // explicitly says so — not on transient network blips while working.
          const isInvalidRefresh =
            /invalid.*refresh|refresh.*not.*found|refresh.*already.*used|invalid_grant|refresh_token_not_found/i.test(
              `${msg} ${code}`,
            );
          if (isInvalidRefresh && !transient) {
            // Stale/invalid refresh token (e.g. after DB restore or manual deletion).
            // Clear local session and force sign-out to avoid infinite 400 loop.
            void supabase.auth.signOut().finally(() => {
              setSession(null);
              setLoading(false);
            });
            return;
          }
          if (transient) {
            // Network hiccup while working — don't log out. Keep any cached session.
            console.warn("[auth] getSession transient failure, keeping session:", msg);
            setSession(data.session ?? null);
            setLoading(false);
            return;
          }
          // Legacy broad check — keep for safety but only if it mentions refresh
          if (/refresh.*token/i.test(msg) && (error as any)?.status === 400) {
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
      })
      .catch((err: any) => {
        const msg = err?.message || String(err);
        const code = err?.code || "";
        const transient =
          /Failed to fetch|NetworkError|network|timeout|AbortError/i.test(msg) ||
          (typeof navigator !== "undefined" && !navigator.onLine);
        if (transient) {
          console.warn("[auth] getSession transient error, keeping session:", msg);
          setLoading(false);
          return;
        }
        const isInvalidRefresh =
          /invalid.*refresh|refresh.*not.*found|refresh.*already.*used|invalid_grant|refresh_token_not_found/i.test(
            `${msg} ${code}`,
          );
        if (isInvalidRefresh) {
          void supabase.auth.signOut().finally(() => {
            setSession(null);
            setLoading(false);
          });
          return;
        }
        // Fallback: only sign out if it explicitly mentions refresh token
        if (/refresh.*token/i.test(msg) && /not found|invalid|expired/i.test(msg)) {
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
