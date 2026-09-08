// Pure conversion engine for the sales document flow:
//   Quotation → Sales Order → Delivery Challan → Invoice
//
// No Supabase calls, no React. Callers pass the source row(s) and receive a
// well-shaped payload ready for insertion. This keeps snapshots deterministic
// and lets the same helpers be reused from any surface.

import type { Quotation, QuoteItem } from "@/lib/crm";
import type { SalesOrder, SoItem } from "@/lib/salesOrders";
import type { DeliveryChallan, ChallanItem } from "@/lib/challan";
import { istTodayIso } from "@/lib/dateRange";

// -------- Quotation → Sales Order --------

function quoteItemToSoItem(qi: QuoteItem): SoItem {
  const anyQi = qi as QuoteItem & {
    cess_rate?: number;
    cess_percent?: number;
    warehouse_id?: string | null;
    serial_numbers?: string[];
    is_serialized?: boolean;
    part_model_no?: string | null;
    part_name?: string | null;
  };
  return {
    product_id: qi.product_id ?? null,
    description: qi.description || qi.product_name || "",
    hsn: qi.hsn ?? null,
    qty: Number(qi.qty) || 0,
    unit: qi.unit || "Nos",
    rate: Number(qi.rate) || 0,
    discount_pct: Number(qi.discount_percent) || 0,
    gst_rate: Number(qi.tax_percent) || 0,
    cess_rate: Number(anyQi.cess_rate ?? anyQi.cess_percent ?? 0) || 0,
    warehouse_id: (anyQi.warehouse_id as string | null) ?? null,
    serial_numbers: Array.isArray(anyQi.serial_numbers) ? anyQi.serial_numbers : [],
    is_serialized: !!anyQi.is_serialized,
    part_model_no: (anyQi.part_model_no as string | null) ?? null,
    part_name: (anyQi.part_name as string | null) ?? null,
  };
}

/**
 * Payload for a new sales order.
 *
 * **Synthetic fields** (not in DDL until migration 20260909000001):
 *   shipping_charges, adjustment, tcs_percent, tcs_amount,
 *   discount_label, discount_amount — these are now persisted
 *   in the sales_orders table. The writer layer must include
 *   them in the INSERT.
 *
 * **Legacy fields** carried through from quotation for writer convenience
 * but overwritten by the GST engine (e.g. subtotal, total, is_interstate).
 */
export type NewSalesOrder = Omit<
  SalesOrder,
  "id" | "so_no" | "created_at" | "updated_at" | "created_by"
> & {
  shipping_charges?: number;
  adjustment?: number;
  tcs_percent?: number;
  tcs_amount?: number;
  discount_label?: string | null;
  discount_amount?: number;
};

/**
 * Pure mapping from Quotation to SalesOrder payload.
 *
 * NOTE: This produces a partial payload — `subtotal/total/cgst/sgst/igst`
 * are copied from the quotation verbatim (two sources of truth). The writer
 * layer (`createSalesOrderFromQuote`) RECOMPUTES everything via
 * `computeTotals` + `hydrateParties`. Do NOT insert this payload directly
 * without the writer.
 */
export function quoteToSalesOrder(q: Quotation): NewSalesOrder {
  const items = (q.items || []).map(quoteItemToSoItem);
  return {
    so_date: istTodayIso(),
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
    // Propagate header-level charges that writers previously dropped (ship/TCS/adjustment/label)
    shipping_charges: Number((q as any).shipping_charges) || 0,
    adjustment: Number((q as any).adjustment) || 0,
    tcs_percent: Number((q as any).tcs_percent) || 0,
    tcs_amount: Number((q as any).tcs_amount) || 0,
    discount_label: (q as any).discount_label ?? null,
    discount_amount: Number((q as any).discount_amount) || 0,
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
    model_no: (it as any).part_model_no || "",
    serial_no:
      Array.isArray((it as any).serial_numbers) && (it as any).serial_numbers.length > 0
        ? String((it as any).serial_numbers[0])
        : "",
    // Preserve financials so DC→Invoice chain does not lose pricing (fixes #1)
    product_id: it.product_id ?? null,
    hsn: it.hsn ?? null,
    rate: Number(it.rate) || 0,
    discount_pct: Number(it.discount_pct) || 0,
    gst_rate: Number(it.gst_rate) || 0,
    cess_rate: Number((it as any).cess_rate) || 0,
    unit_price: String(it.rate ?? ""),
    warehouse_id: (it as any).warehouse_id ?? null,
    serial_numbers: Array.isArray((it as any).serial_numbers) ? (it as any).serial_numbers : [],
    is_serialized: !!(it as any).is_serialized,
    branch_id: (it as any).branch_id ?? null,
  };
}

export type NewDeliveryChallan = Partial<
  Omit<DeliveryChallan, "id" | "challan_no" | "created_at" | "created_by">
> & {
  doc_type: DeliveryChallan["doc_type"];
  items: ChallanItem[];
  sales_order_id?: string;
  quotation_id?: string | null;
  branch_id?: string | null;
  buyer_state?: string | null;
  buyer_state_code?: string | null;
};

export function salesOrderToDeliveryChallan(so: SalesOrder): NewDeliveryChallan {
  const branchId = (so as any).branch_id ?? null;
  const buyerState = (so as any).buyer_state ?? so.place_of_supply ?? null;
  const buyerCode = (so as any).buyer_state_code ?? so.place_of_supply_code ?? null;
  return {
    doc_type: "customer",
    status: "Draft",
    challan_date: istTodayIso(),
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
    city: (so as any).buyer_state ? null : null,
    state: buyerState,
    items: (so.items || []).map((it) => {
      const ci = soItemToChallanItem(it);
      // Ensure per-line header context is retained (branch/buyer) — task #1
      return { ...ci, branch_id: branchId, buyer_state: buyerState, buyer_state_code: buyerCode };
    }),
    internal_remarks: so.notes,
    sales_order_id: so.id,
    quotation_id: so.linked_quote_id,
    branch_id: branchId,
    buyer_state: buyerState,
    buyer_state_code: buyerCode,
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
  reverse_charge?: boolean;
  shipping_charges?: number;
  adjustment?: number;
  tcs_percent?: number;
  tcs_amount?: number;
  round_off?: number;
  discount_label?: string | null;
};

export function salesOrderToInvoice(so: SalesOrder): NewInvoicePayload {
  return {
    branch_id: so.branch_id,
    customer_id: so.customer_id,
    invoice_date: istTodayIso(),
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
    reverse_charge: !!(so as any).reverse_charge,
    shipping_charges: Number((so as any).shipping_charges) || 0,
    adjustment: Number((so as any).adjustment) || 0,
    tcs_percent: Number((so as any).tcs_percent) || 0,
    tcs_amount: Number((so as any).tcs_amount) || 0,
    round_off: Number((so as any).round_off) || 0,
    discount_label: (so as any).discount_label ?? null,
  };
}

export function deliveryChallanToInvoice(
  dc: DeliveryChallan,
  linked: {
    sales_order_id?: string | null;
    linked_quote_id?: string | null;
    branch_id?: string | null;
    customer_id?: string | null;
  } = {},
): NewInvoicePayload {
  const items: SoItem[] = (dc.items || []).map((ci: any) => ({
    product_id: (ci.product_id as string | null) ?? null,
    description: ci.description || ci.part_name || "",
    hsn: (ci.hsn as string | null) ?? null,
    qty: Number(ci.qty) || 0,
    unit: ci.uom || "Nos",
    rate:
      ci.rate != null && ci.rate !== ""
        ? Number(ci.rate)
        : ci.unit_price != null && ci.unit_price !== ""
          ? Number(ci.unit_price)
          : 0,
    discount_pct: ci.discount_pct != null ? Number(ci.discount_pct) : 0,
    gst_rate: ci.gst_rate != null ? Number(ci.gst_rate) : 0,
    cess_rate: ci.cess_rate != null ? Number(ci.cess_rate) : 0,
    warehouse_id: (ci.warehouse_id as string | null) ?? null,
    serial_numbers: Array.isArray(ci.serial_numbers)
      ? ci.serial_numbers
      : ci.serial_no
        ? [String(ci.serial_no)]
        : [],
    is_serialized:
      !!ci.is_serialized || (Array.isArray(ci.serial_numbers) && ci.serial_numbers.length > 0),
    part_model_no: (ci.model_no as string | null) ?? null,
    part_name: (ci.part_name as string | null) ?? null,
  }));
  // Preserve header context from DC item-level branch/buyer when available
  const anyDc = dc as any;
  const firstItemBranch = (dc.items?.[0] as any)?.branch_id ?? null;
  return {
    branch_id: linked.branch_id ?? anyDc.branch_id ?? firstItemBranch ?? null,
    customer_id: (linked as any).customer_id ?? null,
    invoice_date: istTodayIso(),
    billing_address: dc.delivery_address,
    shipping_address: dc.delivery_address,
    place_of_supply: (dc as any).state ?? anyDc.place_of_supply ?? null,
    buyer_name: dc.party_name,
    buyer_gstin: dc.gstin,
    buyer_state: anyDc.state ?? (dc.items?.[0] as any)?.buyer_state ?? null,
    buyer_state_code: anyDc.buyer_state_code ?? (dc.items?.[0] as any)?.buyer_state_code ?? null,
    po_number: dc.customer_po_no,
    po_date: null,
    notes: dc.internal_remarks,
    terms: null,
    payment_terms: null,
    linked_quote_id: linked.linked_quote_id ?? (anyDc.quotation_id as string | null) ?? null,
    linked_dc_ids: [dc.id],
    sales_order_id: linked.sales_order_id ?? (anyDc.sales_order_id as string | null) ?? null,
    items,
    reverse_charge: !!anyDc.reverse_charge,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
//  Split-delivery / partial conversion helpers (pure)
//  Added for SO 20→17+3 flow. All functions are pure and testable.
// ──────────────────────────────────────────────────────────────────────────────

export const SO_PREFILL_KEY = "invoice:prefill:from-so";
export const PROFORMA_PREFILL_KEY = "proforma:prefill:from-so";

export type ConversionType = "tax_invoice" | "general_dc" | "proforma_invoice" | "delivery_challan";

export type SoFulfillmentSummary = {
  sales_order_id: string;
  line_index: number;
  product_id: string | null;
  ordered_qty: number;
  fulfilled_stock: number;
  fulfilled_proforma: number;
  balance: number;
  is_complete: boolean;
};

export type FulfillmentLine = {
  line_index: number;
  product_id: string | null;
  ordered_qty: number;
  fulfilled_before: number;
  balance: number;
  this_qty: number;
  warehouse_id?: string | null;
  serial_numbers?: string[];
  is_serialized?: boolean;
};

/** General DC payload shape for partial conversions */
export type GeneralDcItemForPartial = {
  product_id: string | null;
  part_name: string | null;
  model_no: string | null;
  hsn: string | null;
  uom: string;
  qty: number;
  unit_price: number;
  warehouse_id: string | null;
  is_serialized: boolean;
  serial_numbers: string[];
};

export type NewGeneralDcPayload = {
  dc_date: string;
  returnable: boolean;
  expected_return_date: string | null;
  customer_id: string | null;
  customer_name: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  purpose: string | null;
  branch_id: string | null;
  items: GeneralDcItemForPartial[];
  status: "Draft" | "Issued";
  allow_negative_stock: boolean;
  notes: string | null;
  terms: string | null;
  sales_order_id?: string | null;
  conversion_id?: string | null;
};

/** Proforma payload mirrors NewInvoicePayload but with proforma semantics */
export type NewProformaPayload = {
  branch_id: string | null;
  customer_id: string | null;
  proforma_date: string;
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
  sales_order_id: string | null;
  items: SoItem[];
  reverse_charge?: boolean;
  shipping_charges?: number;
  adjustment?: number;
  tcs_percent?: number;
  tcs_amount?: number;
  round_off?: number;
  discount_label?: string | null;
  discount_amount?: number;
  prior_fulfilled: { line_index: number; fulfilled_before: number }[];
  this_fulfilled: { line_index: number; this_qty: number }[];
  status: "draft" | "issued";
  skip_stock_posting?: true;
};

/**
 * Build a fulfillment preview: one FulfillmentLine per SO item, with
 * already-delivered qty looked up from the view. this_qty defaults to balance
 * (i.e. ship the remainder), clamped 0..balance.
 */
export function buildFulfillmentPreview(
  so: SalesOrder,
  summary: SoFulfillmentSummary[],
): FulfillmentLine[] {
  const items = so.items || [];
  const map = new Map<number, SoFulfillmentSummary>();
  for (const s of summary || []) {
    map.set(Number(s.line_index), s);
  }
  return items.map((it, idx) => {
    const orderedQty = Number((it as any).qty) || 0;
    const s = map.get(idx);
    const fulfilledBefore = s ? Number(s.fulfilled_stock) || 0 : 0;
    const balanceRaw = s ? Number(s.balance) : orderedQty - fulfilledBefore;
    const balance = Math.max(0, Math.min(orderedQty, balanceRaw));
    const thisQty = Math.max(0, Math.min(balance, balance));
    return {
      line_index: idx,
      product_id: (it.product_id as string | null) ?? (s?.product_id ?? null),
      ordered_qty: orderedQty,
      fulfilled_before: fulfilledBefore,
      balance,
      this_qty: thisQty,
      warehouse_id: ((it as any).warehouse_id as string | null) ?? null,
      serial_numbers: Array.isArray((it as any).serial_numbers)
        ? ((it as any).serial_numbers as string[])
        : [],
      is_serialized: !!((it as any).is_serialized),
    };
  });
}

/**
 * Validate this_qty per line.
 *  - at least one line must have this_qty > 0
 *  - each this_qty must be 0 <= this_qty <= balance
 *  - serialized lines: qty must be integer and serial_numbers.length === this_qty
 *  - stock lines (product_id present) with this_qty >0 must have warehouse_id
 * Returns null if valid, otherwise an error string.
 */
export function validateThisQty(lines: FulfillmentLine[]): string | null {
  if (!lines || lines.length === 0) return "No lines to validate";
  let hasPositive = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const qty = Number(line.this_qty) || 0;
    const balance = Number(line.balance) || 0;
    if (qty > 0) hasPositive = true;
    if (qty < 0) return `Line ${i + 1}: quantity cannot be negative`;
    if (qty > balance) return `Line ${i + 1}: quantity ${qty} exceeds balance ${balance}`;
    if (line.is_serialized) {
      const expected = Math.floor(qty);
      if (qty !== expected) {
        return `Line ${i + 1}: serialized products need a whole-number quantity (got ${qty})`;
      }
      const actual = (line.serial_numbers || []).length;
      // Only enforce serial count when qty >0 or when serials are present
      if (qty > 0 && actual !== expected) {
        return `Line ${i + 1}: select ${expected} serial number(s) (got ${actual})`;
      }
      if (qty === 0 && actual !== 0) {
        return `Line ${i + 1}: select ${expected} serial number(s) (got ${actual})`;
      }
    }
    if (qty > 0 && line.product_id != null && !line.warehouse_id) {
      return `Line ${i + 1}: warehouse required`;
    }
  }
  if (!hasPositive) return "Select at least one line with quantity greater than 0";
  return null;
}

function fulfillmentMap(lines: FulfillmentLine[]): Map<number, FulfillmentLine> {
  return new Map(lines.map((l) => [l.line_index, l]));
}

/**
 * Sales Order → Invoice (partial). Clones header like salesOrderToInvoice
 * but slices items to only lines where this_qty>0, replacing qty with
 * this_qty and slicing serial_numbers accordingly.
 */
export function salesOrderToInvoicePartial(
  so: SalesOrder,
  lines: FulfillmentLine[],
): NewInvoicePayload {
  const base = salesOrderToInvoice(so);
  const map = fulfillmentMap(lines);
  const newItems: SoItem[] = [];
  const allItems = so.items || [];
  for (let i = 0; i < allItems.length; i++) {
    const fl = map.get(i);
    if (!fl || Number(fl.this_qty) <= 0) continue;
    const orig = allItems[i] as SoItem & {
      serial_numbers?: string[];
      warehouse_id?: string | null;
      is_serialized?: boolean;
    };
    const thisQty = Number(fl.this_qty) || 0;
    const srcSerials = fl.serial_numbers && fl.serial_numbers.length > 0
      ? fl.serial_numbers
      : (orig.serial_numbers || []);
    const slicedSerials = srcSerials.slice(0, thisQty);
    newItems.push({
      ...orig,
      qty: thisQty,
      serial_numbers: slicedSerials,
      warehouse_id: (fl.warehouse_id ?? (orig as any).warehouse_id ?? null) as string | null,
      is_serialized: (fl.is_serialized ?? (orig as any).is_serialized ?? false) as boolean,
    });
  }
  return { ...base, items: newItems };
}

/**
 * Sales Order → General DC (partial). Maps SOB to GeneralDcItem shape.
 */
export function salesOrderToGeneralDcPartial(
  so: SalesOrder,
  lines: FulfillmentLine[],
): NewGeneralDcPayload {
  const map = fulfillmentMap(lines);
  const allItems = so.items || [];
  const items: GeneralDcItemForPartial[] = [];
  for (let i = 0; i < allItems.length; i++) {
    const fl = map.get(i);
    if (!fl || Number(fl.this_qty) <= 0) continue;
    const orig = allItems[i] as any;
    const qty = Number(fl.this_qty) || 0;
    const srcSerials = fl.serial_numbers && fl.serial_numbers.length > 0
      ? fl.serial_numbers
      : (Array.isArray(orig.serial_numbers) ? orig.serial_numbers : []);
    const sliced = (srcSerials as string[]).slice(0, qty);
    items.push({
      product_id: orig.product_id ?? null,
      part_name: orig.description || orig.part_name || null,
      model_no: orig.part_model_no || null,
      hsn: orig.hsn ?? null,
      uom: orig.unit || "Nos",
      qty,
      unit_price: Number(orig.rate) || 0,
      warehouse_id: (fl.warehouse_id ?? orig.warehouse_id ?? null) as string | null,
      is_serialized: !!((fl as any).is_serialized ?? orig.is_serialized),
      serial_numbers: sliced,
    });
  }
  return {
    dc_date: istTodayIso(),
    returnable: false,
    expected_return_date: null,
    customer_id: (so as any).customer_id ?? null,
    customer_name: (so as any).buyer_name ?? null,
    billing_address: (so as any).billing_address ?? null,
    shipping_address: (so as any).shipping_address ?? null,
    purpose: (so as any).notes ?? null,
    branch_id: (so as any).branch_id ?? null,
    items,
    status: "Draft",
    allow_negative_stock: false,
    notes: (so as any).notes ?? null,
    terms: (so as any).terms ?? null,
    sales_order_id: so.id,
  };
}

/**
 * Sales Order → Proforma (partial). read-only, no stock posting.
 */
export function salesOrderToProformaPartial(
  so: SalesOrder,
  lines: FulfillmentLine[],
): NewProformaPayload {
  const map = fulfillmentMap(lines);
  const allItems = so.items || [];
  const newItems: SoItem[] = [];
  for (let i = 0; i < allItems.length; i++) {
    const fl = map.get(i);
    if (!fl || Number(fl.this_qty) <= 0) continue;
    const orig = allItems[i] as any;
    const thisQty = Number(fl.this_qty) || 0;
    const srcSerials = fl.serial_numbers && fl.serial_numbers.length > 0
      ? fl.serial_numbers
      : (Array.isArray(orig.serial_numbers) ? orig.serial_numbers : []);
    const sliced = (srcSerials as string[]).slice(0, thisQty);
    newItems.push({
      ...orig,
      qty: thisQty,
      serial_numbers: sliced,
      warehouse_id: (fl.warehouse_id ?? orig.warehouse_id ?? null) as string | null,
      is_serialized: (fl.is_serialized ?? orig.is_serialized ?? false) as boolean,
    });
  }
  const prior = (lines || []).map((l) => ({
    line_index: l.line_index,
    fulfilled_before: Number(l.fulfilled_before) || 0,
  }));
  const thisFulfilled = (lines || [])
    .filter((l) => Number(l.this_qty) > 0)
    .map((l) => ({ line_index: l.line_index, this_qty: Number(l.this_qty) || 0 }));
  return {
    branch_id: (so as any).branch_id ?? null,
    customer_id: (so as any).customer_id ?? null,
    proforma_date: istTodayIso(),
    billing_address: (so as any).billing_address ?? null,
    shipping_address: (so as any).shipping_address ?? null,
    place_of_supply: (so as any).place_of_supply ?? null,
    buyer_name: (so as any).buyer_name ?? null,
    buyer_gstin: (so as any).buyer_gstin ?? null,
    buyer_state: (so as any).buyer_state ?? null,
    buyer_state_code: (so as any).buyer_state_code ?? null,
    po_number: (so as any).po_number ?? null,
    po_date: (so as any).po_date ?? null,
    notes: (so as any).notes ?? null,
    terms: (so as any).terms ?? null,
    payment_terms: (so as any).payment_terms ?? null,
    linked_quote_id: (so as any).linked_quote_id ?? null,
    sales_order_id: so.id,
    items: newItems,
    reverse_charge: !!((so as any).reverse_charge),
    shipping_charges: Number((so as any).shipping_charges) || 0,
    adjustment: Number((so as any).adjustment) || 0,
    tcs_percent: Number((so as any).tcs_percent) || 0,
    tcs_amount: Number((so as any).tcs_amount) || 0,
    round_off: Number((so as any).round_off) || 0,
    discount_label: (so as any).discount_label ?? null,
    discount_amount: Number((so as any).discount_amount) || 0,
    prior_fulfilled: prior,
    this_fulfilled: thisFulfilled,
    status: "draft",
    skip_stock_posting: true as const,
  };
}

/**
 * Sales Order → Delivery Challan (partial).
 */
export function salesOrderToDeliveryChallanPartial(
  so: SalesOrder,
  lines: FulfillmentLine[],
): NewDeliveryChallan {
  const base = salesOrderToDeliveryChallan(so);
  const map = fulfillmentMap(lines);
  const allItems = so.items || [];
  const filtered: ChallanItem[] = [];
  for (let i = 0; i < allItems.length; i++) {
    const fl = map.get(i);
    if (!fl || Number(fl.this_qty) <= 0) continue;
    const orig = allItems[i] as any;
    const thisQty = Number(fl.this_qty) || 0;
    const srcSerials = fl.serial_numbers && fl.serial_numbers.length > 0
      ? fl.serial_numbers
      : (Array.isArray(orig.serial_numbers) ? orig.serial_numbers : []);
    const sliced = (srcSerials as string[]).slice(0, thisQty);
    const ci = soItemToChallanItem({ ...orig, qty: thisQty, serial_numbers: sliced, warehouse_id: fl.warehouse_id ?? orig.warehouse_id } as SoItem);
    // Override qty/serials to reflect partial
    ci.qty = String(thisQty);
    ci.serial_numbers = sliced;
    if (sliced.length > 0) ci.serial_no = String(sliced[0]);
    else ci.serial_no = "";
    ci.warehouse_id = (fl.warehouse_id ?? orig.warehouse_id ?? null) as string | null;
    ci.is_serialized = !!((fl as any).is_serialized ?? orig.is_serialized);
    // Keep header context
    const branchId = (so as any).branch_id ?? null;
    const buyerState = (so as any).buyer_state ?? so.place_of_supply ?? null;
    const buyerCode = (so as any).buyer_state_code ?? so.place_of_supply_code ?? null;
    filtered.push({ ...ci, branch_id: branchId, buyer_state: buyerState, buyer_state_code: buyerCode });
  }
  return { ...base, items: filtered };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function orderedVsFulfilled(
  so: SalesOrder,
  summary: SoFulfillmentSummary[],
): { ordered: number; fulfilled: number; balance: number; fulfilledProforma: number } {
  const ordered = (summary && summary.length > 0)
    ? summary.reduce((s, r) => s + (Number(r.ordered_qty) || 0), 0)
    : (so.items || []).reduce((s, it) => s + (Number((it as any).qty) || 0), 0);
  const fulfilled = (summary || []).reduce((s, r) => s + (Number(r.fulfilled_stock) || 0), 0);
  const fulfilledProforma = (summary || []).reduce((s, r) => s + (Number(r.fulfilled_proforma) || 0), 0);
  const balance = (summary && summary.length > 0)
    ? summary.reduce((s, r) => s + (Number(r.balance) || 0), 0)
    : Math.max(0, ordered - fulfilled);
  return { ordered, fulfilled, balance, fulfilledProforma };
}

export function isSoFullyDelivered(summary: SoFulfillmentSummary[]): boolean {
  if (!summary || summary.length === 0) return false;
  return summary.every((r) => !!r.is_complete || (Number(r.balance) || 0) <= 0);
}
