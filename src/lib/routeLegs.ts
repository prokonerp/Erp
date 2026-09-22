/**
 * Pure logic for splitting a day's pings into travel legs between site dwells.
 *
 * No React, no DOM, no network — pure TypeScript that can run in Node or browser.
 */

import type { LatLng } from "@/lib/roadRoute";
import { haversineM } from "@/lib/field-location";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LegPing = { lat: number; long: number; captured_at: string; ticket_id: string | null };
export type LegSite = {
  ticket_id: string | null;
  arrived_at: string | null;
  departed_at: string | null;
  lat: number | null;
  long: number | null;
};

export type LegSpec = {
  index: number; // 1-based
  pings: LegPing[];
  fromLabel: string; // "Start" or "Ticket <shortId>"
  toLabel: string; // "Ticket <shortId>" or "End"
  startedAt: string | null; // first ping's captured_at
  endedAt: string | null; // last ping's captured_at
  ticketId: string | null; // destination ticket (null on final leg)
};

// ---------------------------------------------------------------------------
// Palette — 12 high-contrast colours avoiding #16a34a green / #dc2626 red
// ---------------------------------------------------------------------------

export const LEG_PALETTE: readonly string[] = [
  "#2563eb",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
  "#c026d3",
  "#65a30d",
  "#4f46e5",
  "#0f766e",
  "#b45309",
  "#be123c",
  "#0369a1",
  "#9333ea",
];

export function legColour(index: number): string {
  return LEG_PALETTE[index % LEG_PALETTE.length];
}

export function shortId(id: string | null): string {
  if (!id) return "\u2014";
  return id.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Core: buildLegs
// ---------------------------------------------------------------------------

interface DwellDef {
  arr: number;
  dep: number;
  ticketId: string | null;
}

/**
 * Split pings into travel legs between site dwell periods.
 *
 * A "dwell" is a site with both arrived_at AND departed_at where
 * departed_at >= arrived_at (parseable ISO strings). Pings whose captured_at
 * falls within a dwell window are excluded from travel geometry.
 *
 * Rules:
 *   1. Sort a copy ascending by parsed timestamp; leave caller's array untouched.
 *   2. Parseable unparseable pings dropped silently.
 *   3. Fewer than 2 valid pings → single leg covering all.
 *   4. Assign each non-dwell ping to a segment based on temporal bounds.
 *   5. Drop empty segments. If result empty → one leg covering all.
 *   6. Label using Ticket <shortId> or Start/End convention.
 */
export function buildLegs(pings: LegPing[], sites: LegSite[]): LegSpec[] {
  // Step 1: Sort COPY ascending by parsed timestamp. Drop unparseable.
  const sorted = [...pings]
    .map((p) => ({ p, ts: Date.parse(p.captured_at) }))
    .filter((x): x is { p: LegPing; ts: number } => Number.isFinite(x.ts))
    .sort((a, b) => a.ts - b.ts)
    .map((x) => x.p);

  if (sorted.length < 2) {
    return [
      {
        index: 1,
        pings: sorted,
        fromLabel: "Start",
        toLabel: "End",
        startedAt: sorted[0]?.captured_at ?? null,
        endedAt: sorted[sorted.length - 1]?.captured_at ?? null,
        ticketId: null,
      },
    ];
  }

  // Step 2: Find dwells — sites with both timestamps parseable and departed >= arrived
  const dwells: DwellDef[] = [];
  for (const s of sites) {
    if (!s.arrived_at || !s.departed_at) continue;
    const ar = Date.parse(s.arrived_at);
    const dp = Date.parse(s.departed_at);
    if (!Number.isFinite(ar) || !Number.isFinite(dp)) continue;
    if (dp < ar) continue;
    dwells.push({ arr: ar, dep: dp, ticketId: s.ticket_id });
  }
  // Sort dwells by arrived time
  dwells.sort((a, b) => a.arr - b.arr);

  // Steps 3–5: Assign pings to segments between dwells
  interface Seg {
    pings: LegPing[];
    fromIdx: number;
    toIdx: number;
  }
  const segs: Seg[] = [];

  for (const ping of sorted) {
    const t = Date.parse(ping.captured_at);

    // Is this ping inside any dwell?
    let inDwell = false;
    for (const d of dwells) {
      if (t >= d.arr && t <= d.dep) {
        inDwell = true;
        break;
      }
    }
    if (inDwell) continue; // Skip dwell pings — they're not travel

    // Which segment does this belong to?
    // Count how many dwells have depart <= t → rightDwell
    // Segment index = rightDwell + 1
    let rightDwell = -1;
    for (let i = 0; i < dwells.length; i++) {
      if (dwells[i].dep <= t) {
        rightDwell = i;
      } else {
        break;
      }
    }
    const segIdx = rightDwell + 1;

    if (!segs[segIdx]) {
      segs[segIdx] = { pings: [], fromIdx: segIdx - 1, toIdx: segIdx };
    }
    segs[segIdx].pings.push(ping);
  }

  // Filter out empty segments
  const travel = segs.filter((s) => s.pings.length > 0);

  // If every ping was inside a dwell → fallback to one leg
  if (travel.length === 0) {
    return [
      {
        index: 1,
        pings: sorted,
        fromLabel: "Start",
        toLabel: "End",
        startedAt: sorted[0]?.captured_at ?? null,
        endedAt: sorted[sorted.length - 1]?.captured_at ?? null,
        ticketId: null,
      },
    ];
  }

  // Step 6: Build LegSpec objects
  const result: LegSpec[] = [];
  for (let i = 0; i < travel.length; i++) {
    const seg = travel[i];
    const fromD = seg.fromIdx >= 0 ? dwells[seg.fromIdx] : null;
    const toD = seg.toIdx < dwells.length ? dwells[seg.toIdx] : null;

    result.push({
      index: i + 1,
      pings: seg.pings,
      fromLabel: fromD ? `Ticket ${shortId(fromD.ticketId)}` : "Start",
      toLabel: toD ? `Ticket ${shortId(toD.ticketId)}` : "End",
      startedAt: seg.pings[0]?.captured_at ?? null,
      endedAt: seg.pings[seg.pings.length - 1]?.captured_at ?? null,
      ticketId: toD?.ticketId ?? null,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Great-circle distance (metres) along a polyline. Uses haversine per segment. */
export function legDistanceM(points: LatLng[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
  }
  return total;
}

/** Initial great-circle bearing from → to, normalised to 0..360 degrees. */
export function bearingDeg(from: LatLng, to: LatLng): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const deg = (d: number) => (d * 180) / Math.PI;
  const dLon = rad(to[1] - from[1]);
  const y = Math.sin(dLon) * Math.cos(rad(to[0]));
  const x =
    Math.cos(rad(from[0])) * Math.sin(rad(to[0])) -
    Math.sin(rad(from[0])) * Math.cos(rad(to[0])) * Math.cos(dLon);
  const brng = deg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/**
 * Walk a polyline accumulating haversine distance. Emit an arrow every everyM metres
 * at the interpolated point, carrying the segment bearing it sits on.
 *
 * Does NOT emit within everyM/2 of either end (avoids clashing with S/E markers).
 * Returns [] for fewer than 2 points, total length < everyM, or everyM <= 0.
 */
export function sampleArrowPoints(
  points: LatLng[],
  everyM: number,
): Array<{ lat: number; long: number; bearing: number }> {
  if (points.length < 2 || everyM <= 0) return [];

  // Compute cumulative distances and per-segment bearings
  const cumDist: number[] = [0];
  const cumBear: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const segLen = haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    cumDist.push(cumDist[i - 1] + segLen);
    cumBear[i] = bearingDeg(points[i - 1], points[i]);
  }
  const totalDist = cumDist[cumDist.length - 1];

  if (totalDist < everyM) return [];

  const half = everyM / 2;
  const arrows: Array<{ lat: number; long: number; bearing: number }> = [];

  let emitDist = half; // first emission at half-margin from start
  while (emitDist <= totalDist - half - 0.001) {
    // Find which segment contains emitDist
    for (let i = 1; i < points.length; i++) {
      if (cumDist[i] >= emitDist) {
        const segLen = cumDist[i] - cumDist[i - 1];
        if (segLen < 0.001) break; // skip degenerate segment
        const frac = (emitDist - cumDist[i - 1]) / segLen;
        arrows.push({
          lat: points[i - 1][0] + frac * (points[i][0] - points[i - 1][0]),
          long: points[i - 1][1] + frac * (points[i][1] - points[i - 1][1]),
          bearing: cumBear[i],
        });
        break;
      }
    }
    emitDist += everyM;
  }

  return arrows;
}
