/**
 * SO Cancellation – focused reverse effects (pure, deterministic)
 * Covers: soDerivedStatus with cancelled vs non-cancelled,
 *         proforma NOT affect vs tax_invoice DOES affect,
 *         stock after cancellation restores balance and next conversion passes,
 *         isSoFullyDelivered false when any balance >0
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

function makeSo(qty: number | string, status: string = "partial"): any {
  return {
    id: "so-cancel-1",
    so_no: "SO-CANCEL-001",
    so_date: "2026-09-09",
    branch_id: "b1",
    customer_id: "c1",
    buyer_name: "Acme",
    buyer_gstin: "29ABCDE1234F1Z5",
    buyer_state: "Karnataka",
    buyer_state_code: "29",
    billing_address: "BA",
    shipping_address: "SA",
    place_of_supply: "Karnataka",
    place_of_supply_code: "29",
    po_number: "PO-CANCEL",
    po_date: "2026-09-01",
    notes: "cancel test",
    terms: "Net 30",
    payment_terms: "Net 30",
    linked_quote_id: "q1",
    status,
    shipping_charges: 0,
    adjustment: 0,
    tcs_percent: 0,
    tcs_amount: 0,
    round_off: 0,
    discount_label: null,
    discount_amount: 0,
    items: [
      {
        product_id: "p1",
        description: "Widget A",
        hsn: "8471",
        qty,
        unit: "Nos",
        rate: 100,
        discount_pct: 0,
        gst_rate: 18,
        warehouse_id: "w1",
        serial_numbers: [],
        is_serialized: false,
      },
    ],
  };
}

function summaryRow(ordered: number, fulfilled_stock: number, fulfilled_proforma: number, balance: number): any {
  return {
    sales_order_id: "so-cancel-1",
    line_index: 0,
    product_id: "p1",
    ordered_qty: r3(ordered),
    fulfilled_stock: r3(fulfilled_stock),
    fulfilled_proforma: r3(fulfilled_proforma),
    balance: r3(balance),
    is_complete: balance <= 1e-9,
  };
}

describe("soCancellation – soDerivedStatus with cancelled vs non-cancelled", () => {
  it("C1 fully delivered summary + tax_invoice issued -> invoiced", () => {
    const s = [summaryRow(20, 20, 0, 0)];
    expect(soDerivedStatus(s as any, "partial" as any, [{ conversion_type: "tax_invoice", status: "issued" }] as any)).toBe("invoiced");
  });

  it("C2 fully delivered summary but tax_invoice cancelled -> delivered (not invoiced) when only GDC remains", () => {
    const s = [summaryRow(20, 20, 0, 0)];
    // tax_invoice cancelled should not count -> falls back to delivered if GDC present
    expect(soDerivedStatus(s as any, "partial" as any, [
      { conversion_type: "tax_invoice", status: "cancelled" },
      { conversion_type: "general_dc", status: "issued" },
    ] as any)).toBe("delivered");
  });

  it("C3 fully delivered but ALL conversions cancelled -> keeps current status (no non-cancelled stock) when VIEW already refreshed", () => {
    // After all cancelled, VIEW would show fulfilled 0, balance 20 (fresh)
    const freshAfterCancel = [summaryRow(20, 0, 0, 20)];
    expect(soDerivedStatus(freshAfterCancel as any, "partial" as any, [{ conversion_type: "tax_invoice", status: "cancelled" }] as any)).toBe("partial");
    expect(soDerivedStatus(freshAfterCancel as any, "draft" as any, [{ conversion_type: "tax_invoice", status: "cancelled" }] as any)).toBe("draft");
    // Stale summary edge: if caller passes stale 20/0 with cancelled-only, code still treats as delivered (since totalFulfilled>0 && allComplete)
    const stale = [summaryRow(20, 20, 0, 0)];
    expect(soDerivedStatus(stale as any, "partial" as any, [{ conversion_type: "tax_invoice", status: "cancelled" }] as any)).toBe("delivered");
  });

  it("C4 partial summary (balance>0) -> partial regardless of invoice presence", () => {
    const s = [summaryRow(20, 10, 0, 10)];
    expect(soDerivedStatus(s as any, "partial" as any, [{ conversion_type: "tax_invoice", status: "issued" }] as any)).toBe("partial");
    expect(soDerivedStatus(s as any, "draft" as any, [{ conversion_type: "tax_invoice", status: "issued" }] as any)).toBe("partial");
  });

  it("C5 cancelled status terminal even with fulfilled summary", () => {
    const s = [summaryRow(20, 20, 0, 0)];
    expect(soDerivedStatus(s as any, "cancelled" as any, [{ conversion_type: "tax_invoice", status: "issued" }] as any)).toBe("cancelled");
  });

  it("C6 empty summary returns currentStatus or draft", () => {
    expect(soDerivedStatus([] as any, "confirmed" as any)).toBe("confirmed");
    expect(soDerivedStatus(null as any, undefined as any)).toBe("draft");
  });
});

describe("soCancellation – proforma vs tax_invoice reverse effect on balance", () => {
  it("C7 proforma cancellation does NOT affect balance (balance stays 20)", () => {
    expect(getReverseEffect("proforma_invoice")).toBe(false);
    const so = makeSo(20);
    const before = [summaryRow(20, 0, 5, 20)];
    expect(orderedVsFulfilled(so, before).balance).toBe(20);
    expect(orderedVsFulfilled(so, before).fulfilledProforma).toBe(5);
    // After proforma cancelled -> fulfilled_proforma 0, balance still 20
    const after = [summaryRow(20, 0, 0, 20)];
    expect(orderedVsFulfilled(so, after).balance).toBe(20);
    expect(orderedVsFulfilled(so, after).fulfilledProforma).toBe(0);
    expect(isSoFullyDelivered(before)).toBe(false);
    expect(isSoFullyDelivered(after)).toBe(false);
  });

  it("C8 tax_invoice cancellation DOES restore balance (20 ordered, 10 invoiced -> cancel -> balance 20 again)", () => {
    expect(getReverseEffect("tax_invoice")).toBe(true);
    expect(getReverseEffect("general_dc")).toBe(true);
    expect(getReverseEffect("delivery_challan")).toBe(true);
    const so = makeSo(20);
    const beforeCancel = [summaryRow(20, 10, 0, 10)];
    expect(orderedVsFulfilled(so, beforeCancel).balance).toBe(10);
    const afterCancel = [summaryRow(20, 0, 0, 20)];
    expect(orderedVsFulfilled(so, afterCancel).balance).toBe(20);
    expect(orderedVsFulfilled(so, afterCancel).fulfilled).toBe(0);
  });

  it("C9 delivery_challan cancellation restores balance", () => {
    expect(getReverseEffect("delivery_challan")).toBe(true);
    const so = makeSo(20);
    const afterDc = [summaryRow(20, 5, 0, 15)];
    expect(orderedVsFulfilled(so, afterDc).balance).toBe(15);
    const afterCancel = [summaryRow(20, 0, 0, 20)];
    expect(orderedVsFulfilled(so, afterCancel).balance).toBe(20);
  });

  it("C10 proforma never blocks canCancel (non-stock)", () => {
    const so: any = { id: "so-cancel-1", status: "partial" };
    expect(canCancelSalesOrder(so, [], [{ conversion_type: "proforma_invoice", status: "issued" }] as any).allowed).toBe(true);
    expect(canCancelSalesOrder(so, [], [{ conversion_type: "proforma_invoice", status: "cancelled" }] as any).allowed).toBe(true);
  });

  it("C11 tax_invoice issued blocks canCancel, cancelled allows", () => {
    const so: any = { id: "so-cancel-1", status: "partial" };
    expect(canCancelSalesOrder(so, [], [{ conversion_type: "tax_invoice", status: "issued" }] as any).allowed).toBe(false);
    expect(canCancelSalesOrder(so, [], [{ conversion_type: "tax_invoice", status: "cancelled" }] as any).allowed).toBe(true);
  });
});

describe("soCancellation – stock after cancellation restores and next conversion passes", () => {
  it("C12 after cancel, balance restored and next conversion with restored qty passes validation", () => {
    const so = makeSo(20);
    // Initially invoice 20 (fully delivered)
    const fully = [summaryRow(20, 20, 0, 0)];
    expect(isSoFullyDelivered(fully)).toBe(true);
    // Cancel invoice -> 0 fulfilled, balance 20
    const restored = [summaryRow(20, 0, 0, 20)];
    expect(orderedVsFulfilled(so, restored).balance).toBe(20);
    const preview = buildFulfillmentPreview(so, restored);
    expect(preview[0].balance).toBe(20);
    expect(preview[0].this_qty).toBe(20);
    const lines: any[] = [{ ...preview[0], this_qty: 20, warehouse_id: "w1" }];
    expect(validateThisQty(lines)).toBeNull();
    const payload = salesOrderToInvoicePartial(so, lines);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].qty).toBe(20);
  });

  it("C13 after partial cancel (10 of 20 cancelled -> 10 remains), next 10 passes but 11 fails", () => {
    const so = makeSo(20);
    const partial = [summaryRow(20, 10, 0, 10)]; // 10 still fulfilled (e.g., GDC 10 remains)
    const preview = buildFulfillmentPreview(so, partial);
    expect(preview[0].balance).toBe(10);
    expect(validateThisQty([{ ...preview[0], this_qty: 10, warehouse_id: "w1" }] as any)).toBeNull();
    const err = validateThisQty([{ ...preview[0], this_qty: 11, warehouse_id: "w1" }] as any);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/exceeds/);
  });

  it("C14 string qty '20' after cancellation still restores and validates", () => {
    const soStr = makeSo("20" as unknown as number);
    const restored = [summaryRow(20, 0, 0, 20)];
    const preview = buildFulfillmentPreview(soStr, restored);
    expect(preview[0].ordered_qty).toBe(20);
    expect(preview[0].balance).toBe(20);
    expect(validateThisQty([{ ...preview[0], this_qty: 20, warehouse_id: "w1" }] as any)).toBeNull();
  });

  it("C15 r3 fractional 10.123 + cancellation restores fractional balance exactly", () => {
    const qty = r3(10.123); // 10.123
    const so = makeSo(qty);
    const fulfilled = [summaryRow(qty, r3(7.777), 0, r3(qty - 7.777))];
    expect(fulfilled[0].balance).toBe(r3(qty - 7.777));
    const restored = [summaryRow(qty, 0, 0, qty)];
    expect(orderedVsFulfilled(so, restored).balance).toBe(qty);
    const preview = buildFulfillmentPreview(so, restored);
    expect(preview[0].balance).toBe(qty);
  });
});

describe("soCancellation – isSoFullyDelivered false when any balance >0", () => {
  it("C16 single line balance 0.001 -> not fully delivered (r3 epsilon)", () => {
    const s = [summaryRow(20, r3(19.999), 0, r3(0.001))];
    expect(s[0].balance).toBe(0.001);
    expect(isSoFullyDelivered(s)).toBe(false);
  });

  it("C17 multi-line one balance >0 -> false, all 0 -> true", () => {
    const multiPartial = [
      summaryRow(10, 10, 0, 0),
      summaryRow(5, 3, 0, 2),
      summaryRow(8, 8, 0, 0),
    ].map((r, idx) => ({ ...r, line_index: idx }));
    expect(isSoFullyDelivered(multiPartial as any)).toBe(false);
    const multiFull = [
      summaryRow(10, 10, 0, 0),
      summaryRow(5, 5, 0, 0),
      summaryRow(8, 8, 0, 0),
    ].map((r, idx) => ({ ...r, line_index: idx }));
    expect(isSoFullyDelivered(multiFull as any)).toBe(true);
  });

  it("C18 is_complete flag true makes delivered even if balance numeric noise", () => {
    const s: any[] = [{ fulfilled_stock: 10, balance: 999, is_complete: true }];
    expect(isSoFullyDelivered(s as any)).toBe(true);
  });

  it("C19 orderedVsFulfilled sums balance correctly after cancellation", () => {
    const so = makeSo(20);
    const summary = [
      { ...summaryRow(10, 10, 0, 0), line_index: 0 },
      { ...summaryRow(10, 0, 0, 10), line_index: 1 },
    ];
    const ovf = orderedVsFulfilled(so, summary as any);
    expect(ovf.ordered).toBe(20);
    expect(ovf.fulfilled).toBe(10);
    expect(ovf.balance).toBe(10);
    expect(isSoFullyDelivered(summary as any)).toBe(false);
  });

  it("C20 null/empty summary -> not fully delivered", () => {
    expect(isSoFullyDelivered(null as any)).toBe(false);
    expect(isSoFullyDelivered([] as any)).toBe(false);
    expect(isSoFullyDelivered([null as any, undefined as any] as any)).toBe(false);
  });

  it("C21 proforma-only fulfilled does not make isSoFullyDelivered true", () => {
    const s = [summaryRow(20, 0, 20, 20)]; // fulfilled_proforma 20 but fulfilled_stock 0, balance 20
    expect(s[0].fulfilled_proforma).toBe(20);
    expect(s[0].balance).toBe(20);
    expect(isSoFullyDelivered(s as any)).toBe(false);
    expect(orderedVsFulfilled(makeSo(20), s as any).fulfilled).toBe(0);
  });
});

describe("soCancellation – canCancel combinations", () => {
  it("C22 multiple stock conversions mixed cancelled/non-cancelled -> blocked if any non-cancelled remains", () => {
    const so: any = { id: "so-cancel-1", status: "partial" };
    const convs: any[] = [
      { conversion_type: "tax_invoice", status: "cancelled" },
      { conversion_type: "general_dc", status: "issued" }, // one left
      { conversion_type: "delivery_challan", status: "cancelled" },
    ];
    expect(canCancelSalesOrder(so, [], convs).allowed).toBe(false);
  });

  it("C23 delivery_challan issued blocks, cancelled allows", () => {
    const so: any = { id: "so-cancel-1", status: "partial" };
    expect(canCancelSalesOrder(so, [], [{ conversion_type: "delivery_challan", status: "issued" }] as any).allowed).toBe(false);
    expect(canCancelSalesOrder(so, [], [{ conversion_type: "delivery_challan", status: "cancelled" }] as any).allowed).toBe(true);
  });

  it("C24 draft with no conversions -> canCancel allowed, cancelled SO not re-cancellable", () => {
    const draft: any = { id: "so-cancel-1", status: "draft" };
    const cancelled: any = { id: "so-cancel-1", status: "cancelled" };
    expect(canCancelSalesOrder(draft, [], []).allowed).toBe(true);
    expect(canCancelSalesOrder(cancelled, [], []).allowed).toBe(false);
  });
});
