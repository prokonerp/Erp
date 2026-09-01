// Purchase Order — types and data helpers.

import { supabase } from "@/integrations/supabase/client";
import type { GstItemBreakup } from "@/lib/gst";

export type POStatus = "draft" | "approved" | "sent" | "partial" | "completed" | "cancelled";

/** `tone` is the legacy light-only class string; new UI should prefer the
 *  theme-aware `badgeTone` with <StatusBadge />. */
export const PO_STATUSES: {
  value: POStatus;
  label: string;
  tone: string;
  badgeTone: "neutral" | "info" | "warning" | "success" | "danger" | "primary";
}[] = [
  { value: "draft", label: "Draft", tone: "bg-slate-200 text-slate-800", badgeTone: "neutral" },
  { value: "approved", label: "Approved", tone: "bg-indigo-100 text-indigo-800", badgeTone: "primary" },
  { value: "sent", label: "Sent to Vendor", tone: "bg-blue-100 text-blue-800", badgeTone: "info" },
  { value: "partial", label: "Partially Received", tone: "bg-amber-100 text-amber-800", badgeTone: "warning" },
  { value: "completed", label: "Completed", tone: "bg-emerald-100 text-emerald-800", badgeTone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "bg-rose-100 text-rose-700", badgeTone: "danger" },
];

export function poStatusMeta(s: POStatus) {
  return PO_STATUSES.find((x) => x.value === s) ?? PO_STATUSES[0];
}

export type DeliveryAddressType = "org" | "customer" | "custom";

export type PORow = {
  id: string;
  po_no: string | null;
  po_date: string;
  delivery_date: string | null;
  branch_id: string;
  vendor_id: string;

  vendor_name: string | null;
  vendor_gstin: string | null;
  vendor_address: string | null;
  vendor_contact_name: string | null;
  vendor_phone: string | null;
  vendor_email: string | null;
  vendor_state_code: string | null;
  vendor_state_name: string | null;

  buyer_name: string | null;
  buyer_gstin: string | null;
  buyer_state_code: string | null;
  buyer_state_name: string | null;
  buyer_address: string | null;

  delivery_address_type: DeliveryAddressType;
  delivery_address: string | null;
  customer_id: string | null;
  customer_name: string | null;

  payment_terms: string | null;
  is_interstate: boolean;

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

  status: POStatus;
  notes: string | null;
  terms: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type POItemRow = {
  id: string;
  po_id: string;
  sr_no: number;
  product_id: string | null;
  description: string;
  hsn: string | null;
  qty: number;
  unit: string | null;
  rate: number;
  discount_pct: number;
  taxable_value: number;
  gst_rate: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  line_total: number;
  received_qty: number;
  warranty_months: number | null;
};

export type POItemDraft = {
  product_id: string | null;
  description: string;
  hsn: string;
  qty: number;
  unit: string;
  rate: number;
  discount_pct: number;
  gst_rate: number;
  warranty_months: number;
};

export const emptyPOItem = (): POItemDraft => ({
  product_id: null,
  description: "",
  hsn: "",
  qty: 1,
  unit: "Nos",
  rate: 0,
  discount_pct: 0,
  gst_rate: 18,
  warranty_months: 12,
});

export function poItemFromBreakup(
  d: POItemDraft,
  b: GstItemBreakup,
): Omit<POItemRow, "id" | "po_id" | "received_qty"> {
  return {
    sr_no: 0,
    product_id: d.product_id,
    description: d.description,
    hsn: d.hsn || null,
    qty: Number(d.qty) || 0,
    unit: d.unit || null,
    rate: Number(d.rate) || 0,
    discount_pct: Number(d.discount_pct) || 0,
    taxable_value: b.taxable_value,
    gst_rate: Number(d.gst_rate) || 0,
    cgst: b.cgst,
    sgst: b.sgst,
    igst: b.igst,
    cess: b.cess,
    line_total: b.line_total,
    warranty_months: Number.isFinite(Number(d.warranty_months)) ? Number(d.warranty_months) : 12,
  };
}

// Columns without warranty_months — used as fallback until migration is live.
const PO_ITEMS_FALLBACK_COLUMNS =
  "id, po_id, sr_no, product_id, description, hsn, qty, unit, rate, discount_pct, taxable_value, gst_rate, cgst, sgst, igst, cess, line_total, received_qty, created_at";

export function isMissingWarrantyColumnError(err: any): boolean {
  const msg = (err?.message || err?.details || err?.hint || String(err) || "").toLowerCase();
  return msg.includes("warranty_months");
}

function normalizePOItems(rows: any[]): POItemRow[] {
  return (rows ?? []).map((r) => ({
    ...r,
    warranty_months: r.warranty_months ?? 12,
  })) as POItemRow[];
}

// ── UUID guard ──────────────────────────────────────────────────────────
// PostgREST returns 400 "invalid input syntax for type uuid: \"1\"" when a
// route param like "/po/1" (or any non-UUID) is passed to `.eq("po_id", id)`.
// The encoded URL fragment `"%22%2C%22po_id%22:1"` seen in prod is exactly that
// JSON-ish leakage. Early-return with a user-friendly error avoids the 400 and
// the double-fetch that surfaces it twice via React StrictMode / useEffect.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isValidUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v);
}
function assertValidUuid(id: unknown, label = "ID"): void {
  if (!isValidUuid(id)) {
    // Keep the original value in the message for debugging, but don't leak
    // the full UUID in production toasts — caller will show a generic msg.
    throw new Error(`Invalid ${label} — expected UUID, got ${JSON.stringify(id)}`);
  }
}
function mapUuid400Error(err: any): Error | null {
  const msg = String(err?.message || err?.details || err?.hint || err || "").toLowerCase();
  // PostgREST 400 for uuid column when value is "1", "null", "undefined", etc.
  if (msg.includes("invalid input syntax for type uuid") || msg.includes("22p02")) {
    return new Error("Invalid Purchase Order ID — the link may be outdated or malformed.");
  }
  return null;
}

export async function fetchPOWithItems(id: string): Promise<{ po: PORow; items: POItemRow[] }> {
  if (!isValidUuid(id)) {
    throw new Error("Invalid Purchase Order ID — the link may be outdated or malformed.");
  }
  let po: any = null;
  let e1: any = null;
  try {
    const res = await (supabase as any).from("purchase_orders").select("*").eq("id", id).maybeSingle();
    po = res.data;
    e1 = res.error;
  } catch (err: any) {
    throw mapUuid400Error(err) ?? err;
  }
  if (e1) throw mapUuid400Error(e1) ?? e1;
  if (!po) throw new Error("Purchase Order not found");

  // Try select * first (includes warranty_months when column exists)
  let items: any = null;
  let e2: any = null;
  try {
    const res = await (supabase as any).from("purchase_order_items").select("*").eq("po_id", id).order("sr_no");
    items = res.data;
    e2 = res.error;
  } catch (err: any) {
    throw mapUuid400Error(err) ?? err;
  }

  if (e2 && isMissingWarrantyColumnError(e2)) {
    const fallback = await (supabase as any)
      .from("purchase_order_items")
      .select(PO_ITEMS_FALLBACK_COLUMNS)
      .eq("po_id", id)
      .order("sr_no");
    if (fallback.error) throw mapUuid400Error(fallback.error) ?? fallback.error;
    return { po: po as PORow, items: normalizePOItems(fallback.data) };
  }
  if (e2) throw mapUuid400Error(e2) ?? e2;
  return { po: po as PORow, items: normalizePOItems(items) };
}

/**
 * Resilient insert for purchase_order_items — strips warranty_months
 * and retries once if the remote DB has not yet applied the warranty
 * migration (PostgREST schema cache 400).
 */
export async function safeInsertPOItems(rows: Record<string, any>[]): Promise<void> {
  if (!rows.length) return;
  // Guard: every row must have a valid UUID po_id — prevents the
  // `po_id=eq.1` / `"%22po_id%22:1"` 400 seen when a numeric id leaks.
  for (const r of rows) {
    if (!isValidUuid(r.po_id)) {
      throw new Error(`Invalid po_id in insert row — expected UUID, got ${JSON.stringify(r.po_id)}`);
    }
  }
  let { error } = await (supabase as any).from("purchase_order_items").insert(rows);
  if (error && isMissingWarrantyColumnError(error)) {
    const stripped = rows.map(({ warranty_months: _w, ...rest }) => rest);
    const retry = await (supabase as any).from("purchase_order_items").insert(stripped);
    if (retry.error) throw retry.error;
    // Non-blocking warn - UI callers may toast
    console.warn("[safeInsertPOItems] warranty_months column missing on remote, inserted without it. Apply migration 20260901000000_add_po_warranty.sql");
    return;
  }
  if (error) throw error;
}

export async function safeDeletePOItems(poId: string): Promise<void> {
  if (!isValidUuid(poId)) throw new Error("Invalid Purchase Order ID — expected UUID");
  const { error } = await (supabase as any).from("purchase_order_items").delete().eq("po_id", poId);
  if (error) {
    const mapped = mapUuid400Error(error);
    if (mapped) throw mapped;
    throw error;
  }
}

export function inrPO(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}