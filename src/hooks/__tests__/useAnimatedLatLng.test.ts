/**
 * Tests for the throttle/snap decision used by useAnimatedLatLng.
 * Pure helper — no React render needed (vitest env is "node").
 */
import { describe, expect, it } from "vitest";
import {
  MIN_ACCEPT_INTERVAL_MS,
  SNAP_DISTANCE_M,
  shouldAcceptUpdate,
} from "@/hooks/useAnimatedLatLng";

describe("shouldAcceptUpdate", () => {
  it("rejects an update inside the throttle window when nearby", () => {
    expect(shouldAcceptUpdate(1_000, 30)).toBe(false);
  });

  it("accepts an update once the throttle window elapses", () => {
    expect(shouldAcceptUpdate(MIN_ACCEPT_INTERVAL_MS, 30)).toBe(true);
  });

  it("accepts a far jump immediately regardless of the window", () => {
    expect(shouldAcceptUpdate(100, SNAP_DISTANCE_M)).toBe(true);
    expect(shouldAcceptUpdate(100, SNAP_DISTANCE_M + 1)).toBe(true);
  });
});
