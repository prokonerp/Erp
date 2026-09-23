/**
 * Unit tests for src/lib/routeReplay.ts — pure road-trail replay math.
 * No React, no DOM, no network.
 */
import { describe, expect, it } from "vitest";
import {
  buildReplayFrames,
  cumulativeDistances,
  frameAtClock,
  lerpLatLng,
  positionAtDistance,
  totalDistanceM,
  type ReplaySegment,
} from "@/lib/routeReplay";

// ~0.01° latitude ≈ 1112 m; A→B→C runs due north.
const A: [number, number] = [28.6, 77.2];
const B: [number, number] = [28.61, 77.2];
const C: [number, number] = [28.62, 77.2];

const T0 = Date.parse("2026-09-23T06:00:00.000Z");

function seg(geometry: [number, number][], startMs: number, endMs: number): ReplaySegment {
  return { geometry, startMs, endMs };
}

// ---------------------------------------------------------------------------
// lerpLatLng
// ---------------------------------------------------------------------------

describe("lerpLatLng", () => {
  it("t=0 returns a, t=1 returns b", () => {
    expect(lerpLatLng(A, B, 0)).toEqual(A);
    expect(lerpLatLng(A, B, 1)).toEqual(B);
  });

  it("t=0.5 returns the midpoint", () => {
    expect(lerpLatLng(A, B, 0.5)).toEqual([28.605, 77.2]);
  });

  it("clamps t outside 0..1", () => {
    expect(lerpLatLng(A, B, -1)).toEqual(A);
    expect(lerpLatLng(A, B, 2)).toEqual(B);
  });
});

// ---------------------------------------------------------------------------
// cumulativeDistances / totalDistanceM
// ---------------------------------------------------------------------------

describe("cumulativeDistances / totalDistanceM", () => {
  it("starts at 0 and increases monotonically", () => {
    const cum = cumulativeDistances([A, B, C]);
    expect(cum).toHaveLength(3);
    expect(cum[0]).toBe(0);
    expect(cum[1]).toBeGreaterThan(0);
    expect(cum[2]).toBeGreaterThan(cum[1]);
  });

  it("0.01° latitude span ≈ 1112 m", () => {
    const d = totalDistanceM([A, B]);
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1125);
  });

  it("empty geometry → 0", () => {
    expect(totalDistanceM([])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// positionAtDistance
// ---------------------------------------------------------------------------

describe("positionAtDistance", () => {
  it("empty geometry → null", () => {
    expect(positionAtDistance([], 100)).toBeNull();
  });

  it("0 → first point, total → last point", () => {
    expect(positionAtDistance([A, B, C], 0)).toEqual(A);
    expect(positionAtDistance([A, B, C], totalDistanceM([A, B, C]))).toEqual(C);
  });

  it("clamps below 0 and beyond total", () => {
    expect(positionAtDistance([A, B], -50)).toEqual(A);
    expect(positionAtDistance([A, B], 1e9)).toEqual(B);
  });

  it("halfway along a single segment → midpoint", () => {
    const half = totalDistanceM([A, B]) / 2;
    const pos = positionAtDistance([A, B], half);
    expect(pos).not.toBeNull();
    expect(pos![0]).toBeCloseTo(28.605, 3);
    expect(pos![1]).toBeCloseTo(77.2, 5);
  });
});

// ---------------------------------------------------------------------------
// buildReplayFrames
// ---------------------------------------------------------------------------

describe("buildReplayFrames", () => {
  it("single segment: first frame at start, last at end with end clock", () => {
    const frames = buildReplayFrames([seg([A, C], T0, T0 + 60_000)], 100);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0].clockMs).toBe(T0);
    expect(frames[0].position).toEqual(A);
    expect(frames[0].distanceM).toBe(0);
    const last = frames[frames.length - 1];
    expect(last.clockMs).toBe(T0 + 60_000);
    expect(last.position).toEqual(C);
  });

  it("clocks and distances are non-decreasing", () => {
    const frames = buildReplayFrames(
      [seg([A, B], T0, T0 + 60_000), seg([B, C], T0 + 360_000, T0 + 420_000)],
      200,
    );
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].clockMs).toBeGreaterThanOrEqual(frames[i - 1].clockMs);
      expect(frames[i].distanceM).toBeGreaterThanOrEqual(frames[i - 1].distanceM);
    }
  });

  it("emits steps no larger than stepM along the path", () => {
    const frames = buildReplayFrames([seg([A, C], T0, T0 + 120_000)], 500);
    expect(frames.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].distanceM - frames[i - 1].distanceM).toBeLessThanOrEqual(500.001);
    }
  });

  it("holds position across the gap between segments", () => {
    const frames = buildReplayFrames(
      [seg([A, B], T0, T0 + 60_000), seg([B, C], T0 + 360_000, T0 + 420_000)],
      100,
    );
    // Mid-gap scrub must sit at B — stationary during the site dwell.
    const midGap = frames[frameAtClock(frames, T0 + 180_000)];
    expect(midGap.position).toEqual(B);
    expect(midGap.clockMs).toBe(T0 + 60_000);
    // First frame after the gap starts segment 2 at its own start clock.
    const afterGap = frames[frameAtClock(frames, T0 + 361_000)];
    expect(afterGap.clockMs).toBeGreaterThanOrEqual(T0 + 360_000);
  });

  it("single-point geometry → one frame", () => {
    const frames = buildReplayFrames([seg([B], T0, T0)], 100);
    expect(frames).toHaveLength(1);
    expect(frames[0].position).toEqual(B);
    expect(frames[0].clockMs).toBe(T0);
  });

  it("empty segments only → empty frames", () => {
    expect(buildReplayFrames([], 100)).toEqual([]);
    expect(buildReplayFrames([seg([], T0, T0 + 1000)], 100)).toEqual([]);
  });

  it("zero/negative duration clamps clocks to start (never goes backwards)", () => {
    const frames = buildReplayFrames([seg([A, C], T0, T0 - 5000)], 100);
    expect(frames.length).toBeGreaterThanOrEqual(2);
    for (const f of frames) expect(f.clockMs).toBe(T0);
    expect(frames[frames.length - 1].position).toEqual(C);
  });
});

// ---------------------------------------------------------------------------
// frameAtClock
// ---------------------------------------------------------------------------

describe("frameAtClock", () => {
  const frames = buildReplayFrames([seg([A, C], T0, T0 + 60_000)], 100);

  it("empty frames → -1", () => {
    expect(frameAtClock([], T0)).toBe(-1);
  });

  it("before first clock → 0; after last → last index", () => {
    expect(frameAtClock(frames, T0 - 10_000)).toBe(0);
    expect(frameAtClock(frames, T0 + 999_999)).toBe(frames.length - 1);
  });

  it("exact clock → that index", () => {
    expect(frameAtClock(frames, frames[0].clockMs)).toBe(0);
    expect(frameAtClock(frames, frames[frames.length - 1].clockMs)).toBe(frames.length - 1);
  });

  it("between clocks → last frame at or before t", () => {
    const t = (frames[1].clockMs + frames[2].clockMs) / 2;
    expect(frameAtClock(frames, t)).toBe(1);
  });
});
