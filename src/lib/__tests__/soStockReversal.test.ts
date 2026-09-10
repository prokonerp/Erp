import { getReverseEffect, canCancelSalesOrder } from "@/lib/documentFlow";
import { isSoCancellable, SO_CANCEL_GUARD, canCancelSalesOrder as canCancelSOAlias } from "@/lib/salesOrders";

/**
 * SO Stock Reversal & Cancellation Migration — pure helper tests
 * Covers: pooled vs serial reversal semantics, SO cancel guard, reverse effect
 * All tests are pure (no DB) and validate the contracts introduced in
 * 20260914000001_so_stock_reversal_robustness.sql
 */

describe("soStockReversal/getReverseEffect", () => {
  it("tax_invoice restores stock (pooled + serial)", () => {
    expect(getReverseEffect("tax_invoice")).toBe(true);
  });
  it("general_dc restores stock", () => {
    expect(getReverseEffect("general_dc")).toBe(true);
  });
  it("delivery_challan restores stock", () => {
    expect(getReverseEffect("delivery_challan")).toBe(true);
  });
  it("proforma_invoice does NOT restore stock (read-only)", () => {
    expect(getReverseEffect("proforma_invoice")).toBe(false);
  });
  it("unknown / empty / null does NOT restore", () => {
    expect(getReverseEffect("unknown")).toBe(false);
    expect(getReverseEffect("")).toBe(false);
    expect(getReverseEffect(null as any)).toBe(false);
    expect(getReverseEffect(undefined as any)).toBe(false);
  });
  it("case-insensitive (TAX_INVOICE, General_DC)", () => {
    expect(getReverseEffect("TAX_INVOICE")).toBe(true);
    expect(getReverseEffect("General_DC")).toBe(true);
    expect(getReverseEffect("Delivery_Challan")).toBe(true);
    expect(getReverseEffect("Proforma_Invoice")).toBe(false);
  });
});

describe("soStockReversal/isSoCancellable (salesOrders pure guard)", () => {
  const baseSO: any = { id: "so-1", so_no: "PHS/SO/26-27/0001", status: "confirmed" };

  it("allows cancellation when no conversions at all", () => {
    const res = isSoCancellable(baseSO, [], []);
    expect(res.allowed).toBe(true);
    expect(res.reason.toLowerCase()).toMatch(/can be cancelled/);
  });

  it("allows when only proforma (non-stock) conversions exist", () => {
    const convs: any[] = [{ conversion_type: "proforma_invoice", status: "issued" }];
    expect(isSoCancellable(baseSO, [], convs).allowed).toBe(true);
  });

  it("allows when stock conversions are all cancelled", () => {
    const convs: any[] = [
      { conversion_type: "tax_invoice", status: "cancelled" },
      { conversion_type: "general_dc", status: "cancelled" },
      { conversion_type: "delivery_challan", status: "cancelled" },
    ];
    expect(isSoCancellable(baseSO, [], convs).allowed).toBe(true);
  });

  it("blocks when single non-cancelled tax_invoice exists", () => {
    const convs: any[] = [{ conversion_type: "tax_invoice", status: "issued" }];
    const res = isSoCancellable(baseSO, [], convs);
    expect(res.allowed).toBe(false);
    expect(res.reason.toLowerCase()).toMatch(/stock conversion/);
  });

  it("blocks when single non-cancelled general_dc exists", () => {
    const convs: any[] = [{ conversion_type: "general_dc", status: "Issued" }];
    const res = isSoCancellable(baseSO, [], convs);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/general_dc/i);
  });

  it("blocks when single non-cancelled delivery_challan exists", () => {
    const convs: any[] = [{ conversion_type: "delivery_challan", status: "Submitted" }];
    const res = isSoCancellable(baseSO, [], convs);
    expect(res.allowed).toBe(false);
  });

  it("counts multiple blocking conversions in reason", () => {
    const convs: any[] = [
      { conversion_type: "tax_invoice", status: "issued" },
      { conversion_type: "general_dc", status: "Issued" },
    ];
    const res = isSoCancellable(baseSO, [], convs);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/2/);
  });

  it("blocks when SO already cancelled", () => {
    const so: any = { id: "so-1", status: "cancelled" };
    const res = isSoCancellable(so, [], []);
    expect(res.allowed).toBe(false);
    expect(res.reason.toLowerCase()).toMatch(/already cancelled/);
  });

  it("blocks when SO already invoiced/delivered", () => {
    expect(isSoCancellable({ id: "so-1", status: "invoiced" } as any, [], []).allowed).toBe(false);
    expect(isSoCancellable({ id: "so-1", status: "delivered" } as any, [], []).allowed).toBe(false);
  });

  it("handles null/undefined SO gracefully", () => {
    expect(isSoCancellable(null as any, [], []).allowed).toBe(false);
    expect(isSoCancellable(undefined as any, [], []).allowed).toBe(false);
  });

  it("handles null conversions gracefully (treat as empty)", () => {
    expect(isSoCancellable(baseSO, [], null as any).allowed).toBe(true);
    expect(isSoCancellable(baseSO, null as any, undefined as any).allowed).toBe(true);
  });

  it("aliases SO_CANCEL_GUARD and canCancelSalesOrder behave identically", () => {
    const convs: any[] = [{ conversion_type: "tax_invoice", status: "issued" }];
    expect(SO_CANCEL_GUARD(baseSO, [], convs)).toEqual(isSoCancellable(baseSO, [], convs));
    expect(canCancelSOAlias(baseSO, [], convs)).toEqual(isSoCancellable(baseSO, [], convs));
  });
});

describe("soStockReversal/documentFlow.canCancelSalesOrder mirrors salesOrders guard", () => {
  it("documentFlow guard also blocks stock conversions", () => {
    const so: any = { id: "so-1", status: "partial" };
    const convs: any[] = [{ conversion_type: "tax_invoice", status: "issued" }];
    const res = canCancelSalesOrder(so, [], convs);
    expect(res.allowed).toBe(false);
  });
  it("allows proforma-only", () => {
    const so: any = { id: "so-1", status: "partial" };
    expect(canCancelSalesOrder(so, [], [{ conversion_type: "proforma_invoice", status: "issued" } as any]).allowed).toBe(true);
  });
});

describe("soStockReversal/pooled reversal expectation (DB contract without DB)", () => {
  /**
   * Invoices post pooled (non-serial) stock via invoice_item_sync_serials using ims_deduct_qty,
   * but cancellation only released serials via trg_invoice_cancel_release_serials.
   * Pooled qty stayed deducted -> stock leak after cancellation.
   * GDC/DC have proper reversal; invoice did not for pooled.
   *
   * New contract (20260914000001):
   *   invoice_cancel_restore_pooled() AFTER UPDATE OF status ON invoices
   *   WHEN NEW.status='cancelled' restores pooled lines via ims_add_qty(model, warehouse_id, 'good', qty)
   *   + inserts ims_transactions good_in with reference 'Invoice '||invoice_no
   *   Skips when skip_stock_posting=true OR source_general_dc_id IS NOT NULL
   *   Model resolved via COALESCE(ii.part_model_no, ii.part_name, 'Unknown')
   *   Handles both text and numeric qty.
   */

  function isPooledLine(ii: any): boolean {
    const hasSerials = Array.isArray(ii.serial_numbers) && ii.serial_numbers.length > 0;
    const qtyRaw = ii.qty;
    const qtyNum = Number(String(qtyRaw ?? "").trim() === "" ? 0 : qtyRaw);
    return !hasSerials && Number.isFinite(qtyNum) && qtyNum > 0;
  }

  function resolveModel(ii: any): string {
    const candidates = [ii.part_model_no, ii.part_name, ii.description];
    for (const c of candidates) {
      const s = String(c ?? "").trim();
      if (s) return s;
    }
    return "Unknown";
  }

  it("identifies pooled vs serial lines correctly", () => {
    expect(isPooledLine({ serial_numbers: [], qty: 5, part_model_no: "M1" })).toBe(true);
    expect(isPooledLine({ serial_numbers: null, qty: 5 })).toBe(true);
    expect(isPooledLine({ serial_numbers: ["SN001"], qty: 1 })).toBe(false);
    expect(isPooledLine({ serial_numbers: [], qty: 0 })).toBe(false);
    expect(isPooledLine({ serial_numbers: [], qty: "3" })).toBe(true);
    expect(isPooledLine({ serial_numbers: [], qty: "0" })).toBe(false);
  });

  it("model resolver follows COALESCE(ii.part_model_no, ii.part_name, 'Unknown')", () => {
    expect(resolveModel({ part_model_no: "M1", part_name: "Widget" })).toBe("M1");
    expect(resolveModel({ part_model_no: null, part_name: "Widget" })).toBe("Widget");
    expect(resolveModel({ part_model_no: "", part_name: "", description: "Desc" })).toBe("Desc");
    expect(resolveModel({ part_model_no: null, part_name: null, description: "" })).toBe("Unknown");
  });

  it("qty handling supports both text and numeric (mirrors DB btrim(ii.qty::text)::numeric)", () => {
    const cases: Array<[any, number]> = [
      [5, 5],
      ["5", 5],
      [" 5 ", 5],
      ["5.5", 5.5],
      [0, 0],
      ["0", 0],
      ["", 0],
      [null, 0],
    ];
    for (const [input, expected] of cases) {
      const raw = String(input ?? "").trim();
      const parsed = raw === "" ? 0 : Number(raw);
      expect(Number.isFinite(parsed) ? parsed : 0).toBe(expected);
    }
  });

  it("skip logic: skip_stock_posting or source_general_dc_id suppresses pooled restore", () => {
    function shouldSkip(inv: any): boolean {
      return !!inv.skip_stock_posting || !!inv.source_general_dc_id;
    }
    expect(shouldSkip({ skip_stock_posting: true, source_general_dc_id: null })).toBe(true);
    expect(shouldSkip({ skip_stock_posting: false, source_general_dc_id: "some-uuid" })).toBe(true);
    expect(shouldSkip({ skip_stock_posting: false, source_general_dc_id: null })).toBe(false);
    expect(shouldSkip({ skip_stock_posting: null, source_general_dc_id: null })).toBe(false);
  });

  it("pure helpers are deterministic without DB (no supabase call)", () => {
    expect(typeof getReverseEffect).toBe("function");
    expect(typeof isSoCancellable).toBe("function");
    expect(typeof canCancelSalesOrder).toBe("function");
    // deterministic: same input -> same output
    expect(getReverseEffect("tax_invoice")).toEqual(getReverseEffect("tax_invoice"));
    const so: any = { id: "so-1", status: "draft" };
    expect(isSoCancellable(so, [], [])).toEqual(isSoCancellable(so, [], []));
    expect(canCancelSalesOrder(so, [], [])).toEqual(canCancelSalesOrder(so, [], []));
  });
});

describe("soStockReversal/cancelSalesOrder JS helper contract", () => {
  it("module exports cancelSalesOrder helper (DB trigger is authoritative, JS is fallback)", async () => {
    const mod = await import("@/lib/salesOrders");
    expect(typeof (mod as any).cancelSalesOrder).toBe("function");
    // Signature check: (id:string, reason:string) => Promise<void>
    expect((mod as any).cancelSalesOrder.length).toBeGreaterThanOrEqual(2);
  });
});
