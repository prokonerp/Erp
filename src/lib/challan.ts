import { supabase } from "@/integrations/supabase/client";
import { fetchAllWith } from "@/lib/fetchAll";

export type ChallanItem = {
  product_id?: string;
  part_no: string;
  part_name: string;
  description: string;
  uom: string;
  qty: string;
  model_no?: string;
  serial_no?: string;
  // Unified DC fields (optional; used depending on DC Type)
  oem_ref_id?: string;
  oracle_no?: string;
  hsn?: string;
  unit_price?: string;
  weight_kg?: string;
  // OEM-specific
  stock_type?: string; // Good / Defective
  good_defective_serial?: string;
  good_return_reason?: string;
  // Customer-specific
  defective_model?: string;
  defective_serial?: string;
  good_model?: string;
  good_serial?: string;
};

export type DocType = "customer" | "oem";
export type ChallanStatus = "Draft" | "Submitted" | "Cancelled";

export type DeliveryChallan = {
  id: string;
  challan_no: string;
  doc_type: DocType;
  status: ChallanStatus;
  challan_date: string;
  dispatch_date: string | null;
  reference_no: string | null;
  gate_pass_no: string | null;
  sales_order_no: string | null;
  customer_po_no: string | null;
  invoice_no: string | null;
  party_name: string | null;
  party_code: string | null;
  gstin: string | null;
  oem_plant: string | null;
  contact_person: string | null;
  contact_number: string | null;
  email: string | null;
  delivery_address: string | null;
  transporter_name: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_mobile: string | null;
  lr_number: string | null;
  mode_of_transport: string | null;
  num_packages: string | null;
  total_weight: string | null;
  city: string | null;
  state: string | null;
  pin_code: string | null;
  items: ChallanItem[];
  internal_remarks: string | null;
  dispatch_remarks: string | null;
  prepared_by: string | null;
  checked_by: string | null;
  approved_by: string | null;
  oem_logo_url: string | null;
  created_at: string;
  created_by: string | null;
  submitted_at?: string | null;
  submitted_by?: string | null;
  printed_at?: string | null;
  printed_by?: string | null;
};

export const emptyItem = (): ChallanItem => ({
  part_no: "", part_name: "", description: "", uom: "Nos", qty: "1",
  model_no: "", serial_no: "",
});

export async function fetchChallans(docType: DocType) {
  // B-11: page past the 1000-row server cap.
  return fetchAllWith<DeliveryChallan>((q) =>
    q.from("delivery_challans").select("*").eq("doc_type", docType).order("created_at", { ascending: false }));
}

export async function fetchAllChallans() {
  // B-11: page past the 1000-row server cap.
  return fetchAllWith<DeliveryChallan>((q) =>
    q.from("delivery_challans").select("*").order("created_at", { ascending: false }));
}

export async function fetchUserNameMap(ids: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data, error } = await supabase
    .from("app_users")
    .select("user_id,name,email")
    .in("user_id", unique);
  if (error) return {};
  const map: Record<string, string> = {};
  for (const u of data || []) map[(u as any).user_id] = (u as any).name || (u as any).email || "";
  return map;
}

export async function fetchChallan(id: string) {
  const { data, error } = await supabase
    .from("delivery_challans" as never).select("*").eq("id", id).single();
  if (error) throw error;
  return data as unknown as DeliveryChallan;
}