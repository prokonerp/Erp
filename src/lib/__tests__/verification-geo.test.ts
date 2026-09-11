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
});
