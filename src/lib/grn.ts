import { supabase } from "@/integrations/supabase/client";
import { fetchAllWith } from "@/lib/fetchAll";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { grnKeys } from "@/lib/queryKeys";

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
  /** One serial number per received unit. Serialized rows must have
   *  serials.length === qty so inventory creates one row per unit. */
  serials?: string[];
  condition?: string;
  remarks?: string;
  /** Per-row warehouse mapping — populated when GRN is generated from an
   *  Indent so that each material row inherits the warehouse chosen on the
   *  matching Indent Section C / D row. */
  warehouse_id?: string;
  warehouse_name?: string;
  /** Per-row Material Rec Date mirrored from Indent Section C / D. */
  received_date?: string;
  /** Oracle # from the source Indent row — primary mapping key that keeps
   *  each GRN line item linked one-to-one to its Indent record. */
  oracle_no?: string;
};

export type GrnAttachment = { name: string; url: string };

export type Grn = {
  id: string;
  grn_no: string;
  category: GrnCategory;
  status: GrnStatus;
  branch_id?: string | null;
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

/**
 * @deprecated for lists — use useGrnsPaginated / fetchGrnsPage with server pagination.
 * Kept only for exports / legacy callers. Do not use for UI lists.
 */
export async function fetchGrns(category: GrnCategory) {
  // B-11: page past the 1000-row server cap.
  return fetchAllWith<Grn>((q) =>
    q.from("grns").select("*").eq("category", category).order("created_at", { ascending: false }));
}

/**
 * @deprecated for lists — use useGrnsPaginated / fetchGrnsPage with server pagination.
 * Kept only for exports (Excel/PDF) that need the full dataset.
 */
export async function fetchAllGrns() {
  // B-11: page past the 1000-row server cap.
  return fetchAllWith<Grn>((q) =>
    q.from("grns").select("*").order("created_at", { ascending: false }));
}

// ── Paginated (server-side) ───────────────────────────────────────────────

export type GrnPaginatedParams = {
  page: number;
  pageSize: number;
  category?: GrnCategory | "all" | null;
  status?: string | null;
  search?: string | null;
  sourceName?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
};

export async function fetchGrnsPage(
  params: GrnPaginatedParams,
): Promise<{ data: Grn[]; count: number }> {
  const { page, pageSize, category, status, search, sourceName, fromDate, toDate } = params;
  const from = page * pageSize;
  const to = from + pageSize - 1;

  let q: any = supabase
    .from("grns" as never)
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (category && category !== "all") q = q.eq("category", category);
  if (status && status !== "all") q = q.eq("status", status);
  if (sourceName && sourceName !== "all") q = q.eq("source_name", sourceName);
  if (fromDate) q = q.gte("grn_date", fromDate);
  if (toDate) q = q.lte("grn_date", toDate);
  if (search && search.trim()) {
    const s = search.trim().replace(/%/g, "");
    q = q.or(`grn_no.ilike.%${s}%,source_name.ilike.%${s}%,reference_no.ilike.%${s}%,source_doc_no.ilike.%${s}%`);
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { data: (data || []) as Grn[], count: count ?? 0 };
}

export function useGrnsPaginated(params: GrnPaginatedParams) {
  return useQuery({
    queryKey: grnKeys.paginated(params as unknown as Record<string, unknown> & { page: number; pageSize: number }),
    queryFn: () => fetchGrnsPage(params),
    placeholderData: keepPreviousData,
  });
}

export async function fetchGrn(id: string) {
  const { data, error } = await supabase
    .from("grns" as never).select("*").eq("id", id).single();
  if (error) throw error;
  return data as unknown as Grn;
}