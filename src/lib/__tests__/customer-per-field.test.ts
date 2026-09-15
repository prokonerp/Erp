import { describe, expect, it } from "vitest";
import { resolveCustomerCorrection, customerPerFieldSchema } from "@/lib/ticket-verifications";

const SNAP = {
  customer_name: "Acme",
  customer_phone: "9999999999",
  customer_email: "a@b.com",
  customer_address: "Addr",
  sector: "Sec 61",
  location: "Gurgaon",
};

describe("customer per-field correction — email + mobile only", () => {
  it("phone-only fix resolves name==snapshot + verdict incorrect", () => {
    const out = resolveCustomerCorrection(SNAP, {
      emailIncorrect: false,
      phoneIncorrect: true,
      phoneInput: "8888888888",
    });
    expect(out.corrected.customer_name).toBe("Acme");
    expect(out.corrected.customer_phone).toBe("8888888888");
    expect(out.corrected.customer_email).toBe("a@b.com");
    expect(out.verdict).toBe("incorrect");
  });

  it("email-only fix symmetric", () => {
    const out = resolveCustomerCorrection(SNAP, {
      emailIncorrect: true,
      emailInput: "new@acme.in",
      phoneIncorrect: false,
    });
    expect(out.corrected.customer_email).toBe("new@acme.in");
    expect(out.corrected.customer_phone).toBe("9999999999");
    expect(out.verdict).toBe("incorrect");
  });

  it("both-correct throws", () => {
    expect(() =>
      customerPerFieldSchema.parse({ emailIncorrect: false, phoneIncorrect: false }),
    ).toThrow();
    expect(() =>
      resolveCustomerCorrection(SNAP, { emailIncorrect: false, phoneIncorrect: false }),
    ).toThrow();
  });

  it("bad phone throws", () => {
    expect(() =>
      customerPerFieldSchema.parse({
        emailIncorrect: false,
        phoneIncorrect: true,
        phoneInput: "123",
      }),
    ).toThrow();
    expect(() =>
      resolveCustomerCorrection(SNAP, {
        emailIncorrect: false,
        phoneIncorrect: true,
        phoneInput: "123",
      }),
    ).toThrow();
  });

  it("bad email throws", () => {
    expect(() =>
      customerPerFieldSchema.parse({
        emailIncorrect: true,
        emailInput: "not-an-email",
        phoneIncorrect: false,
      }),
    ).toThrow();
  });
});
