import { supabase } from "@/integrations/supabase/client";

export type SoStatus = "draft" | "confirmed" | "partial" | "delivered" | "invoiced" | "cancelled";

/** Line item stored inside sales_orders.items — mirrors invoice_items shape so
 *  the same GST engine and PDF helpers work on both. */
export type SoItem = {
  product_id: string | null;
  description: string;
  hsn: string | null;
  qty: number;
  unit: string | null;
  rate: number;
  discount_pct: number;
  gst_rate: number;
  cess_rate?: number;
  taxable_value?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  cess?: number;
  line_total?: number;
  warehouse_id?: string | null;
  serial_numbers?: string[];
  is_serialized?: boolean;
  part_model_no?: string | null;
  part_name?: string | null;
};

export type SalesOrder = {
  id: string;
  so_no: string | null;
  so_date: string;
  valid_until: string | null;
  expected_delivery: string | null;
  branch_id: string | null;
  customer_id: string | null;

  seller_name: string | null;
  seller_gstin: string | null;
  seller_state: string | null;
  seller_state_code: string | null;
  seller_address: string | null;

  buyer_name: string | null;
  buyer_gstin: string | null;
  buyer_state: string | null;
  buyer_state_code: string | null;

  billing_address: string | null;
  shipping_address: string | null;
  place_of_supply: string | null;
  place_of_supply_code: string | null;
  is_interstate: boolean;
  reverse_charge: boolean;

  contact_person: string | null;
  contact_email: string | null;
  contact_mobile: string | null;

  salesperson: string | null;
  payment_terms: string | null;
  delivery_timeline: string | null;
  po_number: string | null;
  po_date: string | null;

  subtotal: number;
  discount: number;
  taxable_value: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  round_off: number;
  total: number;
  total_in_words: string | null;

  shipping_charges: number;
  adjustment: number;
  tcs_percent: number;
  tcs_amount: number;
  discount_label: string | null;
  discount_amount: number;

  status: SoStatus;
  notes: string | null;
  terms: string | null;
  items: SoItem[];

  linked_quote_id: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** `tone` is the legacy light-only class string; new UI should prefer the
 *  theme-aware `badgeTone` with <StatusBadge />. */
export const SO_STATUSES: {
  value: SoStatus;
  label: string;
  tone: string;
  badgeTone: "neutral" | "info" | "warning" | "success" | "danger" | "primary";
}[] = [
  { value: "draft", label: "Draft", tone: "bg-slate-200 text-slate-800", badgeTone: "neutral" },
  { value: "confirmed", label: "Confirmed", tone: "bg-blue-100 text-blue-800", badgeTone: "info" },
  {
    value: "partial",
    label: "Partially Delivered",
    tone: "bg-amber-100 text-amber-800",
    badgeTone: "warning",
  },
  {
    value: "delivered",
    label: "Delivered",
    tone: "bg-emerald-100 text-emerald-800",
    badgeTone: "success",
  },
  {
    value: "invoiced",
    label: "Invoiced",
    tone: "bg-purple-100 text-purple-800",
    badgeTone: "primary",
  },
  {
    value: "cancelled",
    label: "Cancelled",
    tone: "bg-rose-100 text-rose-700",
    badgeTone: "danger",
  },
];

export function soStatusMeta(s: SoStatus) {
  return SO_STATUSES.find((x) => x.value === s) ?? SO_STATUSES[0];
}

/**
 * @deprecated Use fetchSalesOrdersPage() instead — this hits PostgREST 1k cap
 * and loads full items JSONB for every row. Retained for exports only.
 */
export async function fetchSalesOrders(): Promise<SalesOrder[]> {
  const { data, error } = await supabase
    .from("sales_orders" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as SalesOrder[]).map(normalizeSo);
}

// ── Paginated (server-side) — replaces client-only filter that hit 1k cap ──

export type SalesOrdersPaginatedParams = {
  page: number;
  pageSize: number;
  search?: string | null;
};

export async function fetchSalesOrdersPage(
  params: SalesOrdersPaginatedParams,
): Promise<{ data: SalesOrder[]; count: number }> {
  const { page, pageSize, search } = params;
  const capped = Math.min(Math.max(1, Math.floor(pageSize || 25)), 50);
  const from = page * capped;
  const to = from + capped - 1;

  let q: any = supabase
    .from("sales_orders" as never)
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search && search.trim()) {
    // Best-effort PostgREST escaping for .or() ilike filters.
    // PostgREST uses , as separator and () as grouping inside `or()`.
    // We escape these characters, but this is NOT bulletproof — a determined
    // attacker could still inject via unescaped characters like `:` or `"`.
    // TODO: Replace with supabase.filter() or RPC for production-grade escaping.
    const safe = search
      .trim()
      .replace(/[%_\\]/g, "\\$&")
      .replace(/[,()]/g, "\\$&");
    q = q.or(`so_no.ilike.%${safe}%,buyer_name.ilike.%${safe}%`);
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { data: ((data ?? []) as unknown as SalesOrder[]).map(normalizeSo), count: count ?? 0 };
}

export async function fetchSalesOrder(id: string): Promise<SalesOrder> {
  const { data, error } = await supabase
    .from("sales_orders" as never)
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return normalizeSo(data as unknown as SalesOrder);
}

function normalizeSo(r: SalesOrder): SalesOrder {
  if (r.items != null && !Array.isArray(r.items)) {
    if (import.meta.env.DEV) {
      console.warn(
        `[salesOrders] normalizeSo: non-array items for SO ${r.id}:`,
        typeof r.items,
        r.items,
      );
    }
  }
  return { ...r, items: Array.isArray(r.items) ? r.items : [] };
}

// ── Fulfillment ledger types (mirrors VIEW so_fulfillment_summary) ─────────

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

export type SoConversionType = "tax_invoice" | "general_dc" | "proforma_invoice" | "delivery_challan";

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

export type SoConversionRow = {
  id: string;
  sales_order_id: string;
  conversion_type: SoConversionType;
  target_table: string;
  target_id: string;
  target_no: string | null;
  status: string;
  prior_fulfilled: unknown;
  this_fulfilled: unknown;
  balance_after: unknown;
  created_at: string;
  created_by: string | null;
};

/**
 * Pure helper: derive SO status from fulfillment summary + optional current
 * status / conversions. No DB call.
 *
 * Rules (mirrors VIEW so_derived_status):
 *  - cancelled is terminal (returns cancelled if currentStatus is cancelled)
 *  - if no fulfillments (totalFulfilled === 0) → keep draft/confirmed as-is
 *  - if every line balance === 0 → delivered (or invoiced if tax_invoice exists)
 *  - otherwise if any fulfilled → partial
 */
export function soDerivedStatus(
  summary: SoFulfillmentSummary[],
  currentStatus?: SoStatus,
  conversions?: Pick<SoConversionRow, "conversion_type" | "status">[],
): SoStatus {
  if (currentStatus === "cancelled") return "cancelled";
  if (!summary || summary.length === 0) return currentStatus ?? "draft";
  const totalFulfilled = summary.reduce((s, r) => s + (Number(r.fulfilled_stock) || 0), 0);
  const totalBalance = summary.reduce((s, r) => s + (Number(r.balance) || 0), 0);
  const allComplete = summary.every((r) => !!r.is_complete || (Number(r.balance) || 0) <= 0);
  if (totalFulfilled === 0) return currentStatus ?? "draft";
  if (allComplete && totalBalance <= 0) {
    const hasTaxInvoice = (conversions ?? []).some(
      (c) => c.conversion_type === "tax_invoice" && c.status !== "cancelled",
    );
    return hasTaxInvoice ? "invoiced" : "delivered";
  }
  return "partial";
}

// Alias for callers that prefer the longer name
export const soStatusDerived = soDerivedStatus;

export async function fetchSoFulfillmentSummary(salesOrderId: string): Promise<SoFulfillmentSummary[]> {
  const { data, error } = await supabase
    .from("so_fulfillment_summary" as never)
    .select("*")
    .eq("sales_order_id", salesOrderId);
  if (error) throw error;
  return (data ?? []) as unknown as SoFulfillmentSummary[];
}

export async function fetchSoConversions(salesOrderId: string): Promise<SoConversionRow[]> {
  const { data, error } = await supabase
    .from("so_conversions" as never)
    .select("*")
    .eq("sales_order_id", salesOrderId)
    .order("created_at", { ascending: false } as never);
  if (error) throw error;
  return (data ?? []) as unknown as SoConversionRow[];
}
