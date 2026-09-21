import { useEffect, useState } from "react";
import {
  evaluateGateState,
  LOCATION_GATE_MESSAGE,
  LOCATION_GRACE_MS,
  type GateState,
} from "@/lib/field-location";
import { useDutyTracker, type DutyFailure } from "@/hooks/useDutyTracker";

export type GateView = {
  gate: GateState;
  /** Primary line. Exact gate copy for GPS states (never reworded). */
  headline: string | null;
  /** Secondary hint distinguishing denied vs off vs stale. */
  hint: string | null;
  nowMs: number;
  /**
   * Whether a duty session is live. The gate name alone cannot answer this:
   * the entry gate short-circuits OFF duty and reports `checking`/`denied`,
   * never `off_duty`. Callers that need "may this engineer browse read-only?"
   * must use this, not `gate === "off_duty"`.
   */
  onDuty: boolean;
  retry: () => Promise<void>;
  retrying: boolean;
};

/**
 * Gate selector over the shared duty tracker. Ticks every 15s so a passing
 * fix ages into "stale" without navigation (no flicker: state lives in the
 * layout, not per route).
 */
export function useLocationGate(): GateView {
  const t = useDutyTracker();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const permission = t.permission === "checking" ? "prompt" : t.permission;
  const failure: DutyFailure = t.failure;
  const gate: GateState = t.loading
    ? "checking"
    : evaluateGateState({
        permission: permission as "granted" | "denied" | "revoked" | "prompt" | "unsupported",
        onDuty: t.onDuty,
        lastSeenAt: t.lastSeenAt,
        nowMs,
        graceMs: LOCATION_GRACE_MS,
        overrideActive: t.overrideActive,
        failure,
        accuracy: t.lastAccuracy,
        trackingEnabled: t.trackingEnabled,
        // Login-time permission ask (product decision): the portal gates on
        // entry, before Start duty, until location permission is granted.
        entryGate: true,
      });

  let headline: string | null = null;
  let hint: string | null = null;
  switch (gate) {
    case "ok":
    case "override":
      break;
    case "checking":
      // "checking" doubles as the initial load state and the login-time
      // permission ask. Only the latter is a real decision the engineer must
      // make, so the copy forks on whether the permission state has resolved.
      if (t.permission === "checking") {
        headline = "Checking location…";
      } else {
        headline = "Allow location access";
        hint =
          "The engineer portal needs your location permission. Tap Enable location and choose Allow.";
      }
      break;
    case "off_duty":
      headline = "Your attendance isn't marked yet.";
      hint = "Mark attendance to use the engineer portal.";
      break;
    case "denied":
      headline = LOCATION_GATE_MESSAGE;
      hint = "Location permission is denied. Enable location for this site in Settings and retry.";
      break;
    case "revoked":
      headline = LOCATION_GATE_MESSAGE;
      hint = "Location was turned off. Turn it back on and retry.";
      break;
    case "gps_off":
      headline = LOCATION_GATE_MESSAGE;
      hint = "Your phone could not get a fix. Move outdoors and retry.";
      break;
    case "no_fix":
      headline = LOCATION_GATE_MESSAGE;
      hint = "Waiting for the first location fix…";
      break;
    case "stale":
      headline = LOCATION_GATE_MESSAGE;
      hint = "Last location is too old. Turn on location and internet, then try again.";
      break;
    case "unsupported":
      headline = "Location is not supported on this device.";
      hint = "Contact your administrator for an override.";
      break;
  }

  const retry = async () => {
    setRetrying(true);
    try {
      await t.retry();
      setNowMs(Date.now());
    } finally {
      setRetrying(false);
    }
  };

  return { gate, headline, hint, nowMs, onDuty: t.onDuty, retry, retrying };
}
