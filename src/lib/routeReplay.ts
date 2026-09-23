/**
 * Pure road-trail replay math — interpolate a playhead along road-snapped
 * geometry over time. No React, no DOM, no network.
 *
 * Time model: within a segment the clock advances linearly with distance
 * ("animate by distance, display wall-clock"). Across the gap between two
 * segments (a site dwell) the position HOLDS at the previous segment's end
 * until the next segment's start clock — a stationary engineer never slides
 * through a straight line while parked.
 *
 * Frame invariants: clockMs and distanceM are both non-decreasing.
 */
import { haversineM } from "@/lib/field-location";

export type ReplayFrame = {
  position: [number, number];
  distanceM: number; // cumulative metres replayed (holds add 0)
  clockMs: number; // epoch ms at this frame
};

export type ReplaySegment = {
  geometry: Array<[number, number]>;
  startMs: number;
  endMs: number;
};

const DEFAULT_STEP_M = 10;
/** Gaps larger than this get an explicit hold frame (sub-ms jitter is ignored). */
const GAP_EPS_MS = 0.5;

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Linear interpolation between two points, t clamped to 0..1. Returns a copy. */
export function lerpLatLng(a: [number, number], b: [number, number], t: number): [number, number] {
  if (!(t > 0)) return [a[0], a[1]];
  if (t >= 1) return [b[0], b[1]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Cumulative haversine distance (m) at each vertex; result[0] is always 0. */
export function cumulativeDistances(geometry: Array<[number, number]>): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < geometry.length; i++) {
    const [p, q] = [geometry[i - 1], geometry[i]];
    cum.push(cum[i - 1] + haversineM(p[0], p[1], q[0], q[1]));
  }
  return cum;
}

/** Total path length in metres. Empty geometry → 0. */
export function totalDistanceM(geometry: Array<[number, number]>): number {
  if (geometry.length < 2) return 0;
  const cum = cumulativeDistances(geometry);
  return cum[cum.length - 1];
}

/** Point at `m` metres along the path. Clamped; empty geometry → null. */
export function positionAtDistance(
  geometry: Array<[number, number]>,
  m: number,
): [number, number] | null {
  if (geometry.length === 0) return null;
  if (geometry.length === 1 || m <= 0) return geometry[0];
  const cum = cumulativeDistances(geometry);
  const total = cum[cum.length - 1];
  if (m >= total) return geometry[geometry.length - 1];
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] >= m) {
      const segLen = cum[i] - cum[i - 1];
      if (segLen <= 1e-9) return geometry[i];
      const frac = (m - cum[i - 1]) / segLen;
      return [
        geometry[i - 1][0] + (geometry[i][0] - geometry[i - 1][0]) * frac,
        geometry[i - 1][1] + (geometry[i][1] - geometry[i - 1][1]) * frac,
      ];
    }
  }
  return geometry[geometry.length - 1];
}

// ---------------------------------------------------------------------------
// Frame builder
// ---------------------------------------------------------------------------

/**
 * Build the full replay frame list from travel segments.
 *
 * - Within a segment: frames every `stepM` metres plus exact endpoints;
 *   clock = startMs + (distance / total) * (endMs - startMs).
 * - Between segments: one hold frame (previous end position at the next
 *   segment's start clock) so scrubbing through a dwell never interpolates.
 * - Bad input (empty geometry, non-finite stamps, negative duration) degrades
 *   per-segment — never throws, never emits a backwards clock.
 */
export function buildReplayFrames(
  segments: ReplaySegment[],
  stepM: number = DEFAULT_STEP_M,
): ReplayFrame[] {
  const step = Number.isFinite(stepM) && stepM > 0 ? stepM : DEFAULT_STEP_M;
  const frames: ReplayFrame[] = [];
  let cum = 0; // cumulative metres across all segments
  let lastPos: [number, number] | null = null;
  let lastClock = Number.NEGATIVE_INFINITY;

  const push = (position: [number, number], distanceM: number, clockMs: number) => {
    const clock = Math.max(clockMs, lastClock);
    frames.push({ position, distanceM, clockMs: clock });
    lastClock = clock;
    lastPos = position;
  };

  for (const s of segments) {
    const geom = (s.geometry ?? []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (geom.length === 0) continue;
    if (!Number.isFinite(s.startMs) || !Number.isFinite(s.endMs)) continue;

    const start = s.startMs;
    const end = Math.max(s.endMs, s.startMs); // never a negative duration

    // Explicit hold across a dwell gap: park at the previous end position
    // until this segment starts, so mid-gap scrubbing stays stationary.
    if (lastPos !== null && s.startMs > lastClock + GAP_EPS_MS) {
      push(lastPos, cum, s.startMs);
    }

    const cumDist = cumulativeDistances(geom);
    const total = cumDist[cumDist.length - 1];
    const clockAt = (d: number) => (total > 0 ? start + (d / total) * (end - start) : start);

    const emit = (d: number) => {
      const pos = positionAtDistance(geom, d) ?? geom[0];
      push(pos, cum + d, clockAt(d));
    };

    emit(0);
    if (total > 0) {
      for (let d = step; d < total - 1e-6; d += step) emit(d);
      emit(total); // exact endpoint at endMs
    } else if (Math.max(end, lastClock) > lastClock) {
      // Zero-length path with a positive duration → pin end clock.
      push(geom[0], cum, end);
    }

    cum += total;
  }

  return frames;
}

/**
 * Index of the last frame at or before `tMs` (0 if before the start,
 * last index if past the end, -1 for an empty frame list).
 */
export function frameAtClock(frames: ReplayFrame[], tMs: number): number {
  if (frames.length === 0) return -1;
  if (tMs <= frames[0].clockMs) return 0;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].clockMs <= tMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
