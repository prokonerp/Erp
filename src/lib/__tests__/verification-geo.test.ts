import { describe, expect, it } from "vitest";
import { validateGeoForMismatch, geoErrorMessage } from "@/lib/verification-geo";

describe("geo gate", () => {
  it("blocks missing geo", () => {
    expect(validateGeoForMismatch(null)).toMatch(/location/i);
  });
  it("accepts valid fix", () => {
    expect(
      validateGeoForMismatch({
        lat: 28.4,
        long: 77.0,
        accuracy: 12,
        captured_at: new Date().toISOString(),
      }),
    ).toBeNull();
  });
  it("blocks NaN and Infinity coordinates", () => {
    expect(validateGeoForMismatch({ lat: NaN, long: 77, accuracy: 10, captured_at: "2026-01-01" })).toMatch(/location/i);
    expect(validateGeoForMismatch({ lat: 28, long: Infinity, accuracy: null, captured_at: "2026-01-01" })).toMatch(/location/i);
  });
  it("blocks empty captured_at string", () => {
    expect(validateGeoForMismatch({ lat: 28, long: 77, accuracy: 10, captured_at: "" })).toMatch(/capture time/i);
  });
});

describe("geoErrorMessage", () => {
  it("returns permission denied message for code 1", () => {
    expect(geoErrorMessage(1)).toBe(
      "Location permission denied. Enable location for this site in Settings and retry.",
    );
  });
  it("returns position unavailable message for code 2", () => {
    expect(geoErrorMessage(2)).toBe("Phone could not get a fix. Move outdoors and retry.");
  });
  it("returns timeout message for code 3", () => {
    expect(geoErrorMessage(3)).toBe("Location timed out. Try again.");
  });
  it("falls back for unknown codes", () => {
    expect(geoErrorMessage(99)).toMatch(/permission denied/i);
  });
});
