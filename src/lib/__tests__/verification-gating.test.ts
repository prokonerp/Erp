import { describe, expect, it } from "vitest";
import { canProceedToStep2, canProceedToWork } from "@/lib/ticket-verifications";

describe("engineer gating", () => {
  it("locks work until both verifications exist", () => {
    expect(canProceedToWork(null, null)).toBe(false);
    expect(canProceedToWork({ id: "c" } as any, { id: "e" } as any)).toBe(true);
    expect(canProceedToStep2({ id: "c" } as any)).toBe(true);
  });
});
