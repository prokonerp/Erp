import { itemDraftFromBreakup, INVOICE_STATUSES } from "@/lib/sales";

describe("sales/itemDraftFromBreakup", () => {
  it("merges the breakup totals onto the item draft", () => {
    const d: any = {
      product_id: "p1",
      description: "x",
      hsn: "8471",
      qty: "5",
      unit: "Nos",
      rate: "100",
      discount_pct: "0",
      gst_rate: "18",
      warehouse_id: "w1",
      serial_numbers: ["s1"],
    };
    const b: any = {
      taxable_value: 500,
      cgst: 45,
      sgst: 45,
      igst: 0,
      cess: 0,
      line_total: 590,
    };
    const row = itemDraftFromBreakup(d, b);
    expect(row.taxable_value).toBe(500);
    expect(row.cgst).toBe(45);
    expect(row.sgst).toBe(45);
    expect(row.line_total).toBe(590);
    expect(row.qty).toBe(5);
    expect(row.sr_no).toBe(0);
    expect(row.serial_numbers).toEqual(["s1"]);
  });
});

describe("sales/INVOICE_STATUSES badgeTone mapping", () => {
  it("maps each invoice status to the intended theme-aware tone", () => {
    const map = Object.fromEntries(
      INVOICE_STATUSES.map((s) => [s.value, s.badgeTone]),
    );
    expect(map.draft).toBe("neutral");
    expect(map.issued).toBe("info");
    expect(map.partial).toBe("warning");
    expect(map.paid).toBe("success");
    expect(map.cancelled).toBe("danger");
  });

  it("retains legacy tone classes for backward-compatible UI", () => {
    const draft = INVOICE_STATUSES.find((s) => s.value === "draft")!;
    expect(typeof draft.tone).toBe("string");
    expect(draft.tone.length).toBeGreaterThan(0);
  });
});
