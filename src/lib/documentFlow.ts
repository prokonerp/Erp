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
import { r3 } from "@/lib/money";

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
    warranty_applicable?: boolean | null;
    warranty_duration?: number | null;
    warranty_unit?: string | null;
    warranty_start_from?: string | null;
    warranty_type?: string | null;
  };
  // Prefer explicit warranty fields on the quote item; fallback to warranty_months
  // (Quotation legacy) → { applicable:true, duration, unit:"Months"}.
  const wm = (qi as any).warranty_months;
  const hasWm = wm != null && Number(wm) > 0;
  const wApplicable =
    (anyQi.warranty_applicable as boolean | null) ?? (hasWm ? true : null);
  const wDuration =
    (anyQi.warranty_duration as number | null) ?? (hasWm ? Number(wm) : null);
  const wUnit =
    (anyQi.warranty_unit as string | null) ?? (hasWm ? "Months" : null);
  const wStart = (anyQi.warranty_start_from as string | null) ?? null;
  const wType = (anyQi.warranty_type as string | null) ?? null;
  return {
    product_id: qi.product_id ?? null,
    description: qi.description || qi.product_name || "",
    hsn: qi.hsn ?? null,
    qty: r3(Number(qi.qty) || 0),
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
    ...(wApplicable != null ? { warranty_applicable: wApplicable } : {}),
    ...(wDuration != null ? { warranty_duration: wDuration } : {}),
    ...(wUnit != null ? { warranty_unit: wUnit } : {}),
    ...(wStart != null ? { warranty_start_from: wStart } : {}),
    ...(wType != null ? { warranty_type: wType } : {}),
    ...(hasWm ? { warranty_months: Number(wm) } : {}),
  } as SoItem;
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
    place_of_supply_code: (q as any).place_of_supply_code ?? null,
    is_interstate: false,
    // Preserve reverse_charge if quotation carries it (fallback chain: SO uses quotation value)
    reverse_charge: !!((q as any).reverse_charge ?? false),
    contact_person: q.contact_name,
    contact_email: q.contact_email,
    contact_mobile: q.contact_phone,
    salesperson: q.salesperson,
    payment_terms: q.payment_terms,
    delivery_timeline: q.delivery_timeline,
    // Preserve PO if quotation already carries it (custom field or future migration)
    po_number: (q as any).po_number ?? null,
    po_date: (q as any).po_date ?? null,
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
    // Preserve warranty so proforma/invoice print retains months (fixes warranty/AMC column)
    warranty_applicable: (it as any).warranty_applicable ?? null,
    warranty_duration: (it as any).warranty_duration ?? (it as any).warranty_months ?? null,
    warranty_unit: (it as any).warranty_unit ?? ((it as any).warranty_months != null ? "Months" : null),
    warranty_start_from: (it as any).warranty_start_from ?? null,
    warranty_months: (it as any).warranty_months ?? null,
  } as ChallanItem & Record<string, unknown>;
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
    warranty_applicable: (ci.warranty_applicable as boolean | null) ?? null,
    warranty_duration:
      ci.warranty_duration != null ? Number(ci.warranty_duration) : ci.warranty_months != null ? Number(ci.warranty_months) : null,
    warranty_unit: (ci.warranty_unit as string | null) ?? (ci.warranty_months != null ? "Months" : null),
    warranty_start_from: (ci.warranty_start_from as string | null) ?? null,
    warranty_months: ci.warranty_months != null ? Number(ci.warranty_months) : null,
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
  // Optional display helpers for richer error messages
  description?: string | null;
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

/** Proforma payload mirrors NewInvoicePayload but with proforma semantics
 *  Extended to preserve all quotation fields required for print (PO, payment_terms,
 *  delivery_timeline, salesperson, contact_person, place_of_supply, reverse_charge,
 *  sales_type, terms, notes, addresses, GSTIN/state).
 *  TODO(DB): proforma_invoices currently missing columns for payment_terms,
 *  salesperson, contact_person/email/mobile, delivery_timeline, sales_type,
 *  place_of_supply_code (place_of_supply_code exists but may need backfill).
 *  Until migration adds them, those fields are carried in payload for writer
 *  fallback/printing but filtered on insert (see writers.ts TODO).
 */
export type NewProformaPayload = {
  branch_id: string | null;
  customer_id: string | null;
  proforma_date: string;
  billing_address: string | null;
  shipping_address: string | null;
  place_of_supply: string | null;
  place_of_supply_code: string | null;
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
  // ── Print-required carry-through (fallback chain: proforma uses SO, SO uses quotation) ──
  // TODO(DB): add columns to proforma_invoices if missing; writers currently persist only if column exists
  contact_person?: string | null;
  contact_email?: string | null;
  contact_mobile?: string | null;
  salesperson?: string | null;
  delivery_timeline?: string | null;
  sales_type?: string | null;
};

// ── Internal helpers for defensive pure logic ───────────────────────────────

function countDecimals(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(n);
  // Handle exponential notation
  if (s.includes("e") || s.includes("E")) {
    const [base, expStr] = s.split(/e/i);
    const exp = Number(expStr) || 0;
    const baseDecimals = (base.split(".")[1] || "").length;
    return Math.max(0, baseDecimals - exp);
  }
  const parts = s.split(".");
  if (parts.length < 2) return 0;
  // Trim trailing zeros? For validation we care about actual precise value, so count raw.
  // But to avoid false positives from floating noise (e.g. 0.1+0.2), rely on r3 already rounding.
  // So we count after r3 normalization.
  return parts[1].length;
}

function getLineLabel(line: any, idx: number): string {
  const desc = (line?.description ?? line?.part_name ?? line?.product_id ?? "") as string;
  const trimmed = String(desc).trim();
  if (trimmed) return `Line ${idx + 1} (${trimmed})`;
  return `Line ${idx + 1}`;
}

function isStockAffectingType(t: string | null | undefined): boolean {
  return t === "tax_invoice" || t === "general_dc" || t === "delivery_challan";
}

/**
 * Build a fulfillment preview: one FulfillmentLine per SO item, with
 * already-delivered qty looked up from the view. this_qty defaults to balance
 * (i.e. ship the remainder), clamped 0..balance.
 *
 * Defensive: handles missing summary entries, null/undefined items, negative qty,
 * fractional qty (r3 rounded), duplicate product_id (keyed by line_index, not product_id),
 * empty SO, string qty, null warehouse_id.
 */
export function buildFulfillmentPreview(
  so: SalesOrder | null | undefined,
  summary: SoFulfillmentSummary[] | null | undefined,
): FulfillmentLine[] {
  const rawItems: any[] = Array.isArray((so as any)?.items) ? (so as any).items : [];
  // Filter out null/undefined/non-object items but preserve index mapping
  // To keep line_index aligned with original SO lines, we do NOT filter here for return;
  // instead we filter nulls out of result. But spec says handle null/undefined items defensively.
  // We'll filter null items and return preview only for valid items, with proper line_index.
  const items = rawItems.filter((it) => it != null && typeof it === "object");
  // If SO had null items that were filtered, line_index will still be sequential over valid items.
  // For robustness, if original SO had sparse nulls, we keep mapping by filtered index.
  // However to preserve original line_index semantics, we map using original indices.
  // Simpler: produce preview for each valid item with its original line_index.
  const map = new Map<number, SoFulfillmentSummary>();
  for (const s of (summary || []) as SoFulfillmentSummary[]) {
    if (!s || typeof s !== "object") continue;
    const li = Number((s as any).line_index);
    if (!Number.isFinite(li)) continue;
    // If duplicate line_index, last wins - defensive
    map.set(li, s);
  }

  const result: FulfillmentLine[] = [];
  // Track original index; skip null items but keep line_index as original position
  let validIdx = 0;
  for (let origIdx = 0; origIdx < rawItems.length; origIdx++) {
    const it = rawItems[origIdx];
    if (it == null || typeof it !== "object") continue;
    // orderedQty: coerce qty (may be string) to number, handle negative, NaN, fractional via r3
    const rawQty = (it as any).qty;
    const numQty = Number(rawQty);
    const orderedQty = r3(Math.max(0, Number.isFinite(numQty) ? numQty : 0));
    // Missing product_id -> null
    const productId = (it as any).product_id != null ? String((it as any).product_id) : null;
    // If product_id is empty string, treat as null
    const normalizedProductId = productId && productId.trim() !== "" ? productId : null;
    const s = map.get(origIdx) ?? map.get(validIdx);
    // fulfilledBefore: clamp >=0, handle string/null
    const fulfilledRaw = s ? Number((s as any).fulfilled_stock) : 0;
    const fulfilledBefore = r3(Math.max(0, Number.isFinite(fulfilledRaw) ? fulfilledRaw : 0));
    // balance: if summary provides balance, use it clamped; otherwise ordered - fulfilled
    let balanceRaw: number;
    if (s && (s as any).balance != null && Number.isFinite(Number((s as any).balance))) {
      balanceRaw = r3(Number((s as any).balance));
    } else {
      balanceRaw = r3(orderedQty - fulfilledBefore);
    }
    // Ensure balance = max(0, min(ordered, balanceRaw)) and also handle over-fulfillment
    const balance = r3(Math.max(0, Math.min(orderedQty, balanceRaw)));
    // this_qty defaults to balance (ship remainder)
    const thisQty = r3(Math.max(0, Math.min(balance, balance)));

    result.push({
      line_index: origIdx,
      product_id: normalizedProductId ?? ((s as any)?.product_id ?? null),
      ordered_qty: orderedQty,
      fulfilled_before: fulfilledBefore,
      balance,
      this_qty: thisQty,
      warehouse_id: ((it as any).warehouse_id as string | null) ?? null,
      serial_numbers: Array.isArray((it as any).serial_numbers)
        ? ((it as any).serial_numbers as string[]).slice()
        : [],
      is_serialized: !!((it as any).is_serialized),
      description: (it as any).description ?? (it as any).part_name ?? null,
    });
    validIdx++;
  }

  // Edge: if SO was null/undefined or items empty, return []
  // Also handle summary with entries but no SO items? Then preview empty.
  return result;
}

/**
 * Validate this_qty per line.
 *  - at least one line must have this_qty > 0
 *  - each this_qty must be 0 <= this_qty <= balance
 *  - serialized lines: qty must be integer and serial_numbers.length === this_qty
 *  - stock lines (product_id present) with this_qty >0 must have warehouse_id
 * Returns null if valid, otherwise an error string.
 *
 * Enhanced: handles NaN, duplicate serials across lines, qty precision >3 decimals,
 * warehouse required only for needsStock types (generic param), user-friendly
 * messages with line number + description if available.
 */
export function validateThisQty(
  lines: FulfillmentLine[] | null | undefined,
  opts?: { requireWarehouse?: boolean | ((line: FulfillmentLine) => boolean) },
): string | null {
  if (!lines || !Array.isArray(lines) || lines.length === 0) return "No lines to validate";

  // Filter out null entries defensively, but if all null -> same error
  const validLines = (lines as any[]).filter((l) => l != null && typeof l === "object") as FulfillmentLine[];
  if (validLines.length === 0) return "No lines to validate";

  const requireWarehouseOpt = opts?.requireWarehouse;
  // Helper to decide if warehouse required for a line
  const isWarehouseRequired = (line: FulfillmentLine): boolean => {
    if (typeof requireWarehouseOpt === "function") return (requireWarehouseOpt as (l: FulfillmentLine)=>boolean)(line);
    if (requireWarehouseOpt === false) return false;
    // Generic: require warehouse only when product_id present (stock line)
    return line.product_id != null && String(line.product_id).trim() !== "";
  };

  // Global duplicate serial tracking across all lines
  const seenSerials = new Map<string, number>(); // serial -> first line idx
  const duplicateSerials: string[] = [];

  let hasPositive = false;

  for (let i = 0; i < validLines.length; i++) {
    const line: any = validLines[i];
    const label = getLineLabel(line, i);

    // Coerce and validate this_qty is finite
    const rawQty = line.this_qty;
    const qty = Number(rawQty);
    if (rawQty !== 0 && rawQty !== "0" && (rawQty == null || rawQty === "")) {
      // Treat empty as 0, but if explicitly NaN-like
      if (!Number.isFinite(qty)) {
        // Check if it's actually 0? Number(null)=0, Number(undefined)=NaN
        if (Number.isNaN(qty) || !Number.isFinite(qty)) {
          return `${label}: quantity must be a valid number (got ${String(rawQty)})`;
        }
      }
    }
    if (!Number.isFinite(qty)) {
      return `${label}: quantity must be a valid number (got ${String(rawQty)})`;
    }
    const balanceRaw = line.balance;
    const balance = Number(balanceRaw);
    if (!Number.isFinite(balance)) {
      return `${label}: balance must be a valid number (got ${String(balanceRaw)})`;
    }

    // Precision check: >3 decimals
    // Do this before clamping check, using original rawQty if it's a number
    // We check r3 vs original: if r3(qty) !== qty within epsilon and decimals >3, error
    // Simpler: count decimals of qty (after Number)
    if (Number.isFinite(qty)) {
      const dec = countDecimals(qty);
      if (dec > 3) {
        return `${label}: quantity has too many decimals (max 3, got ${dec})`;
      }
    }

    if (qty > 0) hasPositive = true;
    if (qty < 0 || Object.is(qty, -0)) {
      // qty <0 check, -0 is considered 0
      if (qty < -1e-9) return `${label}: quantity cannot be negative`;
    }
    if (qty - balance > 1e-6) return `${label}: quantity ${qty} exceeds balance ${balance}`;
  // Serialized checks
    if (line.is_serialized) {
      const expected = Math.floor(qty);
      // Fractional check: must be whole number
      if (Math.abs(qty - expected) > 1e-9) {
        return `${label}: serialized products need a whole-number quantity (got ${qty})`;
      }
      const actual = Array.isArray(line.serial_numbers) ? line.serial_numbers.length : 0;
      // Only enforce serial count when qty >0 or when serials are present
      if (qty > 0 && actual !== expected) {
        return `${label}: select ${expected} serial number(s) (got ${actual})`;
      }
      if (qty === 0 && actual !== 0) {
        return `${label}: select ${expected} serial number(s) (got ${actual})`;
      }
      // Empty serial_numbers when qty>0
      if (qty > 0 && actual === 0) {
        return `${label}: serial numbers required for serialized product`;
      }
      // Duplicate within same line
      if (Array.isArray(line.serial_numbers) && line.serial_numbers.length > 0) {
        const seenInLine = new Set<string>();
        for (const sn of line.serial_numbers) {
          const trimmed = String(sn).trim();
          if (!trimmed) continue;
          if (seenInLine.has(trimmed)) {
            return `${label}: duplicate serial number "${trimmed}" within line`;
          }
          seenInLine.add(trimmed);
        }
      }
    }

    // Warehouse required for stock lines
    if (qty > 0 && isWarehouseRequired(line as FulfillmentLine) && !line.warehouse_id) {
      return `${label}: warehouse required`;
    }

    // Zero balance but qty >0 already caught by exceeds, but give friendly if balance==0
    if (balance <= 1e-9 && qty > 1e-9) {
      return `${label}: no balance remaining (ordered fulfilled)`;
    }

    // Collect serials for cross-line duplicate check (only for lines with qty>0)
    if (Array.isArray(line.serial_numbers)) {
      for (const sn of line.serial_numbers) {
        const trimmed = String(sn).trim();
        if (!trimmed) continue;
        if (seenSerials.has(trimmed)) {
          const firstIdx = seenSerials.get(trimmed)!;
          const firstLabel = getLineLabel(validLines[firstIdx] as any, firstIdx);
          // Report duplicate across lines with both line numbers
          return `${label}: duplicate serial number "${trimmed}" already used in ${firstLabel}`;
        }
        seenSerials.set(trimmed, i);
      }
    }
  }
  if (!hasPositive) return "Select at least one line with quantity greater than 0";
  // Also report any collected duplicates not yet returned (should have returned)
  if (duplicateSerials.length > 0) {
    return `Duplicate serial numbers across lines: ${duplicateSerials.join(", ")}`;
  }
  return null;
}

function fulfillmentMap(lines: FulfillmentLine[]): Map<number, FulfillmentLine> {
  return new Map(lines.map((l) => [l.line_index, l]));
}

// ── New pure helpers required by hardening spec ─────────────────────────────

/**
 * Whether cancellation of a conversion restores stock.
 * tax_invoice / general_dc / delivery_challan = yes (stock-affecting)
 * proforma_invoice = no (read-only, no stock posting)
 */
export function getReverseEffect(conversionType: string): boolean {
  if (!conversionType || typeof conversionType !== "string") return false;
  const t = conversionType.trim().toLowerCase();
  return t === "tax_invoice" || t === "general_dc" || t === "delivery_challan";
}

/**
 * Pure helper: can the Sales Order be cancelled?
 * SO is cancellable only if no non-cancelled stock-affecting conversions OR all are cancelled;
 * if SO is already cancelled/invoiced/delivered, explain.
 * Handles null/undefined inputs defensively.
 */
export function canCancelSalesOrder(
  so: SalesOrder | null | undefined,
  summary?: SoFulfillmentSummary[] | null | undefined,
  conversions?: Array<Pick<any, "conversion_type" | "status">> | null | undefined,
): { allowed: boolean; reason: string } {
  if (!so || typeof so !== "object") {
    return { allowed: false, reason: "Sales Order not found" };
  }
  const status = String((so as any).status || "").trim().toLowerCase();
  if (status === "cancelled") {
    return { allowed: false, reason: "Sales Order is already cancelled" };
  }
  if (status === "invoiced") {
    return { allowed: false, reason: "Sales Order is already invoiced and cannot be cancelled" };
  }
  if (status === "delivered") {
    return { allowed: false, reason: "Sales Order is already delivered and cannot be cancelled" };
  }

  // Check non-cancelled stock-affecting conversions
  const convs = Array.isArray(conversions) ? conversions.filter((c) => c && typeof c === "object") : [];
  const blocking = convs.filter(
    (c) => isStockAffectingType(String((c as any).conversion_type || "").trim().toLowerCase()) && String((c as any).status || "").trim().toLowerCase() !== "cancelled",
  );
  if (blocking.length > 0) {
    const types = Array.from(new Set(blocking.map((c) => String((c as any).conversion_type))));
    return {
      allowed: false,
      reason: `Cannot cancel: ${blocking.length} non-cancelled stock conversion(s) exist (${types.join(", ")})`,
    };
  }

  // Also if summary shows fully delivered (allComplete) and status is delivered-like?
  // The status check above already covers, but also check derived full delivery for extra safety:
  // If all lines are complete and there is any non-cancelled stock conversion, already blocked above.
  // If fully delivered via summary but status not yet updated, still block? For robustness:
  if (Array.isArray(summary) && summary.length > 0) {
    const allComplete = summary.every((r) => !!r?.is_complete || (Number(r?.balance) || 0) <= 0);
    const anyFulfilled = summary.some((r) => (Number(r?.fulfilled_stock) || 0) > 0);
    // If fully delivered and status not draft, treat as delivered terminal for stock conversions?
    // But proforma does not affect, so only stock conversions matter—already handled.
    // We keep this as informational: if allComplete and anyFulfilled and no blocking conversions,
    // still allow cancellation? For spec, cancellation should restore stock, so allow if conversions are all cancelled.
    // No extra block.
    void allComplete; void anyFulfilled;
  }

  return { allowed: true, reason: "Sales Order can be cancelled" };
}

/**
 * Validate SO for conversion eligibility.
 * Checks: status not cancelled, not fully delivered for stock conversions (proforma still allowed but capped),
 * items non-empty, every item has valid qty>0 and product info, valid product_id or description.
 *
 * Supports overloaded signatures:
 *   validateSoForConversion(so)
 *   validateSoForConversion(so, conversionType)
 *   validateSoForConversion(so, summary)
 *   validateSoForConversion(so, summary, conversionType)
 */
export function validateSoForConversion(
  so: SalesOrder | null | undefined,
  summaryOrType?: SoFulfillmentSummary[] | ConversionType | string | null,
  maybeType?: ConversionType | string | null,
): string | null {
  if (!so || typeof so !== "object") return "Sales Order not found";

  const status = String((so as any).status || "").trim().toLowerCase();
  if (status === "cancelled") return "Sales Order is cancelled and cannot be converted";

  // Determine which args are which
  let summary: SoFulfillmentSummary[] | null = null;
  let conversionType: string | null = null;

  if (Array.isArray(summaryOrType)) {
    summary = summaryOrType as SoFulfillmentSummary[];
    if (typeof maybeType === "string") conversionType = maybeType;
  } else if (typeof summaryOrType === "string" && summaryOrType) {
    // Could be conversion type like "tax_invoice"
    const maybe = summaryOrType.trim().toLowerCase();
    if (["tax_invoice", "general_dc", "proforma_invoice", "delivery_challan"].includes(maybe)) {
      conversionType = maybe;
    } else {
      // unknown string, treat as conversionType anyway
      conversionType = maybe;
    }
    if (Array.isArray(maybeType as any)) {
      // not expected, but handle
      summary = maybeType as unknown as SoFulfillmentSummary[];
    }
  }

  const itemsRaw: any[] = Array.isArray((so as any).items) ? (so as any).items : [];
  const items = itemsRaw.filter((it) => it != null && typeof it === "object");
  if (items.length === 0) return "Sales Order has no items";

  for (let idx = 0; idx < items.length; idx++) {
    const it: any = items[idx];
    const label = String(it.description || it.part_name || it.product_id || `Line ${idx + 1}`).trim() || `Line ${idx + 1}`;
    const qtyRaw = it.qty;
    const qty = Number(qtyRaw);
    if (qtyRaw == null || qtyRaw === "" || !Number.isFinite(qty)) {
      return `Line ${idx + 1} (${label}): quantity must be a valid number`;
    }
    if (qty <= 0) {
      return `Line ${idx + 1} (${label}): quantity must be greater than 0 (got ${qty})`;
    }
    const dec = countDecimals(qty);
    if (dec > 3) {
      return `Line ${idx + 1} (${label}): quantity has too many decimals (max 3)`;
    }
    const hasProductInfo = (it.product_id != null && String(it.product_id).trim() !== "") || (it.description != null && String(it.description).trim() !== "");
    if (!hasProductInfo) {
      return `Line ${idx + 1}: product information missing (product_id and description empty)`;
    }
    // Optional: rate validation
    if (it.rate != null && it.rate !== "" && !Number.isFinite(Number(it.rate))) {
      return `Line ${idx + 1} (${label}): rate must be a valid number`;
    }
  }

  // Fully delivered check for stock conversions
  // If conversionType is proforma_invoice, still allowed even if fully delivered (capped)
  const isProforma = conversionType === "proforma_invoice";
  if (!isProforma) {
    if (Array.isArray(summary) && summary.length > 0) {
      const fullyDelivered = summary.every((r) => !!r?.is_complete || (Number(r?.balance) || 0) <= 0);
      if (fullyDelivered) {
        const anyFulfilled = summary.some((r) => (Number(r?.fulfilled_stock) || 0) > 0);
        if (anyFulfilled) return "Sales Order is fully delivered and cannot be further converted";
      }
    } else if (status === "delivered" || status === "invoiced") {
      // Fallback to status terminal check when no summary provided
      return `Sales Order is ${status} and cannot be converted for stock`;
    }
  }

  return null;
}

/**
 * Sales Order → Invoice (partial). Clones header like salesOrderToInvoice
 * but slices items to only lines where this_qty>0, replacing qty with
 * this_qty and slicing serial_numbers accordingly.
 * Defensive: does not mutate original SO, handles empty lines, invalid line_index.
 */
export function salesOrderToInvoicePartial(
  so: SalesOrder,
  lines: FulfillmentLine[],
): NewInvoicePayload {
  const base = salesOrderToInvoice(so);
  const map = fulfillmentMap((lines || []).filter((l) => l && typeof l === "object") as FulfillmentLine[]);
  const newItems: SoItem[] = [];
  const allItems = Array.isArray(so.items) ? so.items.filter((it) => it != null && typeof it === "object") : [];
  for (let i = 0; i < allItems.length; i++) {
    const fl = map.get(i);
    if (!fl || !Number.isFinite(Number(fl.this_qty)) || Number(fl.this_qty) <= 1e-9) continue;
    const orig = allItems[i] as SoItem & {
      serial_numbers?: string[];
      warehouse_id?: string | null;
      is_serialized?: boolean;
    };
    const thisQty = r3(Math.max(0, Number(fl.this_qty) || 0));
    const srcSerials = fl.serial_numbers && Array.isArray(fl.serial_numbers) && fl.serial_numbers.length > 0
      ? fl.serial_numbers
      : (Array.isArray((orig as any).serial_numbers) ? (orig as any).serial_numbers : []);
    const slicedSerials = (srcSerials as string[]).slice(0, Math.floor(thisQty));
    // Preserve warranty fields via spread; ensure deep clone of serials
    newItems.push({
      ...(orig as any),
      qty: thisQty,
      serial_numbers: slicedSerials.slice(),
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
  const map = fulfillmentMap((lines || []).filter((l) => l && typeof l === "object") as FulfillmentLine[]);
  const allItems = Array.isArray(so.items) ? so.items.filter((it) => it != null && typeof it === "object") : [];
  const items: GeneralDcItemForPartial[] = [];
  for (let i = 0; i < allItems.length; i++) {
    const fl = map.get(i);
    if (!fl || !Number.isFinite(Number(fl.this_qty)) || Number(fl.this_qty) <= 1e-9) continue;
    const orig = allItems[i] as any;
    const qty = r3(Math.max(0, Number(fl.this_qty) || 0));
    const srcSerials = fl.serial_numbers && Array.isArray(fl.serial_numbers) && fl.serial_numbers.length > 0
      ? fl.serial_numbers
      : (Array.isArray(orig.serial_numbers) ? orig.serial_numbers : []);
    const sliced = (srcSerials as string[]).slice(0, Math.floor(qty));
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
      serial_numbers: sliced.slice(),
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
  const map = fulfillmentMap((lines || []).filter((l) => l && typeof l === "object") as FulfillmentLine[]);
  const allItems = Array.isArray(so.items) ? so.items.filter((it) => it != null && typeof it === "object") : [];
  const newItems: SoItem[] = [];
  for (let i = 0; i < allItems.length; i++) {
    const fl = map.get(i);
    if (!fl || !Number.isFinite(Number(fl.this_qty)) || Number(fl.this_qty) <= 1e-9) continue;
    const orig = allItems[i] as any;
    const thisQty = r3(Math.max(0, Number(fl.this_qty) || 0));
    const srcSerials = fl.serial_numbers && Array.isArray(fl.serial_numbers) && fl.serial_numbers.length > 0
      ? fl.serial_numbers
      : (Array.isArray(orig.serial_numbers) ? orig.serial_numbers : []);
    const sliced = (srcSerials as string[]).slice(0, Math.floor(thisQty));
    newItems.push({
      ...(orig as any),
      qty: thisQty,
      serial_numbers: sliced.slice(),
      warehouse_id: (fl.warehouse_id ?? orig.warehouse_id ?? null) as string | null,
      is_serialized: (fl.is_serialized ?? orig.is_serialized ?? false) as boolean,
    });
  }
  const prior = ((lines || []).filter((l) => l && typeof l === "object") as FulfillmentLine[]).map((l) => ({
    line_index: l.line_index,
    fulfilled_before: Number(l.fulfilled_before) || 0,
  }));
  const thisFulfilled = ((lines || []).filter((l) => l && typeof l === "object") as FulfillmentLine[])
    .filter((l) => Number(l.this_qty) > 1e-9)
    .map((l) => ({ line_index: l.line_index, this_qty: Number(l.this_qty) || 0 }));
  return {
    branch_id: (so as any).branch_id ?? null,
    customer_id: (so as any).customer_id ?? null,
    proforma_date: istTodayIso(),
    billing_address: (so as any).billing_address ?? null,
    shipping_address: (so as any).shipping_address ?? null,
    place_of_supply: (so as any).place_of_supply ?? null,
    place_of_supply_code: (so as any).place_of_supply_code ?? null,
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
    // Preserve all print-required header fields (fallback chain: SO → quotation)
    contact_person: (so as any).contact_person ?? null,
    contact_email: (so as any).contact_email ?? null,
    contact_mobile: (so as any).contact_mobile ?? null,
    salesperson: (so as any).salesperson ?? null,
    delivery_timeline: (so as any).delivery_timeline ?? null,
    // TODO(DB): proforma_invoices.sales_type missing — carried for print/terms branching until migration
    sales_type: (so as any).sales_type ?? null,
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
  const map = fulfillmentMap((lines || []).filter((l) => l && typeof l === "object") as FulfillmentLine[]);
  const allItems = Array.isArray(so.items) ? so.items.filter((it) => it != null && typeof it === "object") : [];
  const filtered: ChallanItem[] = [];
  for (let i = 0; i < allItems.length; i++) {
    const fl = map.get(i);
    if (!fl || !Number.isFinite(Number(fl.this_qty)) || Number(fl.this_qty) <= 1e-9) continue;
    const orig = allItems[i] as any;
    const thisQty = r3(Math.max(0, Number(fl.this_qty) || 0));
    const srcSerials = fl.serial_numbers && Array.isArray(fl.serial_numbers) && fl.serial_numbers.length > 0
      ? fl.serial_numbers
      : (Array.isArray(orig.serial_numbers) ? orig.serial_numbers : []);
    const sliced = (srcSerials as string[]).slice(0, Math.floor(thisQty));
    const ci = soItemToChallanItem({ ...orig, qty: thisQty, serial_numbers: sliced, warehouse_id: fl.warehouse_id ?? orig.warehouse_id } as SoItem);
    // Override qty/serials to reflect partial
    ci.qty = String(thisQty);
    ci.serial_numbers = sliced.slice();
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
  so: SalesOrder | null | undefined,
  summary: SoFulfillmentSummary[] | null | undefined,
): { ordered: number; fulfilled: number; balance: number; fulfilledProforma: number } {
  const rawSummary = Array.isArray(summary) ? summary.filter((r) => r && typeof r === "object") : [];
  const ordered = rawSummary.length > 0
    ? rawSummary.reduce((s, r) => s + (Number((r as any).ordered_qty) || 0), 0)
    : (Array.isArray((so as any)?.items) ? (so as any).items.filter((it: any) => it && typeof it === "object").reduce((s: number, it: any) => {
        const q = Number(it.qty);
        return s + (Number.isFinite(q) && q > 0 ? q : 0);
      }, 0) : 0);
  const fulfilled = rawSummary.reduce((s, r) => s + (Number((r as any).fulfilled_stock) || 0), 0);
  const fulfilledProforma = rawSummary.reduce((s, r) => s + (Number((r as any).fulfilled_proforma) || 0), 0);
  const balance = rawSummary.length > 0
    ? rawSummary.reduce((s, r) => s + Math.max(0, Number((r as any).balance) || 0), 0)
    : Math.max(0, ordered - fulfilled);
  return { ordered: r3(ordered), fulfilled: r3(fulfilled), balance: r3(balance), fulfilledProforma: r3(fulfilledProforma) };
}

export function isSoFullyDelivered(summary: SoFulfillmentSummary[] | null | undefined): boolean {
  if (!summary || !Array.isArray(summary) || summary.length === 0) return false;
  const filtered = summary.filter((r) => r && typeof r === "object");
  if (filtered.length === 0) return false;
  return filtered.every((r) => !!r.is_complete || (Number((r as any).balance) || 0) <= 1e-9);
}
