import { describe, expect, it } from "vitest";
import {
  buildCustomerSnapshot,
  buildEquipmentOriginal,
  canProceedToStep2,
  canProceedToWork,
  customerCorrectedSchema,
  customerPerFieldSchema,
  equipmentMismatchSchema,
  resolveCustomerCorrection,
} from "@/lib/ticket-verifications";
describe("verifications data layer", () => {
  it("snapshots ticket customer fields", () => {
    const s = buildCustomerSnapshot({
      customer_name: "Acme",
      customer_phone: "9999999999",
      customer_email: "a@b.com",
      customer_address: "Addr",
      sector: "Sec 61",
      location: "Gurgaon",
    } as any);
    expect(s.customer_name).toBe("Acme");
    expect(s.sector).toBe("Sec 61");
  });
  it("rejects bad corrected phone", () => {
    expect(() =>
      customerCorrectedSchema.parse({ customer_name: "Acme", customer_phone: "123" }),
    ).toThrow();
  });
  it("gates step2 and work", () => {
    expect(canProceedToStep2(null)).toBe(false);
    expect(canProceedToStep2({ id: "x" } as any)).toBe(true);
    expect(canProceedToWork({ id: "c" } as any, null)).toBe(false);
    expect(canProceedToWork({ id: "c" } as any, { id: "e" } as any)).toBe(true);
  });
  it("rejects whitespace-only equipment correction", () => {
    expect(() =>
      equipmentMismatchSchema.parse({ corrected_model: "   ", corrected_serial: "ABC" }),
    ).toThrow();
    expect(() =>
      equipmentMismatchSchema.parse({ corrected_model: "ABC", corrected_serial: "\t" }),
    ).toThrow();
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
    const s = buildCustomerSnapshot({
      customer_name: "X",
      customer_phone: undefined,
      customer_email: "",
    } as any);
    expect(s.customer_phone).toBeNull();
    expect(s.customer_email).toBe("");
  });
  it("buildEquipmentOriginal nullifies missing fields", () => {
    expect(buildEquipmentOriginal({})).toEqual({ original_model: null, original_serial: null });
    expect(buildEquipmentOriginal({ product: null, serial_no: null })).toEqual({
      original_model: null,
      original_serial: null,
    });
    expect(buildEquipmentOriginal({ product: "X", serial_no: "Y" })).toEqual({
      original_model: "X",
      original_serial: "Y",
    });
  });
});

describe("customer verification is email + mobile only", () => {
  it("rejects when neither email nor phone is flagged", () => {
    expect(() =>
      customerPerFieldSchema.parse({ emailIncorrect: false, phoneIncorrect: false }),
    ).toThrow(/at least one field/);
  });
  it("accepts email-only correction", () => {
    const r = customerPerFieldSchema.parse({
      emailIncorrect: true,
      phoneIncorrect: false,
      emailInput: "new@acme.in",
    });
    expect(r.emailInput).toBe("new@acme.in");
  });
  it("accepts phone-only correction", () => {
    const r = customerPerFieldSchema.parse({
      emailIncorrect: false,
      phoneIncorrect: true,
      phoneInput: "9876543210",
    });
    expect(r.phoneInput).toBe("9876543210");
  });
  it("rejects bad email when flagged, rejects bad phone when flagged", () => {
    expect(() =>
      customerPerFieldSchema.parse({
        emailIncorrect: true,
        phoneIncorrect: false,
        emailInput: "not-an-email",
      }),
    ).toThrow(/valid email/);
    expect(() =>
      customerPerFieldSchema.parse({
        emailIncorrect: false,
        phoneIncorrect: true,
        phoneInput: "123",
      }),
    ).toThrow(/10-digit/);
  });
  it("resolveCustomerCorrection passes name through, corrects only email + phone", () => {
    const snapshot = buildCustomerSnapshot({
      customer_name: "Acme",
      customer_phone: "9999999999",
      customer_email: "old@acme.in",
      customer_address: "Addr",
      sector: "Sec 61",
      location: "Gurgaon",
    } as never);
    const { corrected, verdict } = resolveCustomerCorrection(snapshot, {
      emailIncorrect: true,
      phoneIncorrect: true,
      emailInput: "new@acme.in",
      phoneInput: "9876543210",
    });
    expect(verdict).toBe("incorrect");
    expect(corrected.customer_name).toBe("Acme");
    expect(corrected.customer_email).toBe("new@acme.in");
    expect(corrected.customer_phone).toBe("9876543210");
  });
  it("resolveCustomerCorrection falls back to snapshot values for unflagged fields", () => {
    const snapshot = buildCustomerSnapshot({
      customer_name: "Acme",
      customer_phone: "9999999999",
      customer_email: "old@acme.in",
    } as never);
    const { corrected } = resolveCustomerCorrection(snapshot, {
      emailIncorrect: false,
      phoneIncorrect: true,
      phoneInput: "9876543210",
    });
    expect(corrected.customer_email).toBe("old@acme.in");
    expect(corrected.customer_phone).toBe("9876543210");
  });
});
