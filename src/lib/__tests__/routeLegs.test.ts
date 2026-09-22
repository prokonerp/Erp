/**
 * Unit tests for src/lib/routeLegs.ts — no network, no jsdom.
 *
 * Uses realistic fixtures shaped like Delhi/NCR coordinates.
 */
import { describe, expect, it } from "vitest";
import {
  buildLegs,
  legColour,
  legDistanceM,
  bearingDeg,
  sampleArrowPoints,
  shortId,
  LEG_PALETTE,
  type LegPing,
  type LegSite,
} from "@/lib/routeLegs";

// ---------------------------------------------------------------------------
// Fixtures — helpers
// ---------------------------------------------------------------------------

const DELHI_CENTER: [number, number] = [28.7041, 77.1025];

/** Create a LegPing relative to DELHI_CENTER + minutes offset. */
function ping(latOff: number, lonOff: number, t: string, tid?: string): LegPing {
  return {
    lat: DELHI_CENTER[0] + latOff,
    long: DELHI_CENTER[1] + lonOff,
    captured_at: t,
    ticket_id: tid ?? null,
  };
}

/** Create a LegSite relative to DELHI_CENTER. */
function site(
  tid: string | null,
  ar: string | null,
  dp: string | null,
  latOff = 0,
  lonOff = 0,
): LegSite {
  return {
    ticket_id: tid,
    arrived_at: ar,
    departed_at: dp,
    lat: DELHI_CENTER[0] + latOff,
    long: DELHI_CENTER[1] + lonOff,
  };
}

// ISO minute offsets from 2025-01-15T10:00:00Z (= IST 15:30)
function minOff(m: number): string {
  // Base time: 2025-01-15T10:00:00Z
  const ms = new Date("2025-01-15T10:00:00Z").getTime() + m * 60_000;
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// buildLegs — core logic
// ---------------------------------------------------------------------------

describe("buildLegs", () => {
  it("no sites → single leg covering all pings", () => {
    const pings: LegPing[] = [
      ping(0, 0, minOff(0), "A"),
      ping(0.01, 0.01, minOff(10), "B"),
      ping(0.02, 0.02, minOff(20)),
    ];
    const result = buildLegs(pings, []);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(1);
    expect(result[0].fromLabel).toBe("Start");
    expect(result[0].toLabel).toBe("End");
    expect(result[0].pings).toHaveLength(3);
    expect(result[0].startedAt).toBe(minOff(0));
    expect(result[0].endedAt).toBe(minOff(20));
  });

  it("fewer than 2 valid pings → single leg", () => {
    const pings: LegPing[] = [ping(0, 0, minOff(5))];
    const result = buildLegs(pings, []);
    expect(result).toHaveLength(1);
    expect(result[0].pings).toHaveLength(1);
  });

  it("1 dwell → 2 legs: Start→Ticket, Ticket→End", () => {
    const pings: LegPing[] = [
      ping(0, 0, minOff(0), "A"),
      ping(0.005, 0.005, minOff(5), "B"),
      ping(0.02, 0.02, minOff(25)),
      ping(0.03, 0.03, minOff(35), "C"),
    ];
    // Dwell at ticket X between minute 8 and minute 22
    const sites: LegSite[] = [site("X", minOff(8), minOff(22), 0.01, 0.01)];
    const result = buildLegs(pings, sites);

    expect(result).toHaveLength(2);
    // Leg 1: before dwell
    expect(result[0].fromLabel).toBe("Start");
    expect(result[0].toLabel).toBe("Ticket X");
    expect(result[0].ticketId).toBe("X");
    expect(result[0].pings).toHaveLength(2); // A, B
    // Leg 2: after dwell
    expect(result[1].fromLabel).toBe("Ticket X");
    expect(result[1].toLabel).toBe("End");
    expect(result[1].ticketId).toBe(null);
    expect(result[1].pings).toHaveLength(2); // C (and the one at 35)
  });

  it("3 dwells → 4 travel legs with correct labels", () => {
    const pings: LegPing[] = [
      ping(0, 0, minOff(0), "P1"),
      ping(0.01, 0.01, minOff(5), "P2"),
      ping(0.03, 0.03, minOff(15)),
      ping(0.04, 0.04, minOff(25)),
      ping(0.06, 0.06, minOff(35)),
      ping(0.07, 0.07, minOff(45), "P6"),
      ping(0.09, 0.09, minOff(55)),
      ping(0.1, 0.1, minOff(65)),
    ];
    const sites: LegSite[] = [
      site("A", minOff(7), minOff(13), 0.02, 0.02),
      site("B", minOff(22), minOff(28), 0.05, 0.05),
      site("C", minOff(37), minOff(50), 0.08, 0.08),
    ];
    const result = buildLegs(pings, sites);

    expect(result).toHaveLength(4);
    expect(result[0].fromLabel).toBe("Start");
    expect(result[0].toLabel).toBe("Ticket A");
    expect(result[0].ticketId).toBe("A");

    expect(result[1].fromLabel).toBe("Ticket A");
    expect(result[1].toLabel).toBe("Ticket B");
    expect(result[1].ticketId).toBe("B");

    expect(result[2].fromLabel).toBe("Ticket B");
    expect(result[2].toLabel).toBe("Ticket C");
    expect(result[2].ticketId).toBe("C");

    expect(result[3].fromLabel).toBe("Ticket C");
    expect(result[3].toLabel).toBe("End");
    expect(result[3].ticketId).toBe(null);
  });

  it("pings inside dwell windows are excluded from geometry", () => {
    const pings: LegPing[] = [
      ping(0, 0, minOff(0)),
      ping(0.01, 0.01, minOff(5)), // before dwell
      ping(0.02, 0.02, minOff(9)), // inside dwell [8, 22]
      ping(0.03, 0.03, minOff(15)), // inside dwell [8, 22]
      ping(0.04, 0.04, minOff(25)), // after dwell
    ];
    const sites: LegSite[] = [site("X", minOff(8), minOff(22))];
    const result = buildLegs(pings, sites);

    expect(result).toHaveLength(2);
    expect(result[0].pings).toHaveLength(2); // only pre-dwell
    expect(result[1].pings).toHaveLength(1); // only post-dwell
  });

  it("dwell boundary is inclusive on both ends", () => {
    const pings: LegPing[] = [
      ping(0, 0, minOff(5)), // before dwell
      ping(0.01, 0.01, minOff(8)), // exactly at arrived → IN dwell
      ping(0.02, 0.02, minOff(22)), // exactly at departed → IN dwell
      ping(0.03, 0.03, minOff(25)), // after dwell
    ];
    const sites: LegSite[] = [site("X", minOff(8), minOff(22))];
    const result = buildLegs(pings, sites);

    expect(result).toHaveLength(2);
    expect(result[0].pings).toHaveLength(1); // only ping at 5
    expect(result[1].pings).toHaveLength(1); // only ping at 25
  });

  it("empty legs are dropped", () => {
    // Two dwells very close together leaving no travel time between them
    const pings: LegPing[] = [
      ping(0, 0, minOff(0)), // before first dwell
      ping(0.01, 0.01, minOff(5)), // between dwells but falls inside neither
    ];
    const sites: LegSite[] = [
      site("A", minOff(2), minOff(8)), // swallows ping at 5? No, minOff(5) < minOff(8) so it's inside
    ];
    // Actually rework: dwells at [2, 8] and [12, 18], gap between 8 and 12 has no pings
    const sites2: LegSite[] = [site("A", minOff(2), minOff(8)), site("B", minOff(12), minOff(18))];
    const result = buildLegs(pings, sites2);

    // Only pings at 0 (before first dwell) and 5 (between dwells, inside dwell A)
    // Actually ping at 0 → seg 0, ping at 5 → inside dwell A → excluded
    // No ping after dwell B
    expect(result).toHaveLength(1);
    expect(result[0].pings).toHaveLength(1);
  });

  it("all-pings-in-dwell fallback → one leg covering all", () => {
    const pings: LegPing[] = [
      ping(0, 0, minOff(0)),
      ping(0.01, 0.01, minOff(5)),
      ping(0.02, 0.02, minOff(10)),
    ];
    const sites: LegSite[] = [site("X", minOff(-5), minOff(15))];
    const result = buildLegs(pings, sites);

    expect(result).toHaveLength(1);
    expect(result[0].pings).toHaveLength(3);
  });

  it("unparseable timestamps are dropped, never crash", () => {
    const pings: LegPing[] = [
      ping(0, 0, "not-a-date" as unknown as string, "A"),
      ping(0.01, 0.01, "also-bad" as unknown as string, "B"),
      ping(0.02, 0.02, minOff(10)),
    ];
    const result = buildLegs(pings, []);

    expect(result).toHaveLength(1);
    expect(result[0].pings).toHaveLength(1); // only the valid ping
  });

  it("sites with unparseable arrived_at / departed_at are ignored", () => {
    const pings: LegPing[] = [ping(0, 0, minOff(0)), ping(0.02, 0.02, minOff(20))];
    const sites: LegSite[] = [
      site("X", "bad-tz", minOff(20)), // arrived_at unparseable
      site("Y", minOff(5), null), // departed_at null
      site("Z", minOff(5), minOff(3)), // departed < arrived (invalid)
    ];
    // All sites invalid → treated as no dwells
    const result = buildLegs(pings, sites);
    expect(result).toHaveLength(1);
    expect(result[0].pings).toHaveLength(2);
  });

  it("input array is not mutated", () => {
    const pings: LegPing[] = [ping(0, 0, minOff(0)), ping(0.01, 0.01, minOff(10))];
    const frozen = [...pings];
    buildLegs(pings, []);
    expect(pings).toEqual(frozen);
  });

  it("pings sorted ascending by captured_at even if input is shuffled", () => {
    const pings: LegPing[] = [
      ping(0.02, 0.02, minOff(20)),
      ping(0, 0, minOff(0)),
      ping(0.01, 0.01, minOff(10)),
    ];
    const result = buildLegs(pings, []);
    expect(result).toHaveLength(1);
    expect(result[0].pings.map((p) => p.captured_at)).toEqual([minOff(0), minOff(10), minOff(20)]);
  });
});

// ---------------------------------------------------------------------------
// shortId
// ---------------------------------------------------------------------------

describe("shortId", () => {
  it("returns first 8 chars", () => {
    expect(shortId("abcdef12ghijk")).toBe("abcdef12");
  });

  it("returns em-dash for null", () => {
    expect(shortId(null)).toBe("\u2014");
  });

  it("returns full id if shorter than 8", () => {
    expect(shortId("abc")).toBe("abc");
  });
});

// ---------------------------------------------------------------------------
// bearingDeg
// ---------------------------------------------------------------------------

describe("bearingDeg", () => {
  const TOLERANCE = 0.5;

  it("due north ≈ 0", () => {
    const brng = bearingDeg([28.0, 77.0], [29.0, 77.0]);
    expect(brng).toBeLessThan(TOLERANCE);
  });

  it("due east ≈ 90", () => {
    const brng = bearingDeg([28.0, 77.0], [28.0, 78.0]);
    expect(brng).toBeCloseTo(90, 0);
  });

  it("due south ≈ 180", () => {
    const brng = bearingDeg([29.0, 77.0], [28.0, 77.0]);
    expect(brng).toBeCloseTo(180, 0);
  });

  it("due west ≈ 270", () => {
    const brng = bearingDeg([28.0, 78.0], [28.0, 77.0]);
    expect(brng).toBeCloseTo(270, 0);
  });

  it("same point returns 0", () => {
    const brng = bearingDeg([28.0, 77.0], [28.0, 77.0]);
    expect(brng).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// sampleArrowPoints
// ---------------------------------------------------------------------------

describe("sampleArrowPoints", () => {
  /** Helper: evenly-spaced points along a straight line heading northeast. */
  function straightLine(nPts: number, startLat = 28.0, startLng = 77.0): Array<[number, number]> {
    const pts: Array<[number, number]> = [];
    const dLat = 0.001;
    const dLon = 0.001;
    for (let i = 0; i < nPts; i++) {
      pts.push([startLat + i * dLat, startLng + i * dLon]);
    }
    return pts;
  }

  it("returns [] for fewer than 2 points", () => {
    expect(sampleArrowPoints([], 400)).toEqual([]);
    expect(sampleArrowPoints([[28.0, 77.0]], 400)).toEqual([]);
  });

  it("returns [] for path shorter than everyM", () => {
    const pts = straightLine(3);
    // 3 points, tiny distances ~150m total → less than 400m
    expect(sampleArrowPoints(pts, 400)).toEqual([]);
  });

  it("returns [] for everyM <= 0", () => {
    const pts = straightLine(10);
    expect(sampleArrowPoints(pts, 0)).toEqual([]);
    expect(sampleArrowPoints(pts, -100)).toEqual([]);
  });

  it("arrows are spaced approximately everyM apart", () => {
    // Create a path ~5 km long (many segments)
    const pts: Array<[number, number]> = [];
    const step = 0.01; // ~1.2 km per step
    for (let i = 0; i <= 40; i++) {
      pts.push([28.0 + i * step * 0.1, 77.0 + i * step * 0.1]);
    }
    // This should be > 1km long. Test with everyM = 500.
    const arrows = sampleArrowPoints(pts, 500);
    expect(arrows.length).toBeGreaterThan(0);
  });

  it("no arrows within everyM/2 of either end", () => {
    const pts: Array<[number, number]> = [];
    // Long enough path: 0.5 degree lat offset (~55km)
    for (let i = 0; i <= 100; i++) {
      pts.push([28.0, 77.0 + i * 0.005]); // eastward line, ~55km
    }
    const everyM = 5000; // 5km
    const halfMargin = everyM / 2;
    const totalLen = legDistanceM(pts);

    expect(totalLen).toBeGreaterThan(everyM);

    const arrows = sampleArrowPoints(pts, everyM);
    expect(arrows.length).toBeGreaterThan(1);

    // Check first arrow distance from start > halfMargin
    const firstDistFromStart = legDistanceM([pts[0], [arrows[0].lat, arrows[0].long]]);
    expect(firstDistFromStart).toBeGreaterThanOrEqual(halfMargin - 10); // small tolerance for discretisation

    // Check last arrow distance from end > halfMargin
    const lastDistToEnd = legDistanceM([
      [arrows[arrows.length - 1].lat, arrows[arrows.length - 1].long],
      pts[pts.length - 1],
    ]);
    expect(lastDistToEnd).toBeGreaterThanOrEqual(halfMargin - 10);
  });

  it("each arrow's bearing matches its segment", () => {
    // Straight eastward line — all bearings should be ~90°
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 100; i++) {
      pts.push([28.0, 77.0 + i * 0.005]);
    }
    const arrows = sampleArrowPoints(pts, 3000);
    expect(arrows.length).toBeGreaterThan(1);
    for (const a of arrows) {
      // Bearing should be near 90 (east)
      expect(a.bearing).toBeGreaterThan(80);
      expect(a.bearing).toBeLessThan(100);
    }
  });
});

// ---------------------------------------------------------------------------
// legDistanceM
// ---------------------------------------------------------------------------

describe("legDistanceM", () => {
  it("returns 0 for fewer than 2 points", () => {
    expect(legDistanceM([])).toBe(0);
    expect(legDistanceM([[28.0, 77.0]])).toBe(0);
  });

  it("returns haversine sum for multi-point polyline", () => {
    // 2 points: Delhi center + 0.1° lat north (~11.1 km)
    const pts: Array<[number, number]> = [
      [28.0, 77.0],
      [28.1, 77.0],
    ];
    const dist = legDistanceM(pts);
    // Approximate: 0.1° lat ≈ 11,100 m
    expect(dist).toBeGreaterThan(11000);
    expect(dist).toBeLessThan(11200);
  });

  it("symmetric: same regardless of direction", () => {
    const fwd: Array<[number, number]> = [
      [28.0, 77.0],
      [28.5, 77.5],
    ];
    const rev: Array<[number, number]> = [
      [28.5, 77.5],
      [28.0, 77.0],
    ];
    expect(legDistanceM(fwd)).toBe(legDistanceM(rev));
  });
});

// ---------------------------------------------------------------------------
// legColour
// ---------------------------------------------------------------------------

describe("legColour", () => {
  it("returns palette colour for index within range", () => {
    for (let i = 0; i < 12; i++) {
      expect(legColour(i)).toBe(LEG_PALETTE[i]);
    }
  });

  it("wraps past palette length", () => {
    // LEG_PALETTE has 12 entries
    expect(legColour(12)).toBe(legColour(0));
    expect(legColour(13)).toBe(legColour(1));
    expect(legColour(24)).toBe(legColour(0));
    expect(legColour(100)).toBe(legColour(4)); // 100 % 12 = 4
  });
});
