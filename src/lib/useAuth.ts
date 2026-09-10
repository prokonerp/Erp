import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";
import { resetPermissionsCache } from "@/lib/usePermissions";
import { recordLogin, recordLogout } from "@/lib/useActivityTracker";

/** Server-side markers that a refresh token is permanently dead (retrying is futile). */
const PERMANENT_REFRESH_DEATH =
  /invalid_grant|refresh.*not.*found|refresh.*already.*used|refresh.*invalid|refresh_token_not_found|session.*(missing|not.*found)/i;

function isNetworkThrow(msg: string): boolean {
  return (
    /Failed to fetch|NetworkError|network|timeout|AbortError|ERR_CONNECTION/i.test(msg) ||
    (typeof navigator !== "undefined" && !navigator.onLine)
  );
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // Consecutive refresh failures where the network provably works (we got an
  // HTTP response). Two in a row with an unusable session => permanently dead.
  const deadRefreshStrikes = useRef(0);

  const killZombieSession = (why: string) => {
    console.warn(`[auth] signing out (${why})`);
    deadRefreshStrikes.current = 0;
    resetPermissionsCache();
    // Clear local state even if the server call itself fails — the redirect
    // to /auth must happen regardless so the user can sign in fresh.
    void supabase.auth.signOut().catch(() => {}).finally(() => {
      setSession(null);
      setLoading(false);
    });
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((e, s) => {
      if ((e as string) === "TOKEN_REFRESH_FAILED") {
        // The event carries no reason, so prove it with a live getUser():
        // - network throw / offline            => transient, keep session
        // - user returned                      => access token alive, keep session
        // - permanent markers (invalid_grant,  => dead token, sign out now
        //   refresh not found/used, no session)
        // - any other HTTP failure twice in a  => dead session, sign out
        //   row (network provably works, yet the session is unusable)
        void (async () => {
          let msg = "";
          try {
            const { data, error } = await supabase.auth.getUser();
            if (data?.user) {
              deadRefreshStrikes.current = 0;
              return;
            }
            msg = `${(error as any)?.message ?? ""} ${(error as any)?.code ?? ""}`;
          } catch (err: unknown) {
            msg = (err as Error)?.message ?? String(err);
          }
          if (!msg || isNetworkThrow(msg)) {
            console.warn("[auth] token refresh failed (transient), keeping session");
            return;
          }
          if (PERMANENT_REFRESH_DEATH.test(msg)) {
            killZombieSession(`refresh token permanently invalid: ${msg.trim()}`);
            return;
          }
          deadRefreshStrikes.current += 1;
          if (deadRefreshStrikes.current >= 2) {
            killZombieSession(`session unusable after ${deadRefreshStrikes.current} verified failures: ${msg.trim()}`);
          } else {
            console.warn("[auth] token refresh failed, will re-verify on next failure:", msg.trim());
          }
        })();
        return;
      }
      deadRefreshStrikes.current = 0;
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
