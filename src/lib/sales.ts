// Types + data helpers for the HEAD SALES module (Invoices, Payments, e-Way).
// The migration in supabase/migrations covers the underlying tables.

import { supabase } from "@/integrations/supabase/client";
import type { GstItemBreakup } from "@/lib/gst";

export type InvoiceStatus = "draft" | "issued" | "partial" | "paid" | "cancelled";

export type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  invoice_date: string;
  due_date: string | null;
  branch_id: string;
  customer_id: string;

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
  linked_quote_id: string | null;
  linked_dc_ids: string[] | null;

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
  total_paid: number;
  total_in_words: string | null;

  status: InvoiceStatus;
  cancel_reason: string | null;
  cancelled_at: string | null;

  irn: string | null;
  ack_no: string | null;
  ack_date: string | null;
  qr_payload: string | null;
  einvoice_status: string | null;
  einvoice_error: string | null;

  ewaybill_no: string | null;
  ewaybill_date: string | null;
  ewaybill_valid_till: string | null;

  notes: string | null;
  terms: string | null;
  pdf_url: string | null;
  payment_terms: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceItemRow = {
  id: string;
  invoice_id: string;
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
  warehouse_id?: string | null;
  serial_numbers?: string[];
};

export type ItemDraft = {
  product_id: string | null;
  description: string;
  // (fields below are added for warehouse + serial tracking)
  hsn: string;
  qty: number;
  unit: string;
  rate: number;
  discount_pct: number;
  gst_rate: number;
  warehouse_id: string | null;
  serial_numbers: string[];
  is_serialized: boolean;
  part_model_no: string | null;
  part_name: string | null;
};

export const emptyItem = (): ItemDraft => ({
  product_id: null,
  description: "",
  hsn: "",
  qty: 1,
  unit: "Nos",
  rate: 0,
  discount_pct: 0,
  gst_rate: 18,
  warehouse_id: null,
  serial_numbers: [],
  is_serialized: false,
  part_model_no: null,
  part_name: null,
});

/**
 * Invoice status metadata. `tone` is the legacy light-only class string kept
 * for older call sites; new UI should use the theme-aware `badgeTone` with
 * <StatusBadge /> so colors stay correct in balanced/dark themes.
 */
export const INVOICE_STATUSES: {
  value: InvoiceStatus;
  label: string;
  tone: string;
  badgeTone: "neutral" | "info" | "warning" | "success" | "danger";
}[] = [
  { value: "draft", label: "Draft", tone: "bg-slate-200 text-slate-800", badgeTone: "neutral" },
  { value: "issued", label: "Issued", tone: "bg-blue-100 text-blue-800", badgeTone: "info" },
  { value: "partial", label: "Partially Paid", tone: "bg-amber-100 text-amber-800", badgeTone: "warning" },
  { value: "paid", label: "Paid", tone: "bg-emerald-100 text-emerald-800", badgeTone: "success" },
  { value: "cancelled", label: "Cancelled", tone: "bg-rose-100 text-rose-700", badgeTone: "danger" },
];

export function statusMeta(s: InvoiceStatus) {
  return INVOICE_STATUSES.find((x) => x.value === s) ?? INVOICE_STATUSES[0];
}

export const PAYMENT_MODES = ["bank", "cash", "upi", "cheque", "neft", "rtgs", "card"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export type PaymentRow = {
  id: string;
  payment_no: string | null;
  payment_date: string;
  customer_id: string;
  mode: PaymentMode;
  reference: string | null;
  amount: number;
  unallocated: number;
  notes: string | null;
  created_at: string;
};

export type BranchRow = {
  id: string;
  name: string;
  address: string | null;
  gstin: string | null;
  state_name: string | null;
  state_code: string | null;
  pan: string | null;
  cin: string | null;
  email: string | null;
  phone: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_ifsc: string | null;
  bank_branch: string | null;
  upi_id: string | null;
  logo_url: string | null;
  invoice_footer: string | null;
  is_default: boolean;
};

export async function fetchBranches(): Promise<BranchRow[]> {
  const { data, error } = await supabase.from("branches").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as BranchRow[];
}

export async function fetchInvoiceWithItems(id: string): Promise<{ invoice: InvoiceRow; items: InvoiceItemRow[] }> {
  const [{ data: inv, error: e1 }, { data: items, error: e2 }] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).maybeSingle(),
    supabase.from("invoice_items").select("*").eq("invoice_id", id).order("sr_no"),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (!inv) throw new Error("Invoice not found");
  return { invoice: inv as unknown as InvoiceRow, items: (items ?? []) as unknown as InvoiceItemRow[] };
}

export function itemDraftFromBreakup(
  d: ItemDraft,
  b: GstItemBreakup,
): Omit<InvoiceItemRow, "id" | "invoice_id"> & { sr_no: number } {
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
    warehouse_id: d.warehouse_id,
    serial_numbers: d.serial_numbers ?? [],
  };
}

/**
 * Coverage/warranty suffix shown on a Quotation or Invoice line item, e.g.
 * " — Coverage: 12 Months from Invoice Date". Works for both physical
 * products (warranty) and services such as AMC contracts.
 */
export function coverageSuffix(p: {
  warranty_applicable?: boolean | null;
  warranty_duration?: number | null;
  warranty_unit?: string | null;
  warranty_start_from?: string | null;
  item_type?: string | null;
} | null | undefined): string {
  if (!p?.warranty_applicable || !p.warranty_duration) return "";
  const label = (p.item_type ?? "product") === "service" ? "Coverage" : "Warranty";
  const from = p.warranty_start_from ? ` from ${p.warranty_start_from}` : "";
  return ` — ${label}: ${p.warranty_duration} ${p.warranty_unit || "Months"}${from}`;
}

/**
 * Warranty duration of a product expressed in months, using exactly the same
 * fields/conversion coverageSuffix() reads, so a line's default warranty always
 * matches what coverageSuffix would have shown.
 */
export function productWarrantyMonths(p: {
  warranty_applicable?: boolean | null;
  warranty_duration?: number | null;
  warranty_unit?: string | null;
} | null | undefined): number {
  if (!p?.warranty_applicable || !p.warranty_duration) return 0;
  const unit = String(p.warranty_unit || "Months").toLowerCase();
  const n = Number(p.warranty_duration) || 0;
  if (unit.startsWith("y")) return n * 12;
  if (unit.startsWith("d")) return Math.round(n / 30);
  return n;
}

export function inr(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}