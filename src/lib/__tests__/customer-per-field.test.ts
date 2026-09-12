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

describe("customer per-field correction (RED)", () => {
  it("phone-only fix resolves name==snapshot + verdict incorrect", () => {
    const out = resolveCustomerCorrection(SNAP, {
      nameIncorrect: false,
      phoneIncorrect: true,
      phoneInput: "8888888888",
    });
    expect(out.corrected.customer_name).toBe("Acme");
    expect(out.corrected.customer_phone).toBe("8888888888");
    expect(out.verdict).toBe("incorrect");
  });

  it("name-only fix symmetric", () => {
    const out = resolveCustomerCorrection(SNAP, {
      nameIncorrect: true,
      nameInput: "Acme New",
      phoneIncorrect: false,
    });
    expect(out.corrected.customer_name).toBe("Acme New");
    expect(out.corrected.customer_phone).toBe("9999999999");
    expect(out.verdict).toBe("incorrect");
  });

  it("both-correct throws", () => {
    expect(() =>
      customerPerFieldSchema.parse({ nameIncorrect: false, phoneIncorrect: false }),
    ).toThrow();
    expect(() =>
      resolveCustomerCorrection(SNAP, { nameIncorrect: false, phoneIncorrect: false }),
    ).toThrow();
  });

  it("bad phone throws", () => {
    expect(() =>
      customerPerFieldSchema.parse({
        nameIncorrect: false,
        phoneIncorrect: true,
        phoneInput: "123",
      }),
    ).toThrow();
    expect(() =>
      resolveCustomerCorrection(SNAP, {
        nameIncorrect: false,
        phoneIncorrect: true,
        phoneInput: "123",
      }),
    ).toThrow();
  });
});
