import { describe, expect, it } from "vitest";
import { formatFieldVerified } from "@/components/CustomerFieldVerified";
describe("field verified formatter", () => {
  it("formats engineer stamp", () => {
    expect(formatFieldVerified({ engineer_name: "Ravi", verified_at: "2026-09-11T10:00:00Z" } as any)).toMatch(/Ravi/);
  });
});
