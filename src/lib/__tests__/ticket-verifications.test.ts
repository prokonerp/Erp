import { describe, expect, it } from "vitest";
import { buildCustomerSnapshot, buildEquipmentOriginal, canProceedToStep2, canProceedToWork, customerCorrectedSchema, equipmentMismatchSchema } from "@/lib/ticket-verifications";
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
  it("rejects whitespace-only equipment correction", () => {
    expect(() => equipmentMismatchSchema.parse({ corrected_model: "   ", corrected_serial: "ABC" })).toThrow();
    expect(() => equipmentMismatchSchema.parse({ corrected_model: "ABC", corrected_serial: "\t" })).toThrow();
  });
  it("optional customer fields accept null/undefined/omit, reject bad email", () => {
    const base = { customer_name: "X", customer_phone: "9999999999" };
    expect(customerCorrectedSchema.parse({ ...base, customer_email: null })).toBeDefined();
    expect(customerCorrectedSchema.parse({ ...base, customer_email: undefined })).toBeDefined();
    expect(() => customerCorrectedSchema.parse({ ...base, customer_email: "bad" })).toThrow();
    expect(customerCorrectedSchema.parse({ ...base, customer_address: "" })).toBeDefined();
    expect(customerCorrectedSchema.parse({ ...base, sector: null })).toBeDefined();
  });
  it("snapshot preserves empty strings, nullifies undefined", () => {
    const s = buildCustomerSnapshot({ customer_name: "X", customer_phone: undefined, customer_email: "" } as any);
    expect(s.customer_phone).toBeNull();
    expect(s.customer_email).toBe("");
  });
  it("buildEquipmentOriginal nullifies missing fields", () => {
    expect(buildEquipmentOriginal({})).toEqual({ original_model: null, original_serial: null });
    expect(buildEquipmentOriginal({ product: null, serial_no: null })).toEqual({ original_model: null, original_serial: null });
    expect(buildEquipmentOriginal({ product: "X", serial_no: "Y" })).toEqual({ original_model: "X", original_serial: "Y" });
  });
});
