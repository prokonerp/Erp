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
  type GateState,
  type GateInput,
  type QueuedPing,
} from "@/lib/field-location";

describe("LOCATION_GATE_MESSAGE", () => {
  it("uses the exact transparent copy", () => {
    expect(LOCATION_GATE_MESSAGE).toBe("Turn on GPS and internet, then try again.");
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
  ];
  for (const [name, patch, expected] of cases) {
    it(name, () => {
      expect(evaluateGateState({ ...base, ...patch })).toBe(expected);
    });
  }
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
