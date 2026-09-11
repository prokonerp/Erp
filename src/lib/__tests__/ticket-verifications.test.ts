import { describe, expect, it } from "vitest";
import { buildCustomerSnapshot, canProceedToStep2, canProceedToWork, customerCorrectedSchema } from "@/lib/ticket-verifications";
describe("verifications data layer", () => {
  it("snapshots ticket customer fields", () => {
    const s = buildCustomerSnapshot({ customer_name: "Acme", customer_phone: "9999999999", customer_email: "a@b.com", customer_address: "Addr", sector: "Sec 61", location: "Gurgaon" } as any);
    expect(s.customer_name).toBe("Acme");
    expect(s.sector).toBe("Sec 61");
  });
  it("rejects bad corrected phone", () => {
    expect(() => customerCorrectedSchema.parse({ customer_name: "Acme", customer_phone: "123" })).toThrow();
  });
  it("gates step2 and work", () => {
    expect(canProceedToStep2(null)).toBe(false);
    expect(canProceedToStep2({ id: "x" } as any)).toBe(true);
    expect(canProceedToWork({ id: "c" } as any, null)).toBe(false);
    expect(canProceedToWork({ id: "c" } as any, { id: "e" } as any)).toBe(true);
  });
});
