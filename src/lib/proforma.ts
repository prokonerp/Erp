import { supabase } from "@/integrations/supabase/client";
import type { SoItem } from "@/lib/salesOrders";

export type ProformaStatus = "draft" | "issued" | "cancelled";

export type ProformaItem = SoItem;

export type ProformaRow = {
  id: string;
  proforma_no: string | null;
  proforma_date: string;
  branch_id: string | null;
  customer_id: string | null;
  sales_order_id: string | null;
  conversion_id: string | null;
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
  items: ProformaItem[];
  prior_fulfilled: unknown[];
  this_fulfilled: unknown[];
  status: ProformaStatus;
  notes: string | null;
  terms: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  cancelled_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
};

const TBL = "proforma_invoices" as never;

export const emptyProformaItem = (): ProformaItem => ({
  product_id: null,
  description: "",
  hsn: null,
  qty: 1,
  unit: "Nos",
  rate: 0,
  discount_pct: 0,
  gst_rate: 18,
  cess_rate: 0,
  warehouse_id: null,
  serial_numbers: [],
  is_serialized: false,
  part_model_no: null,
  part_name: null,
});

export function isProformaEditable(status: string): boolean {
  return (status || "").trim().toLowerCase() === "draft";
}

export function proformaTotal(items: ProformaItem[]): number {
  return (items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
}

export async function listProformas(): Promise<ProformaRow[]> {
  const { data, error } = await supabase
    .from(TBL)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []) as unknown as ProformaRow[];
  return rows.map(normalizeProforma);
}

export async function fetchProforma(id: string): Promise<ProformaRow> {
  const { data, error } = await supabase.from(TBL).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Proforma Invoice not found");
  return normalizeProforma(data as unknown as ProformaRow);
}

export async function fetchProformasBySO(salesOrderId: string): Promise<ProformaRow[]> {
  const { data, error } = await supabase
    .from(TBL)
    .select("*")
    .eq("sales_order_id", salesOrderId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as ProformaRow[]).map(normalizeProforma);
}

export async function insertProforma(payload: Record<string, unknown>): Promise<ProformaRow> {
  const { data, error } = await supabase.from(TBL).insert(payload as never).select("*").single();
  if (error) throw error;
  return normalizeProforma(data as unknown as ProformaRow);
}

export async function updateProforma(id: string, patch: Record<string, unknown>): Promise<ProformaRow> {
  const { data, error } = await supabase.from(TBL).update(patch as never).eq("id", id).select("*").single();
  if (error) throw error;
  return normalizeProforma(data as unknown as ProformaRow);
}

export async function deleteProforma(id: string): Promise<void> {
  const { error } = await supabase.from(TBL).delete().eq("id", id);
  if (error) throw error;
}

function normalizeProforma(r: ProformaRow): ProformaRow {
  // Ensure items is always an array
  const items = Array.isArray((r as any).items) ? (r as any).items : [];
  return { ...r, items } as ProformaRow;
}
