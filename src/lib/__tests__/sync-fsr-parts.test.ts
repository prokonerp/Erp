import { describe, it, expect } from "vitest";
import { PART_SOURCE_FSR, stageFsrParts, mergePartLines } from "@/lib/sync-fsr-parts";
import { toStageInput } from "@/lib/sync-fsr-parts.functions";
import type { PartLine } from "@/lib/tickets";

const adminLine = (over: Partial<PartLine> = {}): PartLine => ({
  name: "PCB",
  qty: "1",
  serial: "ABC123",
  source: "manual",
  ...over,
});

describe("stageFsrParts mapping", () => {
  it("stages the defective direction with serial = oldSrNo and no remarks", () => {
    const { defective } = stageFsrParts([{ item: "PCB", qty: 2, oldSrNo: "OLD1" }]);
    expect(defective).toEqual([{ name: "PCB", qty: 2, serial: "OLD1", remarks: null }]);
  });

  it("stages defective with null serial when oldSrNo is missing (no barcode fallback)", () => {
    const { defective } = stageFsrParts([{ item: "PCB" }]);
    expect(defective[0].serial).toBeNull();
    expect(defective[0].remarks).toBeNull();
  });

  it("stages the good direction only when newSrNo is present, with no challan remark", () => {
    const withNew = stageFsrParts([{ item: "PCB", newSrNo: "NEW1" }]);
    expect(withNew.good).toEqual([{ name: "PCB", qty: 1, serial: "NEW1", remarks: null }]);
    const withoutNew = stageFsrParts([{ item: "PCB" }]);
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
    expect(stageFsrParts([])).toEqual({ defective: [], good: [], skipped: 0 });
  });

  it("skips non-integer qty 2.5 (skipped === 1, nothing staged)", () => {
    const { defective, good, skipped } = stageFsrParts([{ item: "PCB", qty: 2.5 }]);
    expect(skipped).toBe(1);
    expect(defective).toEqual([]);
    expect(good).toEqual([]);
  });

  it("skips qty 0 and qty -3 (skipped === 2)", () => {
    const { defective, good, skipped } = stageFsrParts([
      { item: "PCB", qty: 0 },
      { item: "Fan", qty: -3 },
    ]);
    expect(skipped).toBe(2);
    expect(defective).toEqual([]);
    expect(good).toEqual([]);
  });

  it("stages qty null/undefined with legacy default qty 1", () => {
    const { defective, skipped } = stageFsrParts([{ item: "PCB", qty: null }, { item: "Fan" }]);
    expect(skipped).toBe(0);
    expect(defective).toEqual([
      { name: "PCB", qty: 1, serial: null, remarks: null },
      { name: "Fan", qty: 1, serial: null, remarks: null },
    ]);
  });
});

describe("toStageInput qty coercion", () => {
  it('coerces numeric string "2" to qty 2 (stages qty 2)', () => {
    const input = toStageInput({ item: "PCB", qty: "2" });
    expect(input.qty).toBe(2);
    const { defective } = stageFsrParts([input]);
    expect(defective[0].qty).toBe(2);
  });

  it('falls back to qty 1 for non-numeric "abc"', () => {
    const input = toStageInput({ item: "PCB", qty: "abc" });
    expect(input.qty).toBeNull();
    const { defective } = stageFsrParts([input]);
    expect(defective[0].qty).toBe(1);
  });

  it('falls back to qty 1 for empty string ""', () => {
    const input = toStageInput({ item: "PCB", qty: "" });
    expect(input.qty).toBeNull();
    const { defective } = stageFsrParts([input]);
    expect(defective[0].qty).toBe(1);
  });

  it("ignores legacy old_barcode keys (field removed)", () => {
    const input = toStageInput({ item: "PCB", old_sr_no: "OLD1", old_barcode: "BAR9" });
    expect("oldBarcode" in input).toBe(false);
    const { defective } = stageFsrParts([input]);
    expect(defective[0].serial).toBe("OLD1");
    expect(defective[0].remarks).toBeNull();
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

  it("keeps blank-serial same-name lines with different qty as separate lines", () => {
    const { merged, added } = mergePartLines(
      [],
      [
        { name: "PCB", qty: 2, serial: null, remarks: null },
        { name: "PCB", qty: 3, serial: null, remarks: null },
      ],
    );
    expect(added).toBe(2);
    expect(merged).toHaveLength(2);
  });

  it("is idempotent with qty keys, deduping same-name same-qty on second pass", () => {
    const staged = [
      { name: "PCB", qty: 2, serial: null, remarks: null },
      { name: "PCB", qty: 2, serial: null, remarks: null },
      { name: "PCB", qty: 3, serial: null, remarks: null },
    ];
    const first = mergePartLines([], staged);
    expect(first.merged).toHaveLength(2);
    const second = mergePartLines(first.merged, staged);
    expect(second.added).toBe(0);
    expect(second.merged).toEqual(first.merged);
  });
});
