import { describe, it, expect } from "vitest";
import { PART_SOURCE_FSR, stageFsrParts, mergePartLines } from "@/lib/sync-fsr-parts";
import type { PartLine } from "@/lib/tickets";

const adminLine = (over: Partial<PartLine> = {}): PartLine => ({
  name: "PCB",
  qty: "1",
  serial: "ABC123",
  source: "manual",
  ...over,
});

describe("stageFsrParts mapping", () => {
  it("stages the defective direction with serial = oldSrNo ?? oldBarcode", () => {
    const { defective } = stageFsrParts([
      { item: "PCB", qty: 2, oldSrNo: "OLD1", oldBarcode: "BAR1" },
    ]);
    expect(defective).toEqual([{ name: "PCB", qty: 2, serial: "OLD1", remarks: "Barcode: BAR1" }]);
  });

  it("falls back to oldBarcode when oldSrNo is missing", () => {
    const { defective } = stageFsrParts([{ item: "PCB", oldBarcode: "BAR9" }]);
    expect(defective[0].serial).toBe("BAR9");
    expect(defective[0].remarks).toBeNull();
  });

  it("stages the good direction only when newSrNo is present, noting the challan", () => {
    const withNew = stageFsrParts([{ item: "PCB", newSrNo: "NEW1", newChallan: "CH5" }]);
    expect(withNew.good).toEqual([
      { name: "PCB", qty: 1, serial: "NEW1", remarks: "Challan: CH5" },
    ]);
    const withoutNew = stageFsrParts([{ item: "PCB", newChallan: "CH5" }]);
    expect(withoutNew.good).toEqual([]);
    // defective side still stages for the same entry
    expect(withoutNew.defective).toHaveLength(1);
  });

  it("skips empties (blank item)", () => {
    const { defective, good } = stageFsrParts([{ item: "  " }, { item: null }, {}]);
    expect(defective).toEqual([]);
    expect(good).toEqual([]);
  });

  it("empty parts stage to nothing", () => {
    expect(stageFsrParts([])).toEqual({ defective: [], good: [] });
  });
});

describe("mergePartLines", () => {
  it("is idempotent: merge(merge(e,s),s) deep-equals merge(e,s)", () => {
    const existing: PartLine[] = [adminLine()];
    const staged = stageFsrParts([
      { item: "PCB", oldSrNo: "OLD1" },
      { item: "Fan", newSrNo: "NEW2" },
    ]).defective;
    const first = mergePartLines(existing, staged);
    const second = mergePartLines(first.merged, staged);
    expect(second.added).toBe(0);
    expect(second.merged).toEqual(first.merged);
  });

  it("preserves admin lines (source != fsr) even with the same serial", () => {
    const existing: PartLine[] = [adminLine({ serial: "DUP1" })];
    const { merged, added } = mergePartLines(existing, [
      { name: "PCB", qty: 1, serial: "DUP1", remarks: null },
    ]);
    expect(added).toBe(1);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(adminLine({ serial: "DUP1" }));
    expect(merged[1]).toMatchObject({ source: PART_SOURCE_FSR, confirmed: false });
  });

  it("dedupes fsr lines on case/whitespace-insensitive serial", () => {
    const existing: PartLine[] = [
      {
        name: "PCB",
        qty: "1",
        serial: "  AbC123 ",
        source: PART_SOURCE_FSR as PartLine["source"],
        confirmed: false,
        indent_id: null,
      },
    ];
    const { merged, added } = mergePartLines(existing, [
      { name: "pcb", qty: 1, serial: "abc123", remarks: null },
      { name: "PCB", qty: 1, serial: "  ABC123", remarks: null },
    ]);
    expect(added).toBe(0);
    expect(merged).toEqual(existing);
  });

  it("appends staged lines after existing ones with fsr source + confirmed:false", () => {
    const existing: PartLine[] = [adminLine()];
    const { merged, added } = mergePartLines(existing, [
      { name: "Fan", qty: 2, serial: "F1", remarks: "Challan: C1" },
    ]);
    expect(added).toBe(1);
    expect(merged[0]).toEqual(adminLine());
    expect(merged[1]).toEqual({
      name: "Fan",
      qty: "2",
      serial: "F1",
      remarks: "Challan: C1",
      confirmed: false,
      source: PART_SOURCE_FSR,
      indent_id: null,
    });
  });

  it("empty staged input adds zero lines", () => {
    const existing: PartLine[] = [adminLine()];
    const { merged, added } = mergePartLines(existing, []);
    expect(added).toBe(0);
    expect(merged).toEqual(existing);
  });
});
