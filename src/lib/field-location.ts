// Pure field-location decisions for engineer on-duty tracking.
//
// Dependency-free (no React, no Supabase, no DOM) so it is unit-testable in
// plain node. Anything touching geolocation APIs, IndexedDB, or the network
// lives in the hooks / server fns — this module only decides.
//
// Conventions mirrored: IST calendar days (src/lib/time.ts), 60s-class
// throttling (useActivityTracker), explicit copy for the gate.

/** Exact user-facing copy for the blocked gate. Do not reword per call site. */
export const LOCATION_GATE_MESSAGE = "Turn on GPS and internet, then try again.";

/**
 * Machine-readable gate denial code (thrown with statusCode 403 by
 * requireFieldLocation). Lives here — not in the middleware — so client
 * bundles can branch on it without importing server modules.
 */
export const LOCATION_REQUIRED = "LOCATION_REQUIRED";

/** Consent copy version written to engineer_consent_events. Bump on copy change. */
export const DUTY_CONSENT_VERSION = "v1";

/** Fixes worse than this are excluded from distance and never confirm liveness. */
export const MAX_ACCURACY_M = 150;

/** Minimum time between heartbeat pings. */
export const PING_INTERVAL_MS = 45_000;

/** Minimum movement between heartbeat pings. */
export const PING_DISTANCE_M = 100;

/** Fresh-fix grace window after the last confirmed fix (server gate + client). */
export const LOCATION_GRACE_MS = 15 * 60_000;

/** Implied speed above this is physically impossible on road — flag, don't count. */
export const SPOOF_SPEED_KMH = 200;

/** |received_at - captured_at| beyond this suggests a wrong device clock. */
export const CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

/** IST is UTC+5:30 with no DST — a fixed offset is exact, unlike device zones. */
const IST_OFFSET_MS = 5.5 * 3_600_000;

/**
 * True when the last confirmed fix is inside the grace window. Future
 * timestamps (device clock ahead) count as fresh — skew is flagged
 * separately by flagSuspiciousFix, never by locking the engineer out here.
 */
export function isFixFresh(
  lastSeenAt: string | null | undefined,
  nowMs: number,
  graceMs: number,
): boolean {
  if (!lastSeenAt) return false;
  const t = Date.parse(lastSeenAt);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= graceMs;
}

/** True when the fix is usable: finite, non-negative, within threshold. */
export function isAccuracyOk(
  accuracy: number | null | undefined,
  thresholdM: number = MAX_ACCURACY_M,
): boolean {
  return (
    typeof accuracy === "number" &&
    Number.isFinite(accuracy) &&
    accuracy >= 0 &&
    accuracy <= thresholdM
  );
}

/** Great-circle distance in metres between two WGS84 points. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

export type PingPoint = { lat: number; long: number; at: number };

/**
 * Heartbeat throttle: send when there is no previous fix, when the interval
 * elapsed (even stationary — proves liveness), or on significant movement.
 * Sub-threshold jitter is suppressed so indoor drift doesn't spam the DB.
 */
export function shouldSendPing(last: PingPoint | null, next: PingPoint): boolean {
  if (!last) return true;
  if (next.at - last.at >= PING_INTERVAL_MS) return true;
  return haversineM(last.lat, last.long, next.lat, next.long) >= PING_DISTANCE_M;
}

/** IST calendar date (YYYY-MM-DD) for a unix-ms instant. Fixed offset, no DST. */
export function istDayKeyFromMs(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export type GatePermission = "granted" | "prompt" | "denied" | "revoked" | "unsupported";

export type GateState =
  | "checking"
  | "ok"
  | "gps_off"
  | "denied"
  | "no_fix"
  | "stale"
  | "revoked"
  | "off_duty"
  | "override"
  | "unsupported";

export type GateInput = {
  permission: GatePermission;
  onDuty: boolean;
  lastSeenAt: string | null | undefined;
  nowMs: number;
  graceMs: number;
  overrideActive: boolean;
  /** Explicit OS/browser failure from the last geolocation attempt. */
  failure?: "unavailable" | "timeout" | null;
  /** Latest fix accuracy in metres. A fix worse than MAX_ACCURACY_M reads as
   *  no_fix rather than ok — it must never confirm liveness. Absent = unknown. */
  accuracy?: number | null;
  /**
   * Kill-switch state from the duty tracker. Explicit `false` means an admin
   * disabled tracking globally — the server passes gated writes through, so
   * the client must too. Absent/true keeps the normal gate (fail-closed).
   */
  trackingEnabled?: boolean;
};

/**
 * Gate state machine. Order is load-bearing:
 * 1. off-duty always wins (an override never puts someone on duty);
 * 2. kill-switch off passes through (mirrors the server `next()` bypass);
 * 3. a live manager override wins over any location state;
 * 4. explicit permission/failure signals win over cached fixes;
 * 5. otherwise the grace window decides between ok / no_fix / stale.
 */
export function evaluateGateState(input: GateInput): GateState {
  if (!input.onDuty) return "off_duty";
  if (input.trackingEnabled === false) return "ok";
  if (input.overrideActive) return "override";
  switch (input.permission) {
    case "denied":
      return "denied";
    case "revoked":
      return "revoked";
    case "prompt":
      return "checking";
    case "unsupported":
      return "unsupported";
    case "granted":
      break;
  }
  // An explicit OS error means the radio is off or blocked — a cached fix
  // must not paper over it.
  if (input.failure === "unavailable" || input.failure === "timeout") return "gps_off";
  if (!input.lastSeenAt) return "no_fix";
  if (input.accuracy !== undefined && !isAccuracyOk(input.accuracy)) return "no_fix";
  return isFixFresh(input.lastSeenAt, input.nowMs, input.graceMs) ? "ok" : "stale";
}

export type LiveRow = {
  on_duty: boolean;
  last_seen_at: string | null;
  last_lat: number | null;
  last_long: number | null;
  last_accuracy_m: number | null;
  session_id: string | null;
};

export type FixInput = {
  lat: number;
  long: number;
  accuracy: number | null;
  captured_at: string;
};

const OFF_DUTY_ROW: LiveRow = {
  on_duty: false,
  last_seen_at: null,
  last_lat: null,
  last_long: null,
  last_accuracy_m: null,
  session_id: null,
};

/**
 * Next live-status row for an incoming fix. Two invariants:
 * 1. `on_duty` follows the OPEN SESSION, never the batch — a ping with no
 *    open session can neither mark on-duty nor move liveness (off-duty
 *    fixes stay out of the live row entirely). A live row whose session is
 *    gone self-heals to off-duty instead of lingering as an orphan.
 * 2. `last_seen_at` is monotonic — a delayed queue flush (old captured_at)
 *    must never move a fresher fix backwards and re-gate a working engineer.
 */
export function nextLiveStatus(input: {
  current: LiveRow | null;
  latest: FixInput;
  openSessionId: string | null;
}): LiveRow {
  const { current, latest, openSessionId } = input;
  if (openSessionId == null) {
    if (!current) return { ...OFF_DUTY_ROW };
    return { ...current, on_duty: false, session_id: null };
  }
  const incomingMs = Date.parse(latest.captured_at);
  const currentMs = current?.last_seen_at ? Date.parse(current.last_seen_at) : NaN;
  const isNewer =
    Number.isFinite(incomingMs) && (!Number.isFinite(currentMs) || incomingMs >= currentMs);
  return {
    on_duty: true,
    session_id: openSessionId,
    last_seen_at: isNewer ? latest.captured_at : (current?.last_seen_at ?? null),
    last_lat: isNewer ? latest.lat : (current?.last_lat ?? null),
    last_long: isNewer ? latest.long : (current?.last_long ?? null),
    last_accuracy_m: isNewer ? latest.accuracy : (current?.last_accuracy_m ?? null),
  };
}

export type QueuedPing = {
  client_ping_id: string;
  lat: number;
  long: number;
  accuracy: number | null;
  captured_at: string;
  ticket_id?: string | null;
  source?: string;
};

function isValidCoord(lat: number, long: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(long) &&
    lat >= -90 &&
    lat <= 90 &&
    long >= -180 &&
    long <= 180
  );
}

/**
 * Exactly-once flush preparation: drop invalid coords, dedupe by
 * client_ping_id (first wins), order by captured_at for the batched upsert.
 */
export function dedupeQueuedPings(pings: QueuedPing[]): QueuedPing[] {
  const seen = new Set<string>();
  const out: QueuedPing[] = [];
  for (const p of pings) {
    if (!p || seen.has(p.client_ping_id)) continue;
    if (!isValidCoord(p.lat, p.long)) continue;
    seen.add(p.client_ping_id);
    out.push(p);
  }
  out.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at));
  return out;
}

export type SpoofSignal = "zero_accuracy" | "impossible_speed" | "clock_skew";

/**
 * Heuristics for impossible/fake fixes. Advisory only — the server records
 * and flags for review; it never accuses the engineer in the UI.
 */
export function flagSuspiciousFix(input: {
  accuracy: number | null;
  speedKmh: number | null;
  clockSkewMs: number;
}): SpoofSignal[] {
  const flags: SpoofSignal[] = [];
  if (input.accuracy === 0) flags.push("zero_accuracy");
  if (typeof input.speedKmh === "number" && input.speedKmh > SPOOF_SPEED_KMH) {
    flags.push("impossible_speed");
  }
  if (Math.abs(input.clockSkewMs) > CLOCK_SKEW_TOLERANCE_MS) flags.push("clock_skew");
  return flags;
}
