/**
 * SO E2E Robust Tests — pure (no DB)
 * Covers 10 flows as spec, deterministic, r3 + string/number qty handling.
 * Uses helpers: buildFulfillmentPreview, validateThisQty, salesOrderToInvoicePartial,
 *               orderedVsFulfilled, isSoFullyDelivered, getReverseEffect,
 *               canCancelSalesOrder, soDerivedStatus
 */
import {
  buildFulfillmentPreview,
  validateThisQty,
  salesOrderToInvoicePartial,
  orderedVsFulfilled,
  isSoFullyDelivered,
  getReverseEffect,
  canCancelSalesOrder,
} from "@/lib/documentFlow";
import { soDerivedStatus } from "@/lib/salesOrders";
import { r3 } from "@/lib/money";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeSo(singleQty: number | string, opts?: Partial<any>): any {
  const qty = singleQty;
  return {
    id: "so-e2e-1",
    so_no: "SO-E2E-001",
    so_date: "2026-09-09",
    branch_id: "b1",
    customer_id: "c1",
    buyer_name: "Acme Corp",
    buyer_gstin: "29ABCDE1234F1Z5",
    buyer_state: "Karnataka",
    buyer_state_code: "29",
    billing_address: "BA",
    shipping_address: "SA",
    place_of_supply: "Karnataka",
    place_of_supply_code: "29",
    po_number: "PO-001",
    po_date: "2026-09-01",
    notes: "E2E SO",
    terms: "Net 30",
    payment_terms: "Net 30",
    linked_quote_id: "q1",
    status: "draft",
    shipping_charges: 0,
    adjustment: 0,
    tcs_percent: 0,
    tcs_amount: 0,
    round_off: 0,
    discount_label: null,
    discount_amount: 0,
    items: [
      {
        product_id: "p-ups-1",
        description: "UPS 1KVA",
        hsn: "8504",
        qty,
        unit: "Nos",
        rate: 5000,
        discount_pct: 0,
        gst_rate: 18,
        cess_rate: 0,
        warehouse_id: "w1",
        serial_numbers: [],
        is_serialized: false,
        part_model_no: "UPS-1KVA",
        part_name: "UPS 1KVA",
      },
    ],
    ...opts,
  };
}

function makeSummary(
  line_index: number,
  ordered_qty: number,
  fulfilled_stock: number,
  fulfilled_proforma: number,
  balance: number,
  product_id: string | null = "p-ups-1",
): any {
  return {
    sales_order_id: "so-e2e-1",
    line_index,
    product_id,
    ordered_qty,
    fulfilled_stock,
    fulfilled_proforma,
    balance: Math.max(0, balance),
    is_complete: balance <= 1e-9,
  };
}

/** Simulate VIEW filtering: cancelled conversions are excluded from fulfilled_stock */
function summaryFromConversions(
  ordered: number,
  stockFulfillments: Array<{ qty: number; cancelled: boolean }>,
  proformaFulfillments: Array<{ qty: number; cancelled: boolean }> = [],
): any[] {
  const fulfilled_stock = stockFulfillments.filter((f) => !f.cancelled).reduce((s, f) => s + f.qty, 0);
  const fulfilled_proforma = proformaFulfillments.filter((f) => !f.cancelled).reduce((s, f) => s + f.qty, 0);
  const balance = Math.max(0, r3(ordered - fulfilled_stock));
  return [makeSummary(0, r3(ordered), r3(fulfilled_stock), r3(fulfilled_proforma), r3(balance))];
}

// ──────────────────────────────────────────────────────────────────────────

describe("SO E2E – Flow1: 20 -> 17 (invoice) + 3 (GDC) -> fully delivered", () => {
  it("F1.1 ordered 20, invoice 17 + GDC 3 = fulfilled 20, balance 0, isSoFullyDelivered true, derived invoiced", () => {
    const so = makeSo(20);
    // Simulate both conversions non-cancelled
    const summary = summaryFromConversions(20, [
      { qty: 17, cancelled: false },
      { qty: 3, cancelled: false },
    ]);
    expect(summary[0].fulfilled_stock).toBe(20);
    expect(summary[0].balance).toBe(0);
    expect(isSoFullyDelivered(summary)).toBe(true);

    const ovf = orderedVsFulfilled(so, summary);
    expect(ovf.ordered).toBe(20);
    expect(ovf.fulfilled).toBe(20);
    expect(ovf.balance).toBe(0);

    // derived status: fully delivered + tax_invoice present => invoiced
    const conversions: any[] = [
      { conversion_type: "tax_invoice", status: "issued" },
      { conversion_type: "general_dc", status: "issued" },
    ];
    expect(soDerivedStatus(summary as any, "partial" as any, conversions as any)).toBe("invoiced");
    // without tax_invoice, would be delivered
    expect(soDerivedStatus(summary as any, "partial" as any, [{ conversion_type: "general_dc", status: "issued" }] as any)).toBe("delivered");
  });

  it("F1.2 preview after 17 fulfilled shows balance 3, validate 3 passes and slices invoice correctly", () => {
    const so = makeSo(20);
    const after17 = summaryFromConversions(20, [{ qty: 17, cancelled: false }]);
    const preview = buildFulfillmentPreview(so, after17);
    expect(preview[0].fulfilled_before).toBe(17);
    expect(preview[0].balance).toBe(3);
    expect(preview[0].this_qty).toBe(3);
    // user wants to ship remaining 3
    const lines: any[] = [{ ...preview[0], this_qty: 3, warehouse_id: "w1" }];
    expect(validateThisQty(lines)).toBeNull();
    const payload = salesOrderToInvoicePartial(so, lines);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].qty).toBe(3);
  });

  it("F1.3 string qty '20' handled identically via r3", () => {
    const soStr = makeSo("20" as unknown as number);
    const summary = summaryFromConversions(20, [
      { qty: 17, cancelled: false },
      { qty: 3, cancelled: false },
    ]);
    const preview = buildFulfillmentPreview(soStr, summary);
    expect(preview[0].ordered_qty).toBe(20);
    expect(preview[0].balance).toBe(0);
    expect(orderedVsFulfilled(soStr, summary).balance).toBe(0);
  });
});

describe("SO E2E – Flow2: cancel GDC 3 -> balance 3 restored, cancelled filtered", () => {
  it("F2.1 after cancelling GDC 3, balance restores to 3, isSoFullyDelivered false, orderedVsFulfilled reflects filtered", () => {
    const so = makeSo(20);
    // Cancel GDC: only invoice 17 remains
    const summary = summaryFromConversions(20, [
      { qty: 17, cancelled: false },
      { qty: 3, cancelled: true },
    ]);
    expect(summary[0].fulfilled_stock).toBe(17);
    expect(summary[0].balance).toBe(3);
    expect(isSoFullyDelivered(summary)).toBe(false);
    const ovf = orderedVsFulfilled(so, summary);
    expect(ovf.balance).toBe(3);
    expect(ovf.fulfilled).toBe(17);
    // preview should allow shipping 3 again
    const preview = buildFulfillmentPreview(so, summary);
    expect(preview[0].balance).toBe(3);
    expect(preview[0].this_qty).toBe(3);
    expect(validateThisQty([{ ...preview[0], warehouse_id: "w1" }] as any)).toBeNull();
  });

  it("F2.2 canCancel blocked while non-cancelled stock conversion exists, allowed after GDC cancelled but invoice still blocks", () => {
    const so: any = { id: "so-e2e-1", status: "partial" };
    // Only GDC cancelled, but tax_invoice still issued -> still blocked
    const convs1: any[] = [
      { conversion_type: "tax_invoice", status: "issued" },
      { conversion_type: "general_dc", status: "cancelled" },
    ];
    expect(canCancelSalesOrder(so, [], convs1).allowed).toBe(false);
    expect(canCancelSalesOrder(so, [], convs1).reason.toLowerCase()).toMatch(/stock conversion/);
    // Both cancelled -> allowed
    const convs2: any[] = [
      { conversion_type: "tax_invoice", status: "cancelled" },
      { conversion_type: "general_dc", status: "cancelled" },
    ];
    expect(canCancelSalesOrder(so, [], convs2).allowed).toBe(true);
  });

  it("F2.3 getReverseEffect correctly classifies GDC as stock-affecting (true)", () => {
    expect(getReverseEffect("general_dc")).toBe(true);
    expect(getReverseEffect("tax_invoice")).toBe(true);
  });
});

describe("SO E2E – Flow3: cancel tax invoice 17 -> balance 17 (20-3 remaining)", () => {
  it("F3.1 invoice cancelled, GDC 3 remains -> balance 17", () => {
    const so = makeSo(20);
    const summary = summaryFromConversions(20, [
      { qty: 17, cancelled: true },
      { qty: 3, cancelled: false },
    ]);
    expect(summary[0].fulfilled_stock).toBe(3);
    expect(summary[0].balance).toBe(17);
    const ovf = orderedVsFulfilled(so, summary);
    expect(ovf.fulfilled).toBe(3);
    expect(ovf.balance).toBe(17);
    expect(isSoFullyDelivered(summary)).toBe(false);
    // derived partial
    expect(soDerivedStatus(summary as any, "partial" as any, [{ conversion_type: "general_dc", status: "issued" }] as any)).toBe("partial");
  });

  it("F3.2 preview after invoice cancel shows balance 17, allows full 17 conversion, blocks 18", () => {
    const so = makeSo(20);
    const summary = summaryFromConversions(20, [
      { qty: 17, cancelled: true },
      { qty: 3, cancelled: false },
    ]);
    const preview = buildFulfillmentPreview(so, summary);
    expect(preview[0].balance).toBe(17);
    expect(validateThisQty([{ ...preview[0], this_qty: 17, warehouse_id: "w1" }] as any)).toBeNull();
    const err = validateThisQty([{ ...preview[0], this_qty: 18, warehouse_id: "w1" }] as any);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/exceeds/);
  });
});

describe("SO E2E – Flow4: cancel both -> balance 20, fully not delivered", () => {
  it("F4.1 both cancelled -> fulfilled 0, balance 20, not fully delivered, derived keeps draft/confirmed", () => {
    const so = makeSo(20);
    const summary = summaryFromConversions(20, [
      { qty: 17, cancelled: true },
      { qty: 3, cancelled: true },
    ]);
    expect(summary[0].fulfilled_stock).toBe(0);
    expect(summary[0].balance).toBe(20);
    expect(isSoFullyDelivered(summary)).toBe(false);
    const ovf = orderedVsFulfilled(so, summary);
    expect(ovf.fulfilled).toBe(0);
    expect(ovf.balance).toBe(20);
    // no non-cancelled stock => stays draft
    expect(soDerivedStatus(summary as any, "draft" as any, [] as any)).toBe("draft");
    expect(soDerivedStatus(summary as any, "confirmed" as any, [] as any)).toBe("confirmed");
  });

  it("F4.2 SO cancellable when all stock conversions cancelled", () => {
    const so: any = { id: "so-e2e-1", status: "partial" };
    const convs: any[] = [
      { conversion_type: "tax_invoice", status: "cancelled" },
      { conversion_type: "general_dc", status: "cancelled" },
    ];
    expect(canCancelSalesOrder(so, [], convs).allowed).toBe(true);
  });
});

describe("SO E2E – Flow5: proforma 5 NOT affect balance (excluded)", () => {
  it("F5.1 proforma 5 fulfilled_proforma=5 but balance stays 20, fulfilled_stock 0", () => {
    const so = makeSo(20);
    const summary = summaryFromConversions(20, [], [{ qty: 5, cancelled: false }]);
    expect(summary[0].fulfilled_stock).toBe(0);
    expect(summary[0].fulfilled_proforma).toBe(5);
    expect(summary[0].balance).toBe(20);
    const ovf = orderedVsFulfilled(so, summary);
    expect(ovf.fulfilled).toBe(0);
    expect(ovf.fulfilledProforma).toBe(5);
    expect(ovf.balance).toBe(20);
    expect(isSoFullyDelivered(summary)).toBe(false);
    expect(getReverseEffect("proforma_invoice")).toBe(false);
  });

  it("F5.2 proforma cancelled also does not affect balance", () => {
    const so = makeSo(20);
    const summary = summaryFromConversions(20, [], [{ qty: 5, cancelled: true }]);
    expect(summary[0].fulfilled_proforma).toBe(0);
    expect(summary[0].balance).toBe(20);
    const ovf = orderedVsFulfilled(so, summary);
    expect(ovf.balance).toBe(20);
  });

  it("F5.3 stock 20 + proforma 5 + invoice 10 -> balance 10 (proforma ignored)", () => {
    const so = makeSo(20);
    const summary = summaryFromConversions(20, [{ qty: 10, cancelled: false }], [{ qty: 5, cancelled: false }]);
    expect(summary[0].fulfilled_stock).toBe(10);
    expect(summary[0].fulfilled_proforma).toBe(5);
    expect(summary[0].balance).toBe(10);
    expect(orderedVsFulfilled(so, summary).balance).toBe(10);
  });
});

describe("SO E2E – Flow6: over-fulfillment attempt 25 when 20 ordered", () => {
  it("F6.1 validateThisQty error when this_qty 25 exceeds balance 20", () => {
    const so = makeSo(20);
    const summary = summaryFromConversions(20, []);
    const preview = buildFulfillmentPreview(so, summary);
    expect(preview[0].balance).toBe(20);
    const err = validateThisQty([{ ...preview[0], this_qty: 25, warehouse_id: "w1" }] as any);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/exceeds|balance/);
  });

  it("F6.2 even fractional over-fulfillment 20.001 exceeds 20 -> error", () => {
    const so = makeSo(20);
    const preview = buildFulfillmentPreview(so, summaryFromConversions(20, []));
    const err = validateThisQty([{ ...preview[0], this_qty: 20.001, warehouse_id: "w1" }] as any);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/exceeds/);
  });

  it("F6.3 r3 string qty '20' vs number 20 consistent over-fulfillment check", () => {
    const soNum = makeSo(20);
    const soStr = makeSo("20" as unknown as number);
    const sNum = buildFulfillmentPreview(soNum, []);
    const sStr = buildFulfillmentPreview(soStr, []);
    expect(sNum[0].balance).toBe(20);
    expect(sStr[0].balance).toBe(20);
    expect(validateThisQty([{ ...sNum[0], this_qty: 21, warehouse_id: "w1" }] as any)).not.toBeNull();
    expect(validateThisQty([{ ...sStr[0], this_qty: 21, warehouse_id: "w1" }] as any)).not.toBeNull();
  });
});

describe("SO E2E – Flow7: split 20 -> 10+7+3 cumulative", () => {
  it("F7.1 stepwise balances: 20->10 (bal10) ->7 (bal3) ->3 (bal0) and cumulative fulfilled 20", () => {
    const so = makeSo(20);
    // After 10
    let summary = summaryFromConversions(20, [{ qty: 10, cancelled: false }]);
    expect(summary[0].balance).toBe(10);
    expect(orderedVsFulfilled(so, summary).fulfilled).toBe(10);
    expect(isSoFullyDelivered(summary)).toBe(false);

    // After 10+7
    summary = summaryFromConversions(20, [
      { qty: 10, cancelled: false },
      { qty: 7, cancelled: false },
    ]);
    expect(summary[0].fulfilled_stock).toBe(17);
    expect(summary[0].balance).toBe(3);
    expect(soDerivedStatus(summary as any, "partial" as any, [{ conversion_type: "tax_invoice", status: "issued" }] as any)).toBe("partial");

    // After 10+7+3
    summary = summaryFromConversions(20, [
      { qty: 10, cancelled: false },
      { qty: 7, cancelled: false },
      { qty: 3, cancelled: false },
    ]);
    expect(summary[0].fulfilled_stock).toBe(20);
    expect(summary[0].balance).toBe(0);
    expect(isSoFullyDelivered(summary)).toBe(true);
  });

  it("F7.2 each partial payload slices qty correctly and does not mutate SO", () => {
    const so = makeSo(20);
    const cases: Array<{ qty: number }> = [{ qty: 10 }, { qty: 7 }, { qty: 3 }];
    for (const c of cases) {
      const preview = buildFulfillmentPreview(so, summaryFromConversions(20, []));
      const lines: any[] = [{ ...preview[0], this_qty: c.qty, warehouse_id: "w1" }];
      expect(validateThisQty(lines)).toBeNull();
      const payload = salesOrderToInvoicePartial(so, lines);
      expect(payload.items[0].qty).toBe(c.qty);
      expect(so.items[0].qty).toBe(20); // not mutated
    }
  });

  it("F7.3 string qty '5.500' r3 5.5 split 2.345 + 3.155 cumulative respects r3", () => {
    const so = makeSo("5.500" as unknown as number);
    const preview = buildFulfillmentPreview(so, []);
    expect(preview[0].ordered_qty).toBe(5.5);
    expect(preview[0].balance).toBe(5.5);
    // split 2.345 + 3.155 = 5.5
    const p1 = validateThisQty([{ ...preview[0], this_qty: 2.345, warehouse_id: "w1" }] as any);
    expect(p1).toBeNull();
    const p2 = validateThisQty([{ ...preview[0], this_qty: 3.155, warehouse_id: "w1" }] as any);
    expect(p2).toBeNull();
    // r3 ensures 2.345+3.155=5.5 exactly
    expect(r3(2.345 + 3.155)).toBe(5.5);
  });
});

describe("SO E2E – Flow8: serialized 2 units ['S1','S2']", () => {
  const serializedSo = () =>
    makeSo(2, {
      items: [
        {
          product_id: "p-ser-1",
          description: "Serialized UPS",
          hsn: "8504",
          qty: 2,
          unit: "Nos",
          rate: 10000,
          discount_pct: 0,
          gst_rate: 18,
          warehouse_id: "w1",
          serial_numbers: ["S1", "S2"],
          is_serialized: true,
          part_model_no: "UPS-1KVA-SER",
          part_name: "Serialized UPS",
        },
      ],
    });

  it("F8.1 invoice 1 with ['S1'] passes", () => {
    const so = serializedSo();
    const summary = summaryFromConversions(2, []);
    const preview = buildFulfillmentPreview(so, summary);
    const lines: any[] = [{ ...preview[0], this_qty: 1, serial_numbers: ["S1"], is_serialized: true, warehouse_id: "w1" }];
    expect(validateThisQty(lines)).toBeNull();
    const payload = salesOrderToInvoicePartial(so, lines);
    expect(payload.items[0].serial_numbers).toEqual(["S1"]);
  });

  it("F8.2 second invoice ['S2'] passes independently", () => {
    const so = serializedSo();
    // After first fulfilled 1
    const after1 = summaryFromConversions(2, [{ qty: 1, cancelled: false }]);
    const preview = buildFulfillmentPreview(so, after1);
    expect(preview[0].balance).toBe(1);
    const lines: any[] = [{ ...preview[0], this_qty: 1, serial_numbers: ["S2"], is_serialized: true, warehouse_id: "w1" }];
    expect(validateThisQty(lines)).toBeNull();
    const payload = salesOrderToInvoicePartial(so, lines);
    expect(payload.items[0].serial_numbers).toEqual(["S2"]);
  });

  it("F8.3 duplicate ['S1'] across lines detected via validateThisQty cross-line", () => {
    const so = serializedSo();
    const preview = buildFulfillmentPreview(so, summaryFromConversions(2, []));
    // Simulate payload with two lines both claiming S1 (duplicate across lines)
    const lines: any[] = [
      { ...preview[0], line_index: 0, this_qty: 1, serial_numbers: ["S1"], is_serialized: true, warehouse_id: "w1", description: "Ser line 0" },
      { ...preview[0], line_index: 1, product_id: "p-ser-2", this_qty: 1, serial_numbers: ["S1"], is_serialized: true, warehouse_id: "w1", description: "Ser line 1" },
    ];
    const err = validateThisQty(lines);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/duplicate serial/);
    expect(err!).toMatch(/S1/);
  });

  it("F8.4 duplicate within same line ['S1','S1'] also fails", () => {
    const so = serializedSo();
    const preview = buildFulfillmentPreview(so, summaryFromConversions(2, []));
    const lines: any[] = [{ ...preview[0], this_qty: 2, serial_numbers: ["S1", "S1"], is_serialized: true, warehouse_id: "w1" }];
    const err = validateThisQty(lines);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/duplicate serial/);
  });

  it("F8.5 fractional qty for serialized fails whole-number check", () => {
    const so = serializedSo();
    const preview = buildFulfillmentPreview(so, summaryFromConversions(2, []));
    const lines: any[] = [{ ...preview[0], this_qty: 1.5, serial_numbers: ["S1"], is_serialized: true, warehouse_id: "w1" }];
    const err = validateThisQty(lines);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/whole-number/);
  });
});

describe("SO E2E – Flow9: negative stock concept (UPS-1KVA 100 need, avail 10)", () => {
  // Pure helper mimicking stock ledger findShortfalls
  function findShortfalls(
    required: Array<{ model_no: string; qty: number; warehouse_id: string | null }>,
    stock: Map<string, number>,
  ): Array<{ model_no: string; required: number; available: number; shortfall: number }> {
    return required
      .map((r) => {
        const key = `${r.model_no}::${r.warehouse_id ?? "default"}`;
        const avail = stock.get(key) ?? 0;
        if (r.qty > avail) return { model_no: r.model_no, required: r.qty, available: avail, shortfall: r.qty - avail };
        return null;
      })
      .filter(Boolean) as any[];
  }
  function blockMessage(shortfalls: Array<{ model_no: string; shortfall: number }>): string | null {
    if (shortfalls.length === 0) return null;
    return `Insufficient stock: ${shortfalls.map((s) => `${s.model_no} short ${s.shortfall}`).join(", ")}`;
  }

  it("F9.1 shortfall detected: need 100, avail 10 -> blockMessage present, allowNegative false blocks", () => {
    const stock = new Map([["UPS-1KVA::w1", 10]]);
    const shorts = findShortfalls([{ model_no: "UPS-1KVA", qty: 100, warehouse_id: "w1" }], stock);
    expect(shorts).toHaveLength(1);
    expect(shorts[0].shortfall).toBe(90);
    const msg = blockMessage(shorts);
    expect(msg).not.toBeNull();
    expect(msg!).toMatch(/UPS-1KVA/);
    expect(msg!).toMatch(/short 90/);
    // Pure allowNegative audit concept: when false, caller should refuse
    const allowNegative = false;
    const shouldBlock = !!msg && !allowNegative;
    expect(shouldBlock).toBe(true);
  });

  it("F9.2 with allowNegative true, shortfall still reported but audit allows override", () => {
    const stock = new Map([["UPS-1KVA::w1", 10]]);
    const shorts = findShortfalls([{ model_no: "UPS-1KVA", qty: 100, warehouse_id: "w1" }], stock);
    const msg = blockMessage(shorts);
    const allowNegative = true;
    const shouldBlock = !!msg && !allowNegative;
    expect(shouldBlock).toBe(false);
    // audit trail concept: record wasNegative flag
    const wasNegative = shorts.length > 0;
    expect(wasNegative).toBe(true);
  });

  it("F9.3 exact available 10 -> no shortfall, no block", () => {
    const stock = new Map([["UPS-1KVA::w1", 10]]);
    const shorts = findShortfalls([{ model_no: "UPS-1KVA", qty: 10, warehouse_id: "w1" }], stock);
    expect(shorts).toHaveLength(0);
    expect(blockMessage(shorts)).toBeNull();
  });

  it("F9.4 multiple lines shortfalls aggregated", () => {
    const stock = new Map([
      ["UPS-1KVA::w1", 5],
      ["BAT-12V::w1", 20],
    ]);
    const shorts = findShortfalls(
      [
        { model_no: "UPS-1KVA", qty: 10, warehouse_id: "w1" },
        { model_no: "BAT-12V", qty: 5, warehouse_id: "w1" },
        { model_no: "UPS-2KVA::w1", qty: 1, warehouse_id: "w1" } as any,
      ],
      stock,
    );
    // BAT-12V not short, UPS-1KVA short 5, UPS-2KVA not in stock -> short 1
    expect(shorts.some((s) => s.model_no === "UPS-1KVA" && s.shortfall === 5)).toBe(true);
  });
});

describe("SO E2E – Flow10: SO cancellation canCancel logic", () => {
  it("F10.1 draft with no conversions -> canCancel allowed", () => {
    const so: any = { id: "so-e2e-1", status: "draft" };
    expect(canCancelSalesOrder(so, [], []).allowed).toBe(true);
  });

  it("F10.2 partial with non-cancelled stock conversion -> blocked", () => {
    const so: any = { id: "so-e2e-1", status: "partial" };
    const convs: any[] = [{ conversion_type: "tax_invoice", status: "issued" }];
    const res = canCancelSalesOrder(so, [], convs);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/stock conversion/);
  });

  it("F10.3 partial with only proforma -> allowed (proforma not stock)", () => {
    const so: any = { id: "so-e2e-1", status: "partial" };
    const convs: any[] = [{ conversion_type: "proforma_invoice", status: "issued" }];
    expect(canCancelSalesOrder(so, [], convs).allowed).toBe(true);
  });

  it("F10.4 delivered/invoiced/cancelled terminal blocks cancellation", () => {
    for (const status of ["delivered", "invoiced", "cancelled"]) {
      const so: any = { id: "so-e2e-1", status };
      const res = canCancelSalesOrder(so, [], []);
      expect(res.allowed).toBe(false);
      expect(res.reason.toLowerCase()).toMatch(/already/);
    }
  });

  it("F10.5 all stock conversions cancelled -> allowed even with fulfilled>0 in history", () => {
    const so: any = { id: "so-e2e-1", status: "partial" };
    const convs: any[] = [
      { conversion_type: "tax_invoice", status: "cancelled" },
      { conversion_type: "general_dc", status: "cancelled" },
      { conversion_type: "delivery_challan", status: "cancelled" },
    ];
    expect(canCancelSalesOrder(so, [], convs).allowed).toBe(true);
    // getReverseEffect confirms these were stock-affecting, so cancellation restores
    expect(getReverseEffect("tax_invoice")).toBe(true);
    expect(getReverseEffect("general_dc")).toBe(true);
    expect(getReverseEffect("delivery_challan")).toBe(true);
  });

  it("F10.6 confirmed with no summary still allowed (pure guard does not block on summary alone)", () => {
    const so: any = { id: "so-e2e-1", status: "confirmed" };
    const summary = [makeSummary(0, 20, 20, 0, 0)]; // would be fully delivered but status not terminal
    // Pure guard only blocks on status + blocking conversions, not on summary is_complete
    expect(canCancelSalesOrder(so, summary as any, []).allowed).toBe(true);
  });
});

// Additional r3 + string/number deterministic checks
describe("SO E2E – deterministic r3 and string handling", () => {
  it("r3 rounding for 2.3456 -> 2.346 used in preview ordered_qty", () => {
    const so = makeSo("2.3456" as unknown as number);
    const preview = buildFulfillmentPreview(so, []);
    expect(preview[0].ordered_qty).toBe(2.346);
    expect(preview[0].balance).toBe(2.346);
    expect(preview[0].this_qty).toBe(2.346);
  });

  it("string '10' vs number 10 both produce same preview and validation", () => {
    const soNum = makeSo(10);
    const soStr = makeSo("10" as unknown as number);
    const pNum = buildFulfillmentPreview(soNum, summaryFromConversions(10, [{ qty: 3, cancelled: false }]));
    const pStr = buildFulfillmentPreview(soStr, summaryFromConversions(10, [{ qty: 3, cancelled: false }]));
    expect(pNum[0].balance).toBe(7);
    expect(pStr[0].balance).toBe(7);
    expect(validateThisQty([{ ...pNum[0], warehouse_id: "w1" }] as any)).toBeNull();
    expect(validateThisQty([{ ...pStr[0], warehouse_id: "w1" }] as any)).toBeNull();
  });

  it("salesOrderToInvoicePartial preserves r3 this_qty exactly", () => {
    const so = makeSo("7.777" as unknown as number); // will be r3 7.777
    const preview = buildFulfillmentPreview(so, []);
    expect(preview[0].ordered_qty).toBe(7.777);
    const lines: any[] = [{ ...preview[0], this_qty: 2.346, warehouse_id: "w1" }];
    const payload = salesOrderToInvoicePartial(so, lines);
    expect(payload.items[0].qty).toBe(r3(2.346));
  });
});
