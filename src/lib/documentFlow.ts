// Pure conversion engine for the sales document flow:
//   Quotation → Sales Order → Delivery Challan → Invoice
//
// No Supabase calls, no React. Callers pass the source row(s) and receive a
// well-shaped payload ready for insertion. This keeps snapshots deterministic
// and lets the same helpers be reused from any surface.

import type { Quotation, QuoteItem } from "@/lib/crm";
import type { SalesOrder, SoItem } from "@/lib/salesOrders";
import type { DeliveryChallan, ChallanItem } from "@/lib/challan";

// -------- Quotation → Sales Order --------

function quoteItemToSoItem(qi: QuoteItem): SoItem {
  return {
    product_id: qi.product_id ?? null,
    description: qi.description || qi.product_name || "",
    hsn: qi.hsn ?? null,
    qty: Number(qi.qty) || 0,
    unit: qi.unit ?? "Nos",
    rate: Number(qi.rate) || 0,
    discount_pct: Number(qi.discount_percent) || 0,
    gst_rate: Number(qi.tax_percent) || 0,
  };
}

export type NewSalesOrder = Omit<
  SalesOrder,
  "id" | "so_no" | "created_at" | "updated_at" | "created_by"
>;

export function quoteToSalesOrder(q: Quotation): NewSalesOrder {
  const items = (q.items || []).map(quoteItemToSoItem);
  return {
    so_date: new Date().toISOString().slice(0, 10),
    valid_until: q.expiry_date,
    expected_delivery: null,
    branch_id: q.branch_id,
    customer_id: q.customer_id,
    seller_name: null,
    seller_gstin: null,
    seller_state: null,
    seller_state_code: null,
    seller_address: null,
    buyer_name: null,
    buyer_gstin: null,
    buyer_state: q.place_of_supply,
    buyer_state_code: null,
    billing_address: q.billing_address,
    shipping_address: q.shipping_address,
    place_of_supply: q.place_of_supply,
    place_of_supply_code: null,
    is_interstate: false,
    reverse_charge: false,
    contact_person: q.contact_name,
    contact_email: q.contact_email,
    contact_mobile: q.contact_phone,
    salesperson: q.salesperson,
    payment_terms: q.payment_terms,
    delivery_timeline: q.delivery_timeline,
    po_number: null,
    po_date: null,
    subtotal: Number(q.subtotal) || 0,
    discount: Number(q.discount_amount) || 0,
    taxable_value: 0,
    cgst: Number(q.cgst_amount) || 0,
    sgst: Number(q.sgst_amount) || 0,
    igst: Number(q.igst_amount) || 0,
    cess: 0,
    round_off: Number(q.round_off) || 0,
    total: Number(q.total) || 0,
    total_in_words: null,
    status: "draft",
    notes: q.customer_notes || q.remarks,
    terms: q.terms,
    items,
    linked_quote_id: q.id,
  };
}

// -------- Sales Order → Delivery Challan --------

function soItemToChallanItem(it: SoItem): ChallanItem {
  return {
    part_no: "",
    part_name: it.description || "",
    description: it.description || "",
    uom: it.unit || "Nos",
    qty: String(it.qty ?? ""),
    batch_no: "",
    model_no: "",
    serial_no: "",
  };
}

export type NewDeliveryChallan = Partial<
  Omit<DeliveryChallan, "id" | "challan_no" | "created_at" | "created_by">
> & {
  doc_type: DeliveryChallan["doc_type"];
  items: ChallanItem[];
  sales_order_id?: string;
  quotation_id?: string | null;
};

export function salesOrderToDeliveryChallan(so: SalesOrder): NewDeliveryChallan {
  return {
    doc_type: "customer",
    status: "Draft",
    challan_date: new Date().toISOString().slice(0, 10),
    dispatch_date: null,
    reference_no: so.so_no,
    sales_order_no: so.so_no,
    customer_po_no: so.po_number,
    party_name: so.buyer_name,
    gstin: so.buyer_gstin,
    contact_person: so.contact_person,
    contact_number: so.contact_mobile,
    email: so.contact_email,
    delivery_address: so.shipping_address,
    items: (so.items || []).map(soItemToChallanItem),
    internal_remarks: so.notes,
    sales_order_id: so.id,
    quotation_id: so.linked_quote_id,
  };
}

// -------- Sales Order → Invoice (payload shape used by writers) --------

export type NewInvoicePayload = {
  branch_id: string | null;
  customer_id: string | null;
  invoice_date: string;
  billing_address: string | null;
  shipping_address: string | null;
  place_of_supply: string | null;
  buyer_name: string | null;
  buyer_gstin: string | null;
  buyer_state: string | null;
  buyer_state_code: string | null;
  po_number: string | null;
  po_date: string | null;
  notes: string | null;
  terms: string | null;
  payment_terms: string | null;
  linked_quote_id: string | null;
  linked_dc_ids: string[] | null;
  sales_order_id: string | null;
  items: SoItem[];
};

export function salesOrderToInvoice(so: SalesOrder): NewInvoicePayload {
  return {
    branch_id: so.branch_id,
    customer_id: so.customer_id,
    invoice_date: new Date().toISOString().slice(0, 10),
    billing_address: so.billing_address,
    shipping_address: so.shipping_address,
    place_of_supply: so.place_of_supply,
    buyer_name: so.buyer_name,
    buyer_gstin: so.buyer_gstin,
    buyer_state: so.buyer_state,
    buyer_state_code: so.buyer_state_code,
    po_number: so.po_number,
    po_date: so.po_date,
    notes: so.notes,
    terms: so.terms,
    payment_terms: so.payment_terms,
    linked_quote_id: so.linked_quote_id,
    linked_dc_ids: null,
    sales_order_id: so.id,
    items: so.items || [],
  };
}

export function deliveryChallanToInvoice(
  dc: DeliveryChallan,
  linked: { sales_order_id?: string | null; linked_quote_id?: string | null } = {},
): NewInvoicePayload {
  const items: SoItem[] = (dc.items || []).map((ci) => ({
    product_id: null,
    description: ci.description || ci.part_name || "",
    hsn: null,
    qty: Number(ci.qty) || 0,
    unit: ci.uom || "Nos",
    rate: 0,
    discount_pct: 0,
    gst_rate: 18,
  }));
  return {
    branch_id: null,
    customer_id: null,
    invoice_date: new Date().toISOString().slice(0, 10),
    billing_address: dc.delivery_address,
    shipping_address: dc.delivery_address,
    place_of_supply: null,
    buyer_name: dc.party_name,
    buyer_gstin: dc.gstin,
    buyer_state: null,
    buyer_state_code: null,
    po_number: dc.customer_po_no,
    po_date: null,
    notes: dc.internal_remarks,
    terms: null,
    payment_terms: null,
    linked_quote_id: linked.linked_quote_id ?? null,
    linked_dc_ids: [dc.id],
    sales_order_id: linked.sales_order_id ?? null,
    items,
  };
}