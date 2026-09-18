import { LOCATION_REQUIRED } from "@/lib/field-location";

/**
 * Central gate-denial interception for plain RPC callables.
 *
 * The gated server fns are invoked directly (not through react-query
 * mutations), so no global mutation hook can catch their 403s. Call sites
 * add one line — `announceLocationDenial(err)` — to their existing catch
 * blocks; the eng shell listens and raises the duty prompt.
 */
export const LOCATION_DENIED_EVENT = "field-location-required";

export function isLocationDenial(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === LOCATION_REQUIRED;
}

/** Dispatch the shell event when `e` is a gate denial. No-op otherwise. */
export function announceLocationDenial(e: unknown): boolean {
  if (!isLocationDenial(e)) return false;
  raiseDutyPrompt();
  return true;
}

/**
 * Raise the duty prompt unconditionally — for client-side pre-checks
 * (e.g. direct-RLS writes like visit times) where no 403 can occur.
 */
export function raiseDutyPrompt(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCATION_DENIED_EVENT));
  }
}
