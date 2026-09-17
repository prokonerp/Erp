import { describe, expect, it } from "vitest";
import { canProceedToStep2, canProceedToWork } from "@/lib/ticket-verifications";

describe("engineer gating", () => {
  it("locks work until both verifications exist", () => {
    expect(canProceedToWork(null, null)).toBe(false);
    expect(canProceedToWork({ id: "c" } as any, { id: "e" } as any)).toBe(true);
    expect(canProceedToStep2({ id: "c" } as any)).toBe(true);
  });
  it("rejects empty objects lacking id", () => {
    expect(canProceedToStep2({} as any)).toBe(false);
    expect(canProceedToWork({ id: "c" } as any, {} as any)).toBe(false);
    expect(canProceedToWork({} as any, { id: "e" } as any)).toBe(false);
    expect(canProceedToWork({ id: "" } as any, { id: "e" } as any)).toBe(false);
  });
});

describe("DB step-order rule mirror (trigger 20260925000005)", () => {
  it("equipment alone never unlocks step 2 or work (customer row required)", () => {
    // The trigger refuses ticket_equipment_verifications INSERT unless a
    // ticket_customer_verifications row exists for that ticket_id; the UI
    // must mirror that: an equipment row without a customer row proceeds
    // nowhere.
    expect(canProceedToStep2(null)).toBe(false);
    expect(canProceedToWork(null, { id: "e" } as any)).toBe(false);
  });
  it("customer row unlocks step 2 but not work until equipment row exists", () => {
    expect(canProceedToStep2({ id: "c" } as any)).toBe(true);
    expect(canProceedToWork({ id: "c" } as any, null)).toBe(false);
  });
  it("work unlocks only when both rows exist (no skipping)", () => {
    expect(canProceedToWork({ id: "c" } as any, { id: "e" } as any)).toBe(true);
  });
});
