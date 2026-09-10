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
  // Warranty — preserved from quotation → SO → proforma → invoice chain so that
  // Proforma/Invoice print can show "12 Months" without re-fetching product master.
  warranty_applicable?: boolean | null;
  warranty_duration?: number | null;
  warranty_unit?: string | null;
  warranty_start_from?: string | null;
  warranty_type?: string | null;
  // Legacy per-line warranty override in months (quotations.QuoteItem.warranty_months)
  warranty_months?: number | null;
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
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Sales Order not found or no permission");
  return normalizeSo(data as unknown as SalesOrder);
}

// ── Normalization & guards ───────────────────────────────────────────────

const VALID_SO_STATUSES: SoStatus[] = ["draft", "confirmed", "partial", "delivered", "invoiced", "cancelled"];

export function isTerminalStatus(status: string | null | undefined): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s === "cancelled" || s === "invoiced";
}

export function normalizeSo(r: SalesOrder): SalesOrder {
  if (r.items != null && !Array.isArray(r.items)) {
    if (import.meta.env.DEV) {
      console.warn(
        `[salesOrders] normalizeSo: non-array items for SO ${r.id}:`,
        typeof r.items,
        r.items,
      );
    }
  }
  // Ensure items is always an array, filter out null/non-object entries, coerce qty/rate numbers
  const rawItems: any[] = Array.isArray(r.items) ? r.items : [];
  const filtered = rawItems.filter((it) => it != null && typeof it === "object");
  const items: SoItem[] = filtered.map((it: any) => {
    // Coerce qty/rate to numbers, clamp NaN to 0, preserve rest via spread
    const qtyNum = Number(it.qty);
    const rateNum = Number(it.rate);
    const discountNum = Number(it.discount_pct);
    const gstNum = Number(it.gst_rate);
    return {
      ...it,
      product_id: it.product_id != null ? String(it.product_id) : null,
      description: it.description != null ? String(it.description) : "",
      hsn: it.hsn != null ? String(it.hsn) : null,
      qty: Number.isFinite(qtyNum) ? qtyNum : 0,
      unit: it.unit != null ? String(it.unit) : null,
      rate: Number.isFinite(rateNum) ? rateNum : 0,
      discount_pct: Number.isFinite(discountNum) ? discountNum : 0,
      gst_rate: Number.isFinite(gstNum) ? gstNum : 0,
      warehouse_id: it.warehouse_id != null ? String(it.warehouse_id) : null,
      serial_numbers: Array.isArray(it.serial_numbers) ? it.serial_numbers.filter((x: any) => typeof x === "string" && x.trim() !== "") : [],
      is_serialized: !!it.is_serialized,
    } as SoItem;
  });

  // Ensure status is valid, fallback to draft
  const rawStatus = String((r as any).status || "").trim().toLowerCase() as SoStatus;
  const status: SoStatus = (VALID_SO_STATUSES as string[]).includes(rawStatus) ? rawStatus : "draft";

  return { ...r, items, status };
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
  summary: SoFulfillmentSummary[] | null | undefined,
  currentStatus?: SoStatus,
  conversions?: Pick<SoConversionRow, "conversion_type" | "status">[] | null | undefined,
): SoStatus {
  const s = String(currentStatus || "").trim().toLowerCase() as SoStatus;
  if (s === "cancelled") return "cancelled";
  const arr = Array.isArray(summary) ? summary.filter((r) => r && typeof r === "object") : [];
  if (!arr || arr.length === 0) return (currentStatus as SoStatus) ?? "draft";
  // Defensive numeric coercion, handle null/undefined/string balances
  const totalFulfilled = arr.reduce((sum, r) => sum + (Number((r as any).fulfilled_stock) || 0), 0);
  const totalBalance = arr.reduce((sum, r) => sum + Math.max(0, Number((r as any).balance) || 0), 0);
  const allComplete = arr.every((r) => !!r.is_complete || (Number((r as any).balance) || 0) <= 1e-9);
  if (totalFulfilled <= 1e-9) return (currentStatus as SoStatus) ?? "draft";
  if (allComplete && totalBalance <= 1e-9) {
    const hasTaxInvoice = (Array.isArray(conversions) ? conversions : []).some(
      (c) => String((c as any).conversion_type).trim().toLowerCase() === "tax_invoice" && String((c as any).status).trim().toLowerCase() !== "cancelled",
    );
    return hasTaxInvoice ? "invoiced" : "delivered";
  }
  return "partial";
}

// Alias for callers that prefer the longer name
export const soStatusDerived = soDerivedStatus;

// ── SO cancellation guard (reuses documentFlow logic pattern) ─────────────

function isStockAffectingConversion(t: string): boolean {
  const v = String(t || "").trim().toLowerCase();
  return v === "tax_invoice" || v === "general_dc" || v === "delivery_challan";
}

/**
 * Guard: can this SO be cancelled?
 * SO is cancellable only if no non-cancelled stock-affecting conversions OR all are cancelled;
 * if SO is already cancelled/invoiced/delivered, explain.
 * Pure – no DB.
 */
export function isSoCancellable(
  so: SalesOrder | null | undefined,
  summary?: SoFulfillmentSummary[] | null | undefined,
  conversions?: Pick<SoConversionRow, "conversion_type" | "status">[] | null | undefined,
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
  const convs = Array.isArray(conversions) ? conversions.filter((c) => c && typeof c === "object") : [];
  const blocking = convs.filter(
    (c) =>
      isStockAffectingConversion(String((c as any).conversion_type || "")) &&
      String((c as any).status || "").trim().toLowerCase() !== "cancelled",
  );
  if (blocking.length > 0) {
    const types = Array.from(new Set(blocking.map((c) => String((c as any).conversion_type))));
    return {
      allowed: false,
      reason: `Cannot cancel: ${blocking.length} non-cancelled stock conversion(s) exist (${types.join(", ")})`,
    };
  }
  // If summary indicates fully delivered but status not yet terminal, still allow cancellation if all stock conversions are cancelled.
  // No extra block needed.
  void summary;
  return { allowed: true, reason: "Sales Order can be cancelled" };
}

// Alias matching documentFlow naming for convenience
export const canCancelSalesOrder = isSoCancellable;
export const SO_CANCEL_GUARD = isSoCancellable;

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

// ── JS fallback for SO cancellation (complements DB trigger assert_so_cancel_block) ──

/**
 * Cancel a Sales Order with JS-side guard + DB fallback.
 * 1) Fetches SO + summary + conversions via existing helpers
 * 2) Checks cancellability using isSoCancellable (pure, no DB) — blocks if any
 *    non-cancelled stock conversion (tax_invoice/general_dc/delivery_challan) exists
 * 3) Updates sales_orders status to 'cancelled' with audit fields if columns exist
 *
 * Note: proforma/gdc/invoice cancel helpers already handle ledger sync; this complements
 * them with an SO-level guard. DB trigger trg_so_cancel_guard is the authoritative
 * gate; this JS helper provides friendly pre-validation and reason capture.
 */
export async function cancelSalesOrder(id: string, reason: string): Promise<void> {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Sales Order id is required");
  }
  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  // Fetch state in parallel where possible, but SO first for early fail
  const so = await fetchSalesOrder(id);
  const [summary, conversions] = await Promise.all([
    fetchSoFulfillmentSummary(id),
    fetchSoConversions(id),
  ]);

  // Re-use pure guard (inline fallback if helper shape differs across agents)
  const guard = (typeof isSoCancellable === "function"
    ? isSoCancellable(so as unknown as SalesOrder, summary as any, conversions as any)
    : canCancelSalesOrder
      ? (canCancelSalesOrder as any)(so, summary, conversions)
      : (() => {
          const convs = Array.isArray(conversions) ? conversions : [];
          const blocking = convs.filter(
            (c: any) =>
              ["tax_invoice", "general_dc", "delivery_challan"].includes(
                String(c?.conversion_type || "").trim().toLowerCase(),
              ) && String(c?.status || "").trim().toLowerCase() !== "cancelled",
          );
          if (blocking.length > 0) {
            return {
              allowed: false,
              reason: `Cannot cancel: ${blocking.length} non-cancelled stock conversion(s) exist`,
            };
          }
          const s = String((so as any)?.status || "").trim().toLowerCase();
          if (s === "cancelled") return { allowed: false, reason: "Sales Order is already cancelled" };
          return { allowed: true, reason: "Sales Order can be cancelled" };
        })()) as { allowed: boolean; reason: string };

  if (!guard.allowed) {
    throw new Error(guard.reason);
  }

  // Try audit-rich update first; fallback to minimal status if columns missing
  const nowIso = new Date().toISOString();
  let userId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = (data as any)?.user?.id ?? null;
  } catch {
    userId = null;
  }

  const richPayload: Record<string, unknown> = {
    status: "cancelled",
    cancelled_reason: trimmedReason || null,
    cancelled_at: nowIso,
    cancelled_by: userId,
    updated_at: nowIso,
  };
  // Also mirror into notes if caller wants traceability and column exists?
  // We keep update minimal to avoid triggering unrelated policies.

  let { error } = await supabase
    .from("sales_orders" as never)
    .update(richPayload as never)
    .eq("id", id);

  if (error) {
    const msg = String((error as any)?.message || "").toLowerCase();
    const needsFallback =
      msg.includes("cancelled_reason") ||
      msg.includes("cancelled_at") ||
      msg.includes("cancelled_by") ||
      msg.includes("column") ||
      (msg.includes("schema cache") && msg.includes("cancelled"));
    if (needsFallback) {
      const fallbackPayload: Record<string, unknown> = { status: "cancelled" };
      // Preserve reason in notes if audit columns missing and reason provided
      if (trimmedReason) {
        // Best-effort: append reason to notes without overwriting existing notes blindly
        try {
          const currentNotes = (so as any)?.notes ? String((so as any).notes) : "";
          const appended = currentNotes
            ? `${currentNotes}\n[Cancelled: ${trimmedReason}]`
            : `[Cancelled: ${trimmedReason}]`;
          fallbackPayload["notes"] = appended;
        } catch {
          // ignore
        }
      }
      const retry = await supabase
        .from("sales_orders" as never)
        .update(fallbackPayload as never)
        .eq("id", id);
      if (retry.error) throw retry.error;
      return;
    }
    throw error;
  }
}
