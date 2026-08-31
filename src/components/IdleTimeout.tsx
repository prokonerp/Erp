import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { recordLogout } from "@/lib/useActivityTracker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const IDLE_MS = 30 * 60 * 1000; // 30 min
const WARN_MS = 25 * 60 * 1000; // 25 min
const EXPIRED_KEY = "idle-session-expired";
const LAST_ACTIVITY_KEY = "prokon-last-activity";
const THROTTLE_MS = 1000;
const CHECK_INTERVAL_MS = 30 * 1000;

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "click",
  "touchstart",
  "touchmove",
  "wheel",
  "pointermove",
  "pointerdown",
] as const;

export function IdleTimeout() {
  const navigate = useNavigate();
  const [warnOpen, setWarnOpen] = useState(false);

  const lastActivityRef = useRef<number>(Date.now());
  const warnTimerRef = useRef<number | null>(null);
  const logoutTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const warnOpenRef = useRef(false);
  const lastResetRef = useRef<number>(0);
  const doLogoutRef = useRef<() => Promise<void>>(async () => {});
  const scheduleTimersRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current !== null) {
      window.clearTimeout(warnTimerRef.current);
      warnTimerRef.current = null;
    }
    if (logoutTimerRef.current !== null) {
      window.clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
  }, []);

  const doLogout = useCallback(async () => {
    clearTimers();
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    try {
      if (typeof window !== "undefined") {
        sessionStorage.setItem(EXPIRED_KEY, "1");
      }
      await recordLogout();
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    navigate({ to: "/auth" });
  }, [clearTimers, navigate]);

  // Keep ref in sync so interval / storage handler always calls latest
  useEffect(() => {
    doLogoutRef.current = doLogout;
  }, [doLogout]);

  const scheduleTimers = useCallback(() => {
    clearTimers();
    const elapsed = Date.now() - lastActivityRef.current;
    const warnDelay = Math.max(0, WARN_MS - elapsed);
    const idleDelay = Math.max(0, IDLE_MS - elapsed);

    warnTimerRef.current = window.setTimeout(() => {
      // Re-check elapsed at fire time — activity may have happened
      if (Date.now() - lastActivityRef.current >= WARN_MS) {
        warnOpenRef.current = true;
        setWarnOpen(true);
      }
    }, warnDelay);

    logoutTimerRef.current = window.setTimeout(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_MS) {
        void doLogoutRef.current();
      }
    }, idleDelay);
  }, [clearTimers]);

  useEffect(() => {
    scheduleTimersRef.current = scheduleTimers;
  }, [scheduleTimers]);

  const resetActivity = useCallback(() => {
    const now = Date.now();
    // Throttle resets to avoid flooding on mousemove
    if (now - lastResetRef.current < THROTTLE_MS) return;
    lastResetRef.current = now;
    lastActivityRef.current = now;
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch {
      // ignore
    }

    // If warning dialog is open, auto-continue on any genuine activity
    // This fixes the "logged out while working" complaint — user was moving mouse during warning
    if (warnOpenRef.current) {
      warnOpenRef.current = false;
      setWarnOpen(false);
    }

    scheduleTimers();
  }, [scheduleTimers]);

  const handleExternalActivity = useCallback(() => {
    // Called when another tab reports activity via localStorage
    const now = Date.now();
    lastActivityRef.current = now;
    if (warnOpenRef.current) {
      warnOpenRef.current = false;
      setWarnOpen(false);
    }
    scheduleTimers();
  }, [scheduleTimers]);

  useEffect(() => {
    // Init last activity from storage if another tab was active more recently
    try {
      const stored = localStorage.getItem(LAST_ACTIVITY_KEY);
      if (stored) {
        const parsed = Number(stored);
        if (!Number.isNaN(parsed) && parsed > lastActivityRef.current) {
          lastActivityRef.current = parsed;
        }
      } else {
        localStorage.setItem(LAST_ACTIVITY_KEY, String(lastActivityRef.current));
      }
    } catch {
      // ignore
    }

    scheduleTimers();

    const handleActivity = () => resetActivity();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY && e.newValue) {
        const v = Number(e.newValue);
        if (!Number.isNaN(v)) {
          lastActivityRef.current = v;
          // Defer to avoid thrashing
          if (Date.now() - lastResetRef.current > THROTTLE_MS) {
            handleExternalActivity();
          }
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // Don't blindly reset — check how long we've been away
        const elapsed = Date.now() - lastActivityRef.current;
        if (elapsed >= IDLE_MS) {
          void doLogoutRef.current();
          return;
        }
        if (elapsed >= WARN_MS && !warnOpenRef.current) {
          warnOpenRef.current = true;
          setWarnOpen(true);
        }
        // Re-schedule with correct remaining time
        scheduleTimersRef.current();
      }
    };

    const handleFocus = () => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed < IDLE_MS) {
        // Only reset if close to expiry? Actually any focus with recent activity should just re-sync timers
        scheduleTimersRef.current();
      }
    };

    // Attach to document for bubbling capture of most UI events
    for (const ev of ACTIVITY_EVENTS) {
      document.addEventListener(ev, handleActivity, { passive: true });
    }
    // Scroll needs special handling — app scrolls inside #main-content, not window
    const onScroll = () => handleActivity();
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });

    const mainEl = document.getElementById("main-content");
    if (mainEl) mainEl.addEventListener("scroll", onScroll, { passive: true });

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("storage", handleStorage);

    // Fallback interval — handles timer throttling when tab is backgrounded and cross-tab sync
    intervalRef.current = window.setInterval(() => {
      const now = Date.now();
      // Sync from storage (another tab may have updated)
      try {
        const stored = localStorage.getItem(LAST_ACTIVITY_KEY);
        if (stored) {
          const parsed = Number(stored);
          if (!Number.isNaN(parsed) && parsed > lastActivityRef.current) {
            lastActivityRef.current = parsed;
          }
        }
      } catch {
        // ignore
      }

      const elapsed = now - lastActivityRef.current;

      if (elapsed >= IDLE_MS) {
        void doLogoutRef.current();
        return;
      }
      if (elapsed >= WARN_MS && !warnOpenRef.current) {
        warnOpenRef.current = true;
        setWarnOpen(true);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      clearTimers();
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      for (const ev of ACTIVITY_EVENTS) {
        document.removeEventListener(ev, handleActivity);
      }
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", onScroll, true as any);
      if (mainEl) mainEl.removeEventListener("scroll", onScroll);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("storage", handleStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onContinue = () => {
    warnOpenRef.current = false;
    setWarnOpen(false);
    const now = Date.now();
    lastActivityRef.current = now;
    lastResetRef.current = now;
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
    } catch {
      // ignore
    }
    scheduleTimers();
  };

  const onLogoutNow = () => {
    warnOpenRef.current = false;
    setWarnOpen(false);
    void doLogout();
  };

  return (
    <AlertDialog open={warnOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Session Expiring Soon</AlertDialogTitle>
          <AlertDialogDescription>
            You have been inactive for 25 minutes. Your session will expire in 5 minutes unless you
            continue working.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onLogoutNow}>Logout Now</AlertDialogCancel>
          <AlertDialogAction onClick={onContinue}>Continue Session</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
