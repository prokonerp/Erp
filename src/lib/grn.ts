import { supabase } from "@/integrations/supabase/client";

export type GrnCategory = "customer" | "oem" | "general";
export type GrnStatus = "Draft" | "Submitted" | "Cancelled";

export type GrnItem = {
  product_id?: string;
  part_no: string;
  part_name: string;
  description: string;
  uom: string;
  qty_received: string;
  qty_accepted: string;
  qty_rejected: string;
  batch_no: string;
  model_no?: string;
  serial_no?: string;
  condition?: string;
  remarks?: string;
};

export type GrnAttachment = { name: string; url: string };

export type Grn = {
  id: string;
  grn_no: string;
  category: GrnCategory;
  status: GrnStatus;
  grn_date: string;
  receipt_date: string | null;
  reference_no: string | null;
  source_doc_type: string | null;
  source_doc_no: string | null;
  source_doc_date: string | null;
  po_no: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  ticket_no: string | null;
  source_name: string | null;
  source_code: string | null;
  source_address: string | null;
  source_contact_person: string | null;
  source_contact_number: string | null;
  source_email: string | null;
  source_gstin: string | null;
  oem_plant: string | null;
  transporter_name: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_mobile: string | null;
  lr_number: string | null;
  mode_of_transport: string | null;
  num_packages: string | null;
  total_weight: string | null;
  items: GrnItem[];
  qc_status: string | null;
  qc_inspector: string | null;
  qc_date: string | null;
  qc_remarks: string | null;
  accepted_qty: number | null;
  rejected_qty: number | null;
  warehouse_name: string | null;
  storage_location: string | null;
  bin_no: string | null;
  attachments: GrnAttachment[];
  internal_remarks: string | null;
  receipt_remarks: string | null;
  received_by: string | null;
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

export const emptyGrnItem = (): GrnItem => ({
  part_no: "", part_name: "", description: "", uom: "Nos",
  qty_received: "1", qty_accepted: "1", qty_rejected: "0", batch_no: "",
  model_no: "", serial_no: "", condition: "Good", remarks: "",
});

export const CATEGORY_LABEL: Record<GrnCategory, string> = {
  customer: "From Customer",
  oem: "From OEM",
  general: "General",
};

export async function fetchGrns(category: GrnCategory) {
  const { data, error } = await supabase
    .from("grns" as never)
    .select("*").eq("category", category).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as Grn[];
}

export async function fetchAllGrns() {
  const { data, error } = await supabase
    .from("grns" as never)
    .select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as Grn[];
}

export async function fetchGrn(id: string) {
  const { data, error } = await supabase
    .from("grns" as never).select("*").eq("id", id).single();
  if (error) throw error;
  return data as unknown as Grn;
}