import { describe, it, expect } from "vitest";
import {
  LOCATION_GATE_MESSAGE,
  MAX_ACCURACY_M,
  PING_INTERVAL_MS,
  PING_DISTANCE_M,
  evaluateGateState,
  isFixFresh,
  isAccuracyOk,
  haversineM,
  shouldSendPing,
  istDayKeyFromMs,
  dedupeQueuedPings,
  flagSuspiciousFix,
  nextLiveStatus,
  canBrowseWithoutLocation,
  BLOCKING_GATE_STATES,
  type GateState,
  type GateInput,
  type LiveRow,
  type FixInput,
  type QueuedPing,
} from "@/lib/field-location";

describe("LOCATION_GATE_MESSAGE", () => {
  it("uses the exact transparent copy", () => {
    expect(LOCATION_GATE_MESSAGE).toBe("Turn on GPS and internet, then try again.");
  });
});

describe("canBrowseWithoutLocation", () => {
  it("allows the escape for every state that hard-blocks the portal", () => {
    for (const gate of BLOCKING_GATE_STATES) {
      expect(canBrowseWithoutLocation(gate), `expected escape for ${gate}`).toBe(true);
    }
  });

  it("offers the escape while ON duty too — a denied on-duty engineer is otherwise trapped", () => {
    // The overlay covers the header, so "End duty" is unreachable as well.
    // Regression guard: an earlier revision hid the escape when on duty.
    expect(canBrowseWithoutLocation("denied")).toBe(true);
    expect(canBrowseWithoutLocation("unsupported")).toBe(true);
    expect(canBrowseWithoutLocation("stale")).toBe(true);
  });

  it("offers no escape when the gate is not blocking", () => {
    expect(canBrowseWithoutLocation("ok")).toBe(false);
    expect(canBrowseWithoutLocation("override")).toBe(false);
    expect(canBrowseWithoutLocation("off_duty")).toBe(false);
  });

  it("does not treat a non-blocking state as blocking by accident", () => {
    const all: GateState[] = [
      "checking",
      "ok",
      "gps_off",
      "denied",
      "no_fix",
      "stale",
      "revoked",
      "off_duty",
      "override",
      "unsupported",
    ];
    const blocking = all.filter(canBrowseWithoutLocation);
    const nonBlocking = all.filter((g) => !canBrowseWithoutLocation(g));
    expect(blocking).toHaveLength(BLOCKING_GATE_STATES.length);
    expect(nonBlocking).toEqual(["ok", "off_duty", "override"]);
  });
});

describe("isFixFresh", () => {
  const now = Date.parse("2026-09-18T10:00:00Z");
  it("is fresh inside the grace window", () => {
    expect(isFixFresh(new Date(now - 60_000).toISOString(), now, 15 * 60_000)).toBe(true);
  });
  it("is stale past the grace window", () => {
    expect(isFixFresh(new Date(now - 16 * 60_000).toISOString(), now, 15 * 60_000)).toBe(false);
  });
  it("treats missing/invalid timestamps as stale", () => {
    expect(isFixFresh(null, now, 15 * 60_000)).toBe(false);
    expect(isFixFresh("not-a-date", now, 15 * 60_000)).toBe(false);
  });
  it("treats future timestamps as fresh (clock skew tolerance)", () => {
    expect(isFixFresh(new Date(now + 60_000).toISOString(), now, 15 * 60_000)).toBe(true);
  });
});

describe("isAccuracyOk", () => {
  it("accepts fixes at or under the threshold", () => {
    expect(isAccuracyOk(50)).toBe(true);
    expect(isAccuracyOk(MAX_ACCURACY_M)).toBe(true);
    expect(isAccuracyOk(150)).toBe(true);
  });
  it("rejects low-accuracy fixes", () => {
    expect(isAccuracyOk(151)).toBe(false);
    expect(isAccuracyOk(1200)).toBe(false);
  });
  it("rejects null/NaN/negative accuracy", () => {
    expect(isAccuracyOk(null)).toBe(false);
    expect(isAccuracyOk(NaN)).toBe(false);
    expect(isAccuracyOk(-1)).toBe(false);
  });
});

describe("haversineM", () => {
  it("is ~111km per degree of latitude", () => {
    const d = haversineM(12.9716, 77.5946, 13.9716, 77.5946);
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
  it("is zero for identical points", () => {
    expect(haversineM(12.5, 77.5, 12.5, 77.5)).toBe(0);
  });
  it("is symmetric", () => {
    const a = haversineM(12.9, 77.6, 13.1, 77.9);
    const b = haversineM(13.1, 77.9, 12.9, 77.6);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });
});

describe("shouldSendPing", () => {
  const base = { lat: 12.9716, long: 77.5946, at: 1_000_000 };
  it("sends the first fix", () => {
    expect(shouldSendPing(null, base)).toBe(true);
  });
  it("throttles fixes inside the time AND distance window", () => {
    const last = { ...base };
    expect(shouldSendPing(last, { ...base, at: base.at + 10_000 })).toBe(false);
  });
  it("sends after the interval even without movement", () => {
    const last = { ...base };
    expect(shouldSendPing(last, { ...base, at: base.at + PING_INTERVAL_MS + 1 })).toBe(true);
  });
  it("sends on significant movement even inside the interval", () => {
    const last = { ...base };
    // ~1.1km north — well past PING_DISTANCE_M.
    expect(
      shouldSendPing(last, { lat: base.lat + 0.01, long: base.long, at: base.at + 5_000 }),
    ).toBe(true);
  });
  it("suppresses jitter under the distance floor", () => {
    const last = { ...base };
    expect(
      shouldSendPing(last, { lat: base.lat + 0.0001, long: base.long, at: base.at + 5_000 }),
    ).toBe(false);
  });
});

describe("istDayKeyFromMs", () => {
  it("pins Asia/Kolkata regardless of device zone", () => {
    // 2026-09-18 00:30 IST == 2026-09-17 19:00Z.
    expect(istDayKeyFromMs(Date.parse("2026-09-17T19:00:00Z"))).toBe("2026-09-18");
    expect(istDayKeyFromMs(Date.parse("2026-09-17T18:29:00Z"))).toBe("2026-09-17");
  });
});

describe("evaluateGateState", () => {
  const fresh = new Date(Date.parse("2026-09-18T10:00:00Z") - 60_000).toISOString();
  const base: GateInput = {
    permission: "granted",
    onDuty: true,
    lastSeenAt: fresh,
    nowMs: Date.parse("2026-09-18T10:00:00Z"),
    graceMs: 15 * 60_000,
    overrideActive: false,
  };
  const cases: Array<[string, Partial<GateInput>, GateState]> = [
    ["passes with a fresh on-duty fix", {}, "ok"],
    ["honours an active manager override", { lastSeenAt: null, overrideActive: true }, "override"],
    ["blocks when off duty", { onDuty: false }, "off_duty"],
    ["maps denied permission", { permission: "denied" as const }, "denied"],
    ["maps revoked mid-shift", { permission: "revoked" as const }, "revoked"],
    ["shows enabling state while prompting", { permission: "prompt" as const }, "checking"],
    ["reports no_fix when never seen", { lastSeenAt: null }, "no_fix"],
    [
      "reports stale when the fix aged out",
      { lastSeenAt: new Date(base.nowMs - 3600_000).toISOString() },
      "stale",
    ],
    ["reports gps_off for position-unavailable", { failure: "unavailable" as const }, "gps_off"],
    [
      "passes through a stale fix when tracking is disabled (kill switch)",
      {
        trackingEnabled: false,
        lastSeenAt: new Date(base.nowMs - 3600_000).toISOString(),
      },
      "ok",
    ],
    [
      "passes through denied permission when tracking is disabled (kill switch)",
      { trackingEnabled: false, permission: "denied" as const, lastSeenAt: null },
      "ok",
    ],
    [
      "keeps the gate when trackingEnabled is unknown (fail-closed client)",
      {
        trackingEnabled: undefined,
        lastSeenAt: new Date(base.nowMs - 3600_000).toISOString(),
      },
      "stale",
    ],
  ];
  for (const [name, patch, expected] of cases) {
    it(name, () => {
      expect(evaluateGateState({ ...base, ...patch })).toBe(expected);
    });
  }
  it("treats a bad-accuracy fix as no_fix, never ok", () => {
    expect(evaluateGateState({ ...base, accuracy: 500 })).toBe("no_fix");
  });
  it("ignores a good-accuracy fix (stays ok)", () => {
    expect(evaluateGateState({ ...base, accuracy: 12 })).toBe("ok");
  });
  it("override wins over stale but never over off-duty", () => {
    expect(
      evaluateGateState({
        ...base,
        onDuty: false,
        overrideActive: true,
        lastSeenAt: null,
      }),
    ).toBe("off_duty");
  });
});

describe("evaluateGateState — login-time entry gate", () => {
  const base: GateInput = {
    permission: "granted",
    onDuty: false,
    lastSeenAt: null,
    nowMs: Date.parse("2026-09-18T10:00:00Z"),
    graceMs: 15 * 60_000,
    overrideActive: false,
  };

  it("gates an off-duty engineer whose permission is still undecided", () => {
    expect(evaluateGateState({ ...base, entryGate: true, permission: "prompt" })).toBe("checking");
  });

  it("gates an off-duty engineer whose permission was denied", () => {
    expect(evaluateGateState({ ...base, entryGate: true, permission: "denied" })).toBe("denied");
  });

  it("gates an off-duty engineer whose permission was revoked", () => {
    expect(evaluateGateState({ ...base, entryGate: true, permission: "revoked" })).toBe("revoked");
  });

  it("gates an off-duty engineer on an unsupported device", () => {
    expect(evaluateGateState({ ...base, entryGate: true, permission: "unsupported" })).toBe(
      "unsupported",
    );
  });

  it("restores off-duty browsing once permission is granted", () => {
    expect(evaluateGateState({ ...base, entryGate: true, permission: "granted" })).toBe("off_duty");
  });

  it("still gates an on-duty engineer with undecided permission", () => {
    expect(
      evaluateGateState({ ...base, entryGate: true, onDuty: true, permission: "prompt" }),
    ).toBe("checking");
  });

  it("yields to the kill switch — disabled tracking requires no permission", () => {
    expect(
      evaluateGateState({
        ...base,
        entryGate: true,
        permission: "denied",
        trackingEnabled: false,
      }),
    ).toBe("off_duty");
  });

  it("yields to a live manager override", () => {
    expect(
      evaluateGateState({
        ...base,
        entryGate: true,
        onDuty: true,
        permission: "denied",
        overrideActive: true,
        lastSeenAt: new Date(base.nowMs - 60_000).toISOString(),
      }),
    ).toBe("override");
  });

  it("preserves the legacy off-duty contract when the entry gate is not opted in", () => {
    expect(evaluateGateState({ ...base, permission: "prompt" })).toBe("off_duty");
    expect(evaluateGateState({ ...base, permission: "denied" })).toBe("off_duty");
  });
});

describe("dedupeQueuedPings", () => {
  const ping = (id: string, at: string): QueuedPing => ({
    client_ping_id: id,
    lat: 12.9,
    long: 77.6,
    accuracy: 20,
    captured_at: at,
  });
  it("drops duplicate client ids keeping the first, ordered by captured_at", () => {
    const out = dedupeQueuedPings([
      ping("b", "2026-09-18T10:02:00Z"),
      ping("a", "2026-09-18T10:01:00Z"),
      ping("a", "2026-09-18T10:01:00Z"),
    ]);
    expect(out.map((p: QueuedPing) => p.client_ping_id)).toEqual(["a", "b"]);
  });
  it("drops rows with invalid coords", () => {
    const bad: QueuedPing = { ...ping("x", "2026-09-18T10:01:00Z"), lat: 91 };
    expect(dedupeQueuedPings([bad])).toEqual([]);
  });
});

describe("flagSuspiciousFix", () => {
  it("flags zero-accuracy fixes", () => {
    expect(
      flagSuspiciousFix({ accuracy: 0, speedKmh: null, clockSkewMs: 0 }).length,
    ).toBeGreaterThan(0);
  });
  it("flags impossible speed", () => {
    expect(
      flagSuspiciousFix({ accuracy: 10, speedKmh: 250, clockSkewMs: 0 }).length,
    ).toBeGreaterThan(0);
  });
  it("flags large client/server clock skew", () => {
    expect(
      flagSuspiciousFix({ accuracy: 10, speedKmh: 20, clockSkewMs: 10 * 60_000 }).length,
    ).toBeGreaterThan(0);
  });
  it("passes a clean fix", () => {
    expect(flagSuspiciousFix({ accuracy: 12, speedKmh: 28, clockSkewMs: 1500 })).toEqual([]);
  });
});

describe("nextLiveStatus", () => {
  const fix = (at: string): FixInput => ({ lat: 12.9, long: 77.6, accuracy: 12, captured_at: at });
  const row = (seen: string | null): LiveRow => ({
    on_duty: true,
    last_seen_at: seen,
    last_lat: 12.9,
    last_long: 77.6,
    last_accuracy_m: 12,
    session_id: "sess-open",
  });
  it("marks on-duty when the batch belongs to the open session", () => {
    const out = nextLiveStatus({
      current: null,
      latest: fix("2026-09-18T10:00:00Z"),
      openSessionId: "sess-open",
    });
    expect(out.on_duty).toBe(true);
    expect(out.session_id).toBe("sess-open");
    expect(out.last_seen_at).toBe("2026-09-18T10:00:00Z");
  });
  it("never flips on-duty without an open session", () => {
    const out = nextLiveStatus({
      current: null,
      latest: fix("2026-09-18T10:00:00Z"),
      openSessionId: null,
    });
    expect(out.on_duty).toBe(false);
    expect(out.last_seen_at).toBeNull();
  });
  it("heals an orphan live row when its session is gone", () => {
    const out = nextLiveStatus({
      current: row("2026-09-18T10:00:00Z"),
      latest: fix("2026-09-18T10:01:00Z"),
      openSessionId: null,
    });
    expect(out.on_duty).toBe(false);
    expect(out.session_id).toBeNull();
    expect(out.last_seen_at).toBe("2026-09-18T10:00:00Z");
  });
  it("never moves last_seen_at backwards (delayed queue flush)", () => {
    const out = nextLiveStatus({
      current: row("2026-09-18T10:00:00Z"),
      latest: fix("2026-09-17T10:00:00Z"),
      openSessionId: "sess-open",
    });
    expect(out.on_duty).toBe(true);
    expect(out.last_seen_at).toBe("2026-09-18T10:00:00Z");
    expect(out.last_lat).toBe(12.9);
  });
  it("adopts a same-or-newer fix", () => {
    const out = nextLiveStatus({
      current: row("2026-09-18T10:00:00Z"),
      latest: { ...fix("2026-09-18T10:05:00Z"), lat: 13.0 },
      openSessionId: "sess-open",
    });
    expect(out.last_seen_at).toBe("2026-09-18T10:05:00Z");
    expect(out.last_lat).toBe(13.0);
  });
});
