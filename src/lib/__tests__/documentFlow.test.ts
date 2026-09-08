import {
  quoteToSalesOrder,
  salesOrderToDeliveryChallan,
  salesOrderToInvoice,
  deliveryChallanToInvoice,
  buildFulfillmentPreview,
  validateThisQty,
  salesOrderToInvoicePartial,
  salesOrderToProformaPartial,
  salesOrderToGeneralDcPartial,
  salesOrderToDeliveryChallanPartial,
  orderedVsFulfilled,
  isSoFullyDelivered,
} from "@/lib/documentFlow";

describe("documentFlow/quoteToSalesOrder", () => {
  it("maps quote items and links the originating quote", () => {
    const quote: any = {
      id: "q1",
      items: [
        {
          product_id: "p1",
          product_name: "Widget",
          description: "Widget desc",
          hsn: "8471",
          qty: "2",
          unit: "Nos",
          rate: "500",
          discount_percent: "5",
          tax_percent: "18",
        },
      ],
      expiry_date: "2026-12-31",
      branch_id: "b1",
      customer_id: "c1",
      place_of_supply: "Karnataka",
    };
    const so = quoteToSalesOrder(quote);
    expect(so.linked_quote_id).toBe("q1");
    expect(so.status).toBe("draft");
    expect(so.items).toHaveLength(1);
    expect(so.items[0].qty).toBe(2);
    expect(so.items[0].rate).toBe(500);
    expect(so.items[0].discount_pct).toBe(5);
    expect(so.items[0].gst_rate).toBe(18);
    expect(so.items[0].description).toBe("Widget desc");
  });
});

describe("documentFlow/salesOrderToDeliveryChallan", () => {
  it("creates a customer DC linked to the SO with mapped items", () => {
    const so: any = {
      id: "so1",
      so_no: "SO-1",
      buyer_name: "Acme",
      buyer_gstin: "29XXXXXXXXXX1Z5",
      contact_person: "John",
      contact_mobile: "9999999999",
      contact_email: "a@b.c",
      shipping_address: "addr",
      notes: "note",
      linked_quote_id: "q1",
      items: [{ description: "Widget", qty: 3, unit: "Nos" }],
    };
    const dc = salesOrderToDeliveryChallan(so);
    expect(dc.doc_type).toBe("customer");
    expect(dc.status).toBe("Draft");
    expect(dc.party_name).toBe("Acme");
    expect(dc.sales_order_id).toBe("so1");
    expect(dc.items).toHaveLength(1);
    expect(dc.items[0].qty).toBe("3");
    expect(dc.items[0].uom).toBe("Nos");
  });
});

describe("documentFlow/salesOrderToInvoice", () => {
  it("creates an invoice carrying SO id and items", () => {
    const so: any = {
      id: "so1",
      buyer_name: "Acme",
      customer_id: "c1",
      branch_id: "b1",
      billing_address: "ba",
      shipping_address: "sa",
      place_of_supply: "KA",
      buyer_gstin: "29",
      buyer_state: "Karnataka",
      buyer_state_code: "29",
      po_number: "PO1",
      po_date: "2026-01-01",
      notes: "n",
      terms: "t",
      payment_terms: "pt",
      linked_quote_id: "q1",
      items: [{ description: "x" }],
    };
    const inv = salesOrderToInvoice(so);
    expect(inv.sales_order_id).toBe("so1");
    expect(inv.buyer_name).toBe("Acme");
    expect(inv.linked_quote_id).toBe("q1");
    expect(inv.items).toBe(so.items);
  });
});

describe("documentFlow/deliveryChallanToInvoice", () => {
  it("converts a goods DC into an invoice, defaulting GST to 0% (not 18%) and rate to 0", () => {
    const dc: any = {
      id: "dc1",
      items: [{ description: "Widget", qty: "2", uom: "Nos", part_name: "W" }],
      delivery_address: "da",
      party_name: "Acme",
      gstin: "29",
      customer_po_no: "PO1",
      internal_remarks: "r",
    };
    const inv = deliveryChallanToInvoice(dc, {
      sales_order_id: "so1",
      linked_quote_id: "q1",
    });
    expect(inv.linked_dc_ids).toEqual(["dc1"]);
    expect(inv.buyer_name).toBe("Acme");
    expect(inv.sales_order_id).toBe("so1");
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].gst_rate).toBe(0);
    expect(inv.items[0].rate).toBe(0);
  });
});

// ── New split-delivery helpers ────────────────────────────────────────────

describe("documentFlow/buildFulfillmentPreview", () => {
  it("ordered 20, fulfilled 0 → balance 20, this_qty defaults to balance", () => {
    const so: any = {
      id: "so1",
      items: [{ product_id: "p1", description: "Item A", qty: 20, unit: "Nos", rate: 500, warehouse_id: "w1" }],
    };
    const summary: any[] = [
      { sales_order_id: "so1", line_index: 0, product_id: "p1", ordered_qty: 20, fulfilled_stock: 0, fulfilled_proforma: 0, balance: 20, is_complete: false },
    ];
    const preview = buildFulfillmentPreview(so, summary);
    expect(preview).toHaveLength(1);
    expect(preview[0].ordered_qty).toBe(20);
    expect(preview[0].fulfilled_before).toBe(0);
    expect(preview[0].balance).toBe(20);
    expect(preview[0].this_qty).toBe(20);
  });

  it("ordered 20 fulfilled 17 → balance 3, this_qty 3", () => {
    const so: any = {
      id: "so1",
      items: [{ product_id: "p1", description: "Item A", qty: 20, unit: "Nos", rate: 500, warehouse_id: "w1" }],
    };
    const summary: any[] = [
      { sales_order_id: "so1", line_index: 0, product_id: "p1", ordered_qty: 20, fulfilled_stock: 17, fulfilled_proforma: 0, balance: 3, is_complete: false },
    ];
    const preview = buildFulfillmentPreview(so, summary);
    expect(preview[0].fulfilled_before).toBe(17);
    expect(preview[0].balance).toBe(3);
    expect(preview[0].this_qty).toBe(3);
  });

  it("multiple lines mixed: one fully delivered, one partially, one untouched", () => {
    const so: any = {
      id: "so1",
      items: [
        { product_id: "p1", description: "A", qty: 10, unit: "Nos", rate: 100, warehouse_id: "w1" },
        { product_id: "p2", description: "B", qty: 5, unit: "Nos", rate: 200, warehouse_id: "w1" },
        { product_id: "p3", description: "C", qty: 8, unit: "Nos", rate: 50, warehouse_id: "w2" },
      ],
    };
    const summary: any[] = [
      { sales_order_id: "so1", line_index: 0, product_id: "p1", ordered_qty: 10, fulfilled_stock: 10, fulfilled_proforma: 0, balance: 0, is_complete: true },
      { sales_order_id: "so1", line_index: 1, product_id: "p2", ordered_qty: 5, fulfilled_stock: 2, fulfilled_proforma: 0, balance: 3, is_complete: false },
      // line 2 has no summary entry → balance should default to ordered qty (8)
    ];
    const preview = buildFulfillmentPreview(so, summary);
    expect(preview).toHaveLength(3);
    expect(preview[0].balance).toBe(0);
    expect(preview[0].this_qty).toBe(0);
    expect(preview[0].fulfilled_before).toBe(10);
    expect(preview[1].balance).toBe(3);
    expect(preview[1].this_qty).toBe(3);
    expect(preview[2].balance).toBe(8);
    expect(preview[2].this_qty).toBe(8);
  });
});

describe("documentFlow/validateThisQty", () => {
  it("valid when this_qty <= balance", () => {
    const lines: any[] = [
      { line_index: 0, product_id: null, ordered_qty: 20, fulfilled_before: 17, balance: 3, this_qty: 2 },
      { line_index: 1, product_id: null, ordered_qty: 10, fulfilled_before: 0, balance: 10, this_qty: 5 },
    ];
    expect(validateThisQty(lines)).toBeNull();
  });

  it("invalid when this_qty > balance", () => {
    const lines: any[] = [
      { line_index: 0, product_id: null, ordered_qty: 20, fulfilled_before: 17, balance: 3, this_qty: 5 },
    ];
    const err = validateThisQty(lines);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/exceeds|balance/);
  });

  it("invalid when all zero (no line selected)", () => {
    const lines: any[] = [
      { line_index: 0, product_id: null, ordered_qty: 20, fulfilled_before: 0, balance: 20, this_qty: 0 },
      { line_index: 1, product_id: null, ordered_qty: 10, fulfilled_before: 0, balance: 10, this_qty: 0 },
    ];
    const err = validateThisQty(lines);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/at least one|greater than 0/);
  });

  it("serial mismatch invalid when is_serialized and serial count != qty", () => {
    const lines: any[] = [
      {
        line_index: 0,
        product_id: "p1",
        ordered_qty: 2,
        fulfilled_before: 0,
        balance: 2,
        this_qty: 2,
        is_serialized: true,
        serial_numbers: ["SN001"], // only 1, need 2
        warehouse_id: "w1",
      },
    ];
    const err = validateThisQty(lines);
    expect(err).not.toBeNull();
    expect(err!.toLowerCase()).toMatch(/serial/);
  });
});

describe("documentFlow/salesOrderToInvoicePartial", () => {
  it("slices qty correctly (20 → 17)", () => {
    const so: any = {
      id: "so1",
      branch_id: "b1",
      customer_id: "c1",
      billing_address: "ba",
      shipping_address: "sa",
      place_of_supply: "KA",
      buyer_name: "Acme",
      buyer_gstin: "29",
      buyer_state: "Karnataka",
      buyer_state_code: "29",
      po_number: "PO1",
      po_date: "2026-01-01",
      notes: "n",
      terms: "t",
      payment_terms: "pt",
      linked_quote_id: "q1",
      shipping_charges: 100,
      adjustment: 10,
      tcs_percent: 1,
      tcs_amount: 5,
      round_off: 0,
      discount_label: "D",
      items: [
        {
          product_id: "p1",
          description: "Widget",
          hsn: "8471",
          qty: 20,
          unit: "Nos",
          rate: 500,
          discount_pct: 0,
          gst_rate: 18,
          cess_rate: 0,
          warehouse_id: "w1",
          serial_numbers: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13", "S14", "S15", "S16", "S17", "S18", "S19", "S20"],
          is_serialized: false,
          part_model_no: "M1",
          part_name: "Widget",
        },
      ],
    };
    const lines: any[] = [
      { line_index: 0, product_id: "p1", ordered_qty: 20, fulfilled_before: 0, balance: 20, this_qty: 17, warehouse_id: "w1", serial_numbers: [], is_serialized: false },
    ];
    const payload = salesOrderToInvoicePartial(so, lines);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].qty).toBe(17);
  });

  it("preserves header fields (shipping_charges, adjustment, tcs, etc)", () => {
    const so: any = {
      id: "so1",
      branch_id: "b1",
      customer_id: "c1",
      billing_address: "ba",
      shipping_address: "sa",
      place_of_supply: "KA",
      buyer_name: "Acme",
      buyer_gstin: "29",
      buyer_state: "Karnataka",
      buyer_state_code: "29",
      po_number: "PO1",
      po_date: "2026-01-01",
      notes: "note1",
      terms: "term1",
      payment_terms: "30 days",
      linked_quote_id: "q1",
      shipping_charges: 250,
      adjustment: -50,
      tcs_percent: 2,
      tcs_amount: 20,
      round_off: 0.5,
      discount_label: "Seasonal",
      items: [{ product_id: "p1", description: "Widget", qty: 10, unit: "Nos", rate: 100, discount_pct: 0, gst_rate: 18, warehouse_id: "w1" }],
    };
    const lines: any[] = [{ line_index: 0, product_id: "p1", ordered_qty: 10, fulfilled_before: 0, balance: 10, this_qty: 5, warehouse_id: "w1" }];
    const payload = salesOrderToInvoicePartial(so, lines);
    expect(payload.shipping_charges).toBe(250);
    expect(payload.adjustment).toBe(-50);
    expect(payload.tcs_percent).toBe(2);
    expect(payload.tcs_amount).toBe(20);
    expect(payload.discount_label).toBe("Seasonal");
    expect(payload.notes).toBe("note1");
    expect(payload.terms).toBe("term1");
    expect(payload.payment_terms).toBe("30 days");
    expect(payload.po_number).toBe("PO1");
    expect(payload.sales_order_id).toBe("so1");
  });

  it("filters zero qty lines (only this_qty>0 included)", () => {
    const so: any = {
      id: "so1",
      branch_id: "b1",
      customer_id: "c1",
      billing_address: "ba",
      shipping_address: "sa",
      place_of_supply: "KA",
      buyer_name: "Acme",
      buyer_gstin: "29",
      items: [
        { product_id: "p1", description: "A", qty: 10, unit: "Nos", rate: 100, warehouse_id: "w1" },
        { product_id: "p2", description: "B", qty: 5, unit: "Nos", rate: 200, warehouse_id: "w1" },
        { product_id: "p3", description: "C", qty: 8, unit: "Nos", rate: 50, warehouse_id: "w1" },
      ],
    };
    const lines: any[] = [
      { line_index: 0, product_id: "p1", ordered_qty: 10, fulfilled_before: 0, balance: 10, this_qty: 0, warehouse_id: "w1" },
      { line_index: 1, product_id: "p2", ordered_qty: 5, fulfilled_before: 0, balance: 5, this_qty: 3, warehouse_id: "w1" },
      { line_index: 2, product_id: "p3", ordered_qty: 8, fulfilled_before: 0, balance: 8, this_qty: 0, warehouse_id: "w1" },
    ];
    const payload = salesOrderToInvoicePartial(so, lines);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].description).toBe("B");
    expect(payload.items[0].qty).toBe(3);
  });
});

describe("documentFlow/salesOrderToProformaPartial", () => {
  it("creates proforma payload with skip_stock_posting implied and qty sliced", () => {
    const so: any = {
      id: "so1",
      branch_id: "b1",
      customer_id: "c1",
      billing_address: "ba",
      shipping_address: "sa",
      place_of_supply: "KA",
      buyer_name: "Acme",
      buyer_gstin: "29",
      buyer_state: "KA",
      buyer_state_code: "29",
      po_number: "PO1",
      po_date: "2026-01-01",
      notes: "n",
      terms: "t",
      payment_terms: "pt",
      linked_quote_id: "q1",
      items: [
        { product_id: "p1", description: "Widget", hsn: "8471", qty: 20, unit: "Nos", rate: 500, discount_pct: 0, gst_rate: 18, warehouse_id: "w1", serial_numbers: [], is_serialized: false },
      ],
    };
    const lines: any[] = [{ line_index: 0, product_id: "p1", ordered_qty: 20, fulfilled_before: 0, balance: 20, this_qty: 10, warehouse_id: "w1" }];
    const payload = salesOrderToProformaPartial(so, lines);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].qty).toBe(10);
    expect(payload.skip_stock_posting).toBe(true);
    expect(payload.sales_order_id).toBe("so1");
    expect(payload.prior_fulfilled).toEqual([{ line_index: 0, fulfilled_before: 0 }]);
    expect(payload.this_fulfilled).toEqual([{ line_index: 0, this_qty: 10 }]);
    expect(payload.status).toBe("draft");
  });
});

describe("documentFlow/salesOrderToGeneralDcPartial", () => {
  it("maps SO items to GDC items with qty sliced", () => {
    const so: any = {
      id: "so1",
      branch_id: "b1",
      customer_id: "c1",
      buyer_name: "Acme",
      billing_address: "ba",
      shipping_address: "sa",
      notes: "n",
      terms: "t",
      items: [
        { product_id: "p1", description: "Widget", hsn: "8471", qty: 20, unit: "Nos", rate: 100, warehouse_id: "w1", serial_numbers: [], is_serialized: false, part_model_no: "M1", part_name: "Widget" },
      ],
    };
    const lines: any[] = [{ line_index: 0, product_id: "p1", ordered_qty: 20, fulfilled_before: 0, balance: 20, this_qty: 7, warehouse_id: "w1" }];
    const payload = salesOrderToGeneralDcPartial(so, lines);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].qty).toBe(7);
    expect(payload.items[0].unit_price).toBe(100);
    expect(payload.items[0].warehouse_id).toBe("w1");
    expect(payload.sales_order_id).toBe("so1");
  });

  it("filters zero qty lines and preserves header", () => {
    const so: any = {
      id: "so1",
      branch_id: "b1",
      customer_id: "c1",
      buyer_name: "Acme",
      billing_address: "ba",
      shipping_address: "sa",
      notes: "purpose note",
      terms: "t1",
      items: [
        { product_id: "p1", description: "A", qty: 10, unit: "Nos", rate: 100, warehouse_id: "w1", part_model_no: "M1" },
        { product_id: "p2", description: "B", qty: 5, unit: "Nos", rate: 200, warehouse_id: "w1", part_model_no: "M2" },
      ],
    };
    const lines: any[] = [
      { line_index: 0, product_id: "p1", ordered_qty: 10, fulfilled_before: 0, balance: 10, this_qty: 0, warehouse_id: "w1" },
      { line_index: 1, product_id: "p2", ordered_qty: 5, fulfilled_before: 0, balance: 5, this_qty: 5, warehouse_id: "w1" },
    ];
    const payload = salesOrderToGeneralDcPartial(so, lines);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].part_name).toBe("B");
    expect(payload.branch_id).toBe("b1");
    expect(payload.customer_id).toBe("c1");
  });
});

describe("documentFlow/salesOrderToDeliveryChallanPartial", () => {
  it("slices qty and serials for DC partial", () => {
    const so: any = {
      id: "so1",
      so_no: "SO-1",
      buyer_name: "Acme",
      buyer_gstin: "29",
      shipping_address: "addr",
      notes: "n",
      linked_quote_id: "q1",
      branch_id: "b1",
      buyer_state: "Karnataka",
      buyer_state_code: "29",
      items: [
        { description: "Widget", qty: 20, unit: "Nos", rate: 100, warehouse_id: "w1", serial_numbers: ["S1", "S2", "S3"], is_serialized: false, product_id: "p1", hsn: "8471", part_model_no: "M1" },
      ],
    };
    const lines: any[] = [{ line_index: 0, product_id: "p1", ordered_qty: 20, fulfilled_before: 0, balance: 20, this_qty: 5, warehouse_id: "w1", serial_numbers: ["S1", "S2", "S3", "S4", "S5"] }];
    const dc = salesOrderToDeliveryChallanPartial(so, lines);
    expect(dc.items).toHaveLength(1);
    expect(dc.items[0].qty).toBe("5");
    expect(dc.sales_order_id).toBe("so1");
  });

  it("filters zero qty lines and preserves party info", () => {
    const so: any = {
      id: "so1",
      so_no: "SO-1",
      buyer_name: "Acme",
      buyer_gstin: "29",
      shipping_address: "addr",
      notes: "n",
      linked_quote_id: "q1",
      branch_id: "b1",
      buyer_state: "KA",
      buyer_state_code: "29",
      items: [
        { description: "A", qty: 10, unit: "Nos", warehouse_id: "w1", product_id: "p1" },
        { description: "B", qty: 5, unit: "Nos", warehouse_id: "w1", product_id: "p2" },
      ],
    };
    const lines: any[] = [
      { line_index: 0, product_id: "p1", ordered_qty: 10, fulfilled_before: 0, balance: 10, this_qty: 0, warehouse_id: "w1" },
      { line_index: 1, product_id: "p2", ordered_qty: 5, fulfilled_before: 0, balance: 5, this_qty: 2, warehouse_id: "w1" },
    ];
    const dc = salesOrderToDeliveryChallanPartial(so, lines);
    expect(dc.items).toHaveLength(1);
    expect(dc.items[0].description).toBe("B");
    expect(dc.party_name).toBe("Acme");
  });
});

describe("documentFlow/orderedVsFulfilled + isSoFullyDelivered", () => {
  it("orderedVsFulfilled sums correctly falling back to SO items when summary empty", () => {
    const so: any = { id: "so1", items: [{ qty: 10 }, { qty: 5 }] };
    const result = orderedVsFulfilled(so, []);
    expect(result.ordered).toBe(15);
    expect(result.fulfilled).toBe(0);
  });

  it("isSoFullyDelivered true when all balances 0", () => {
    const summary: any[] = [
      { sales_order_id: "so1", line_index: 0, ordered_qty: 10, fulfilled_stock: 10, balance: 0, is_complete: true },
      { sales_order_id: "so1", line_index: 1, ordered_qty: 5, fulfilled_stock: 5, balance: 0, is_complete: true },
    ];
    expect(isSoFullyDelivered(summary)).toBe(true);
  });

  it("isSoFullyDelivered false when any balance >0", () => {
    const summary: any[] = [
      { sales_order_id: "so1", line_index: 0, ordered_qty: 10, fulfilled_stock: 7, balance: 3, is_complete: false },
    ];
    expect(isSoFullyDelivered(summary)).toBe(false);
  });
});
