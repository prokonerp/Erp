import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

// Throttle heartbeat writes to avoid hammering the DB.
const HEARTBEAT_MS = 60 * 1000; // 1 minute

/**
 * Sends periodic activity heartbeats and records logout when the tab closes.
 * The initial "login" heartbeat is recorded via useAuth() on SIGNED_IN.
 */
export function useActivityTracker(enabled: boolean) {
  const lastPingRef = useRef<number>(0);
  const activeRef = useRef<boolean>(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const ping = async () => {
      const now = Date.now();
      if (now - lastPingRef.current < HEARTBEAT_MS) return;
      lastPingRef.current = now;
      try {
        await supabase.rpc("record_user_activity");
      } catch {
        // ignore
      }
    };

    // First ping shortly after mount
    const initial = window.setTimeout(() => {
      if (!cancelled) void ping();
    }, 2000);

    const onActivity = () => {
      activeRef.current = true;
      void ping();
    };

    // Periodic heartbeat while tab is visible & user recently active
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (!activeRef.current) return;
      activeRef.current = false;
      void ping();
    }, HEARTBEAT_MS);

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }

    const onUnload = () => {
      try {
        // Best-effort logout marker on tab close
        void supabase.rpc("record_user_logout");
      } catch {
        // ignore
      }
    };
    window.addEventListener("pagehide", onUnload);

    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
      window.removeEventListener("pagehide", onUnload);
    };
  }, [enabled]);
}

export async function recordLogin() {
  try {
    await supabase.rpc("record_user_login");
  } catch {
    // ignore
  }
}

export async function recordLogout() {
  try {
    await supabase.rpc("record_user_logout");
  } catch {
    // ignore
  }
}

export type ActivityStatus = "active" | "idle" | "offline" | "never";

export function computeActivityStatus(u: {
  last_login: string | null;
  last_activity: string | null;
  last_logout: string | null;
}, nowMs: number = Date.now(), idleWindowMs: number = 5 * 60 * 1000): ActivityStatus {
  if (!u.last_login) return "never";
  const act = u.last_activity ? Date.parse(u.last_activity) : 0;
  const out = u.last_logout ? Date.parse(u.last_logout) : 0;
  const login = Date.parse(u.last_login);
  // If a logout happened after the most recent login-side activity, user is offline
  if (out && out >= Math.max(act, login)) return "offline";
  // Session considered stale if no activity heartbeat for > 2 * idle window
  if (!act || nowMs - act > idleWindowMs * 2) return "offline";
  if (nowMs - act <= idleWindowMs) return "active";
  return "idle";
}