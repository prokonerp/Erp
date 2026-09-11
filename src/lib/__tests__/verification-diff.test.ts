import { describe, expect, it } from "vitest";
import { diffLines } from "@/components/VerificationDiff";
describe("diff helper", () => {
  it("detects changed serial", () => {
    expect(diffLines("ABC123", "ABC124")).toEqual({ changed: true });
    expect(diffLines("ABC123", "ABC123")).toEqual({ changed: false });
  });
  it("treats null and empty string as equal (no meaningful change)", () => {
    expect(diffLines(null, "")).toEqual({ changed: false });
    expect(diffLines("", null)).toEqual({ changed: false });
    expect(diffLines(null, null)).toEqual({ changed: false });
    expect(diffLines("", "")).toEqual({ changed: false });
    expect(diffLines("A", "")).toEqual({ changed: true });
  });
});
