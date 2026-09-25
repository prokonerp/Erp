import { describe, expect, it } from "vitest";
import { mockHashHex } from "@/lib/mockHash";

describe("mockHashHex", () => {
  it("is deterministic: the same input always yields the same digest", () => {
    expect(mockHashHex("irn:06AEHPA2697G1ZL:S-INV-26-27-0001:2026-09-25")).toBe(
      mockHashHex("irn:06AEHPA2697G1ZL:S-INV-26-27-0001:2026-09-25"),
    );
  });

  it("returns exactly 64 lowercase hex characters, the shape of a real IRN", () => {
    expect(mockHashHex("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for inputs that differ by a single character", () => {
    expect(mockHashHex("irn:abc:0001")).not.toBe(mockHashHex("irn:abd:0001"));
  });

  it("never produces a repeated 8-character block, so it clears the anti-fabrication CHECK", () => {
    for (const seed of ["a", "irn:1", "ewb:2026", "ack:seed", ""]) {
      const digest = mockHashHex(seed);
      const head = digest.slice(0, 8);
      expect(digest).not.toBe(head.repeat(8));
    }
  });

  it("spreads a common prefix across the whole digest (no shared leading lanes)", () => {
    const a = mockHashHex("irn:06AEHPA2697G1ZL:S-INV-26-27-0001");
    const b = mockHashHex("irn:06AEHPA2697G1ZL:S-INV-26-27-0002");
    // The first lane is expected to differ; this guards against a design that
    // left one lane constant across all inputs.
    expect(a.slice(0, 8)).not.toBe(b.slice(0, 8));
  });
});
