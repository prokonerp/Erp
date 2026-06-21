import { supabase } from "@/integrations/supabase/client";

export type ChallanItem = {
  part_no: string;
  part_name: string;
  description: string;
  uom: string;
  qty: string;
  batch_no: string;
  model_no?: string;
  serial_no?: string;
};

export type DocType = "customer" | "oem";
export type ChallanStatus = "Draft" | "Submitted" | "Dispatched" | "Cancelled";

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
  items: ChallanItem[];
  internal_remarks: string | null;
  dispatch_remarks: string | null;
  prepared_by: string | null;
  checked_by: string | null;
  approved_by: string | null;
  oem_logo_url: string | null;
  created_at: string;
};

export const emptyItem = (): ChallanItem => ({
  part_no: "", part_name: "", description: "", uom: "Nos", qty: "1", batch_no: "",
  model_no: "", serial_no: "",
});

export async function fetchChallans(docType: DocType) {
  const { data, error } = await supabase
    .from("delivery_challans" as never)
    .select("*").eq("doc_type", docType).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as unknown as DeliveryChallan[];
}

export async function fetchChallan(id: string) {
  const { data, error } = await supabase
    .from("delivery_challans" as never).select("*").eq("id", id).single();
  if (error) throw error;
  return data as unknown as DeliveryChallan;
}