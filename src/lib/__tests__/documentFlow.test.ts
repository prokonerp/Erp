import {
  quoteToSalesOrder,
  salesOrderToDeliveryChallan,
  salesOrderToInvoice,
  deliveryChallanToInvoice,
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
  it("converts a goods DC into an invoice, defaulting GST to 18% and rate to 0", () => {
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
    expect(inv.items[0].gst_rate).toBe(18);
    expect(inv.items[0].rate).toBe(0);
  });
});
