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

export async function fetchPOWithItems(id: string): Promise<{ po: PORow; items: POItemRow[] }> {
  const [{ data: po, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    (supabase as any).from("purchase_orders").select("*").eq("id", id).maybeSingle(),
    (supabase as any).from("purchase_order_items").select("*").eq("po_id", id).order("sr_no"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (!po) throw new Error("Purchase Order not found");
  return { po: po as PORow, items: (items ?? []) as POItemRow[] };
}

export function inrPO(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}