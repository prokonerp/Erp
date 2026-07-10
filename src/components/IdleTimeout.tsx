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
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const;

export function IdleTimeout() {
  const navigate = useNavigate();
  const [warnOpen, setWarnOpen] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const warnTimerRef = useRef<number | null>(null);
  const logoutTimerRef = useRef<number | null>(null);
  const warnOpenRef = useRef(false);

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

  const scheduleTimers = useCallback(() => {
    clearTimers();
    warnTimerRef.current = window.setTimeout(() => {
      warnOpenRef.current = true;
      setWarnOpen(true);
    }, WARN_MS);
    logoutTimerRef.current = window.setTimeout(() => {
      void doLogout();
    }, IDLE_MS);
  }, [clearTimers, doLogout]);

  const resetActivity = useCallback(() => {
    // If the warning dialog is open, don't silently reset — user must click Continue.
    if (warnOpenRef.current) return;
    lastActivityRef.current = Date.now();
    scheduleTimers();
  }, [scheduleTimers]);

  useEffect(() => {
    scheduleTimers();

    const handleActivity = () => resetActivity();
    const handleFocus = () => resetActivity();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") resetActivity();
    };

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, handleActivity, { passive: true });
    }
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimers();
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, handleActivity);
      }
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onContinue = () => {
    warnOpenRef.current = false;
    setWarnOpen(false);
    lastActivityRef.current = Date.now();
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
            You have been inactive for 25 minutes. Your session will expire in 5
            minutes unless you continue working.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onLogoutNow}>Logout Now</AlertDialogCancel>
          <AlertDialogAction onClick={onContinue}>
            Continue Session
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}