import { supabase } from "@/integrations/supabase/client";

export type SoStatus =
  | "draft" | "confirmed" | "partial" | "delivered" | "invoiced" | "cancelled";

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
  taxable_value?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  cess?: number;
  line_total?: number;
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

  status: SoStatus;
  notes: string | null;
  terms: string | null;
  items: SoItem[];

  linked_quote_id: string | null;

  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export const SO_STATUSES: { value: SoStatus; label: string; tone: string }[] = [
  { value: "draft",     label: "Draft",     tone: "bg-slate-200 text-slate-800" },
  { value: "confirmed", label: "Confirmed", tone: "bg-blue-100 text-blue-800" },
  { value: "partial",   label: "Partially Delivered", tone: "bg-amber-100 text-amber-800" },
  { value: "delivered", label: "Delivered", tone: "bg-emerald-100 text-emerald-800" },
  { value: "invoiced",  label: "Invoiced",  tone: "bg-purple-100 text-purple-800" },
  { value: "cancelled", label: "Cancelled", tone: "bg-rose-100 text-rose-700" },
];

export function soStatusMeta(s: SoStatus) {
  return SO_STATUSES.find((x) => x.value === s) ?? SO_STATUSES[0];
}

export async function fetchSalesOrders(): Promise<SalesOrder[]> {
  const { data, error } = await supabase
    .from("sales_orders" as never)
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as SalesOrder[]).map(normalizeSo);
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
  return { ...r, items: Array.isArray(r.items) ? r.items : [] };
}