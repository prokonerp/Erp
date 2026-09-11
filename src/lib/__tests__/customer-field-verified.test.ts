import { describe, expect, it } from "vitest";
import { formatFieldVerified } from "@/components/CustomerFieldVerified";
describe("field verified formatter", () => {
  it("formats engineer stamp", () => {
    expect(formatFieldVerified({ engineer_name: "Ravi", verified_at: "2026-09-11T10:00:00Z" } as any)).toMatch(/Ravi/);
  });
  it("falls back when engineer and timestamp are missing", () => {
    expect(formatFieldVerified({ engineer_name: null, verified_at: null } as any)).toBe("Engineer · ");
    expect(formatFieldVerified({} as any)).toBe("Engineer · ");
  });
});
