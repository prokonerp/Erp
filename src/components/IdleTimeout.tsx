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

const IDLE_MS = 30 * 60 * 1000; // 30 min — hard requirement: not more than 30m idle
const WARN_MS = 25 * 60 * 1000; // 25 min
const EXPIRED_KEY = "idle-session-expired";
const LAST_ACTIVITY_KEY = "prokon-last-activity";
const THROTTLE_MS = 750; // throttle expensive work, but still update lastActivity immediately
const CHECK_INTERVAL_MS = 15 * 1000; // 15s — ensures we never exceed 30m by more than 15s

// Capture all realistic user interactions. Previously we missed input/change/focusin
// and used bubble phase which could be blocked by stopPropagation.
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "mouseup",
  "keydown",
  "keyup",
  "click",
  "dblclick",
  "touchstart",
  "touchmove",
  "touchend",
  "wheel",
  "pointermove",
  "pointerdown",
  "pointerup",
  "input",
  "change",
  "select",
  "submit",
  "focusin",
  "paste",
  "cut",
  "copy",
  "dragstart",
  "drop",
] as const;

function readStoredActivity(): number | null {
  try {
    const v = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (!v) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

function writeStoredActivity(now: number) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
  } catch {
    // ignore
  }
}

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

  // Keep refs in sync so interval / storage handler always calls latest
  useEffect(() => {
    doLogoutRef.current = doLogout;
  }, [doLogout]);

  const scheduleTimers = useCallback(() => {
    clearTimers();
    const elapsed = Date.now() - lastActivityRef.current;
    const warnDelay = Math.max(0, WARN_MS - elapsed);
    const idleDelay = Math.max(0, IDLE_MS - elapsed);

    warnTimerRef.current = window.setTimeout(() => {
      // Re-check elapsed at fire time — activity may have happened after schedule
      const cur = Date.now() - lastActivityRef.current;
      if (cur >= WARN_MS && cur < IDLE_MS) {
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

  // Core: always update lastActivityRef immediately on any interaction,
  // throttle only the expensive side-effects (storage + timer reschedule + warning dismiss).
  // This prevents the old bug where rapid mousemove within throttle window left
  // lastActivityRef stale and caused premature logout checks to think idle >=30m.
  const resetActivity = useCallback(() => {
    const now = Date.now();
    // Always record the true last activity moment
    lastActivityRef.current = now;

    // If warning is open, dismiss immediately on ANY activity (not throttled)
    // Previous throttle could leave warning open for up to 1s while user was already active.
    if (warnOpenRef.current) {
      warnOpenRef.current = false;
      setWarnOpen(false);
      // Need to reschedule timers right away when dismissing warning
      lastResetRef.current = now;
      writeStoredActivity(now);
      scheduleTimers();
      return;
    }

    // Throttle the heavy work: storage write + timer reschedule
    if (now - lastResetRef.current < THROTTLE_MS) return;
    lastResetRef.current = now;
    writeStoredActivity(now);
    scheduleTimers();
  }, [scheduleTimers]);

  const handleExternalActivity = useCallback(() => {
    // Called when another tab reports activity via localStorage
    const stored = readStoredActivity();
    const now = stored ?? Date.now();
    lastActivityRef.current = now;
    lastResetRef.current = now;
    if (warnOpenRef.current) {
      warnOpenRef.current = false;
      setWarnOpen(false);
    }
    scheduleTimers();
  }, [scheduleTimers]);

  // Sync from storage before making idle decisions — fixes cross-tab race where
  // background tab's visibilitychange fired before interval had synced the active tab's timestamp.
  const syncFromStorage = useCallback(() => {
    const stored = readStoredActivity();
    if (stored !== null && stored > lastActivityRef.current) {
      lastActivityRef.current = stored;
      // Also keep throttle ref in sync so we don't immediately throttle next real activity
      if (stored > lastResetRef.current) lastResetRef.current = stored;
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    // Init last activity from storage if another tab was active more recently
    const stored = readStoredActivity();
    if (stored !== null && stored > lastActivityRef.current) {
      lastActivityRef.current = stored;
      lastResetRef.current = stored;
    } else {
      writeStoredActivity(lastActivityRef.current);
    }

    scheduleTimers();

    const handleActivity = () => resetActivity();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY && e.newValue) {
        const v = Number(e.newValue);
        if (!Number.isNaN(v) && v > lastActivityRef.current) {
          lastActivityRef.current = v;
          // Defer handling to avoid thrashing on rapid writes
          if (Date.now() - lastResetRef.current > THROTTLE_MS) {
            handleExternalActivity();
          }
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        // Sync first — another tab may have been active while we were hidden
        syncFromStorage();
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
      syncFromStorage();
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= IDLE_MS) {
        void doLogoutRef.current();
        return;
      }
      if (elapsed < IDLE_MS) {
        scheduleTimersRef.current();
      }
    };

    // Use capture phase so stopPropagation inside components cannot hide events
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    for (const ev of ACTIVITY_EVENTS) {
      document.addEventListener(ev, handleActivity, opts as any);
      window.addEventListener(ev, handleActivity, opts as any);
    }
    // Scroll doesn't bubble reliably — capture at both levels + specific main container
    const onScroll = () => handleActivity();
    window.addEventListener("scroll", onScroll, { passive: true, capture: true } as any);
    document.addEventListener("scroll", onScroll, { passive: true, capture: true } as any);
    const mainEl = document.getElementById("main-content");
    if (mainEl) mainEl.addEventListener("scroll", onScroll, { passive: true, capture: true } as any);

    // Also watch for future main-content re-mounts (SPA navigation may replace it)
    let observer: MutationObserver | null = null;
    try {
      observer = new MutationObserver(() => {
        const el = document.getElementById("main-content");
        if (el && !(el as any).__idleScrollBound) {
          (el as any).__idleScrollBound = true;
          el.addEventListener("scroll", onScroll, { passive: true, capture: true } as any);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      // ignore
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("storage", handleStorage);

    // Fallback interval — handles timer throttling when tab is backgrounded and cross-tab sync
    intervalRef.current = window.setInterval(() => {
      // Sync from storage (another tab may have updated)
      syncFromStorage();
      const elapsed = Date.now() - lastActivityRef.current;
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
        document.removeEventListener(ev, handleActivity, opts as any);
        window.removeEventListener(ev, handleActivity, opts as any);
      }
      window.removeEventListener("scroll", onScroll, true as any);
      document.removeEventListener("scroll", onScroll, true as any);
      if (mainEl) mainEl.removeEventListener("scroll", onScroll, true as any);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("storage", handleStorage);
      if (observer) observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onContinue = () => {
    warnOpenRef.current = false;
    setWarnOpen(false);
    const now = Date.now();
    lastActivityRef.current = now;
    lastResetRef.current = now;
    writeStoredActivity(now);
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
