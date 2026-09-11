import { describe, expect, it } from "vitest";
import { validateGeoForMismatch } from "@/lib/verification-geo";

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
