import { describe, it, expect } from "vitest";
import {
  customerVerificationInput,
  equipmentVerificationInput,
} from "@/lib/ticket-verifications.functions";

const TICKET = "11111111-1111-4111-8111-111111111111";
const EMP = "22222222-2222-4222-8222-222222222222";

describe("customerVerificationInput", () => {
  const base = {
    ticketId: TICKET,
    customerId: null,
    snapshot: { name: "Acme" },
    engineerEmployeeId: EMP,
    engineerName: "Jane",
  };

  it("accepts a verified verdict with no corrected payload", () => {
    expect(customerVerificationInput.safeParse({ ...base, verdict: "verified" }).success).toBe(
      true,
    );
  });

  it("accepts an incorrect verdict carrying corrected", () => {
    const r = customerVerificationInput.safeParse({
      ...base,
      verdict: "incorrect",
      corrected: { customer_name: "Acme Ltd" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown verdict", () => {
    expect(
      customerVerificationInput.safeParse({ ...base, verdict: "maybe" }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid ticket id", () => {
    expect(
      customerVerificationInput.safeParse({ ...base, ticketId: "nope", verdict: "verified" })
        .success,
    ).toBe(false);
  });

  it("rejects an empty engineer name", () => {
    expect(
      customerVerificationInput.safeParse({ ...base, verdict: "verified", engineerName: "" })
        .success,
    ).toBe(false);
  });
});

describe("equipmentVerificationInput", () => {
  const base = {
    ticketId: TICKET,
    originalModel: "UPS-10K",
    originalSerial: "SN1",
    correctedModel: "UPS-10K",
    correctedSerial: "SN1",
    photoPath: "ticket/T-1/SERIAL-abc.jpg",
    photoLat: null,
    photoLong: null,
    photoAccuracy: null,
    photoCapturedAt: null,
    engineerEmployeeId: EMP,
    engineerName: "Jane",
  };

  it("accepts a matched verdict with photo and no geo", () => {
    expect(equipmentVerificationInput.safeParse({ ...base, verdict: "matched" }).success).toBe(
      true,
    );
  });

  it("accepts omitted geo keys (matched re-verify without a fix)", () => {
    const { photoLat, photoLong, photoAccuracy, photoCapturedAt, ...rest } = base;
    expect(
      equipmentVerificationInput.safeParse({ ...rest, verdict: "matched" }).success,
    ).toBe(true);
  });

  it("accepts a mismatch verdict with geotagged photo", () => {
    const r = equipmentVerificationInput.safeParse({
      ...base,
      verdict: "mismatch",
      photoLat: 12.97,
      photoLong: 77.59,
      photoAccuracy: 8,
      photoCapturedAt: new Date().toISOString(),
    });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown verdict", () => {
    expect(equipmentVerificationInput.safeParse({ ...base, verdict: "ok" }).success).toBe(
      false,
    );
  });

  it("rejects a missing photo path", () => {
    expect(
      equipmentVerificationInput.safeParse({ ...base, verdict: "matched", photoPath: "" })
        .success,
    ).toBe(false);
  });

  it("rejects out-of-range geo", () => {
    expect(
      equipmentVerificationInput.safeParse({ ...base, verdict: "mismatch", photoLat: 95 })
        .success,
    ).toBe(false);
  });
});
