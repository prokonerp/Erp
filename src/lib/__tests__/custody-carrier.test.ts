import { describe, it, expect } from "vitest";
import {
  shouldStampCustodian,
  stampDcCustody,
  clearGrnCustody,
} from "@/lib/custody-utils";

describe("shouldStampCustodian", () => {
  it("stamps only-NULL rows", () => {
    expect(shouldStampCustodian({ current_custodian: null })).toBe(true);
    expect(shouldStampCustodian({ current_custodian: undefined })).toBe(true);
    expect(shouldStampCustodian({ current_custodian: "Carrier A" })).toBe(false);
    expect(shouldStampCustodian({ current_custodian: "" })).toBe(false);
  });
});

describe("stampDcCustody (DC submit)", () => {
  it("stamps only-NULL rows, leaves already-set custodian unchanged", () => {
    const rows = [
      { serial_no: "S1", current_custodian: null },
      { serial_no: "S2", current_custodian: "Carrier A" },
      { serial_no: "S3", current_custodian: null },
    ];
    const out = stampDcCustody(rows, "Carrier B");
    expect(out[0].current_custodian).toBe("Carrier B");
    expect(out[2].current_custodian).toBe("Carrier B");
    // re-submit idempotent: already-set custodian unchanged
    expect(out[1].current_custodian).toBe("Carrier A");
  });

  it("re-submit is idempotent (second stamp does not overwrite)", () => {
    const rows = [{ serial_no: "S1", current_custodian: "Carrier B" }];
    const out = stampDcCustody(rows, "Carrier B");
    expect(out[0].current_custodian).toBe("Carrier B");
    const out2 = stampDcCustody(out, "Carrier C");
    expect(out2[0].current_custodian).toBe("Carrier B");
  });

  it("carrier-less DC is a no-op", () => {
    const rows = [{ serial_no: "S1", current_custodian: null }];
    expect(stampDcCustody(rows, null)).toEqual(rows);
    expect(stampDcCustody(rows, "")).toEqual(rows);
    expect(stampDcCustody(rows, "   ")).toEqual(rows);
    expect(stampDcCustody(rows, undefined)).toEqual(rows);
  });
});

describe("clearGrnCustody (GRN receipt)", () => {
  it("clears only-NOT-NULL rows matched by serials[]", () => {
    const rows = [
      { serial_no: "S1", current_custodian: "Carrier B" },
      { serial_no: "S2", current_custodian: null },
      { serial_no: "S3", current_custodian: "Carrier B" },
    ];
    const res = clearGrnCustody(rows, { serials: ["S1", "S2"] });
    expect(res.cleared).toEqual(["S1"]);
    expect(res.warnings).toEqual([]);
    expect(res.updated.find((r) => r.serial_no === "S1")?.current_custodian).toBeNull();
    // already-NULL stays NULL and is not counted as cleared
    expect(res.updated.find((r) => r.serial_no === "S2")?.current_custodian).toBeNull();
    // unmatched NOT-NULL row untouched
    expect(res.updated.find((r) => r.serial_no === "S3")?.current_custodian).toBe("Carrier B");
  });

  it("falls back to serial_no when serials[] is empty", () => {
    const rows = [{ serial_no: "S9", current_custodian: "Carrier B" }];
    const res = clearGrnCustody(rows, { serials: [], serial_no: "S9" });
    expect(res.cleared).toEqual(["S9"]);
    expect(res.updated[0].current_custodian).toBeNull();
  });

  it("unknown serial warns-not-fails (receipt succeeds)", () => {
    const rows = [{ serial_no: "S1", current_custodian: "Carrier B" }];
    const res = clearGrnCustody(rows, { serials: ["NOPE"] });
    expect(res.cleared).toEqual([]);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/NOPE/);
    // receipt succeeds: rows unchanged, no throw
    expect(res.updated).toEqual(rows);
  });
});
