import { supabase } from "@/integrations/supabase/client";

export type GeneralDcItem = {
  product_id: string | null;
  part_name: string | null;
  model_no: string | null;
  hsn: string | null;
  uom: string;
  qty: number;
  unit_price: number;
  warehouse_id: string | null;
  is_serialized: boolean;
  serial_numbers: string[];
};

export type GeneralDcStatus = "Draft" | "Issued" | "Converted" | "Cancelled";

export type GeneralDcRow = {
  id: string;
  dc_no: string | null;
  dc_date: string;
  returnable: boolean;
  customer_id: string | null;
  customer_name: string | null;
  expected_return_date?: string | null;
  returned_at?: string | null;
  returned_by?: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  purpose: string | null;
  branch_id: string | null;
  items: GeneralDcItem[];
  status: GeneralDcStatus;
  converted_invoice_id: string | null;
  allow_negative_stock: boolean;
  notes: string | null;
  terms: string | null;
  cancelled_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_by: string | null;
  created_at: string;
};

export const emptyGeneralDcItem = (): GeneralDcItem => ({
  product_id: null,
  part_name: null,
  model_no: null,
  hsn: null,
  uom: "Nos",
  qty: 1,
  unit_price: 0,
  warehouse_id: null,
  is_serialized: false,
  serial_numbers: [],
});

const TBL = "general_delivery_challans" as never;

export async function listGeneralDcs(): Promise<GeneralDcRow[]> {
  const { data, error } = await supabase
    .from(TBL)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as GeneralDcRow[];
}

export async function getGeneralDc(id: string): Promise<GeneralDcRow> {
  const { data, error } = await supabase.from(TBL).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("General Delivery Challan not found");
  return data as unknown as GeneralDcRow;
}

export async function insertGeneralDc(payload: Record<string, unknown>): Promise<GeneralDcRow> {
  const { data, error } = await supabase.from(TBL).insert(payload as never).select("*").single();
  if (error) throw error;
  return data as unknown as GeneralDcRow;
}

export async function updateGeneralDc(id: string, patch: Record<string, unknown>): Promise<GeneralDcRow> {
  const { data, error } = await supabase.from(TBL).update(patch as never).eq("id", id).select("*").single();
  if (error) throw error;
  return data as unknown as GeneralDcRow;
}

export async function deleteGeneralDc(id: string): Promise<void> {
  const { error } = await supabase.from(TBL).delete().eq("id", id);
  if (error) throw error;
}

/** Cancel an issued challan — the DB reverses all posted stock. */
export async function cancelGeneralDc(id: string, reason: string): Promise<GeneralDcRow> {
  return updateGeneralDc(id, { status: "Cancelled", cancelled_reason: reason });
}

export const GDC_PREFILL_KEY = "invoice:prefill:from-general-dc";

export type GeneralDcInvoicePrefill = {
  general_dc_id: string;
  general_dc_no: string | null;
  skip_stock_posting: true;
  customer_id: string | null;
  billing_address: string | null;
  shipping_address: string | null;
  branch_id: string | null;
  notes: string | null;
  terms: string | null;
  items: {
    product_id: string | null;
    description: string;
    hsn: string;
    qty: number;
    unit: string;
    rate: number;
    warehouse_id: string | null;
    serial_numbers: string[];
    is_serialized: boolean;
    part_model_no: string | null;
    part_name: string | null;
  }[];
};

export function gdcTotal(items: GeneralDcItem[]): number {
  return items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit_price) || 0), 0);
}

/** Reference string that links a Return GRN back to its General DC. */
export const gdcReturnRef = (dcNo: string | null) => `GDC ${dcNo ?? ""}`.trim();

/** Live "is returned" check — mirrors the Indent/Oracle GRN linkage rule:
 *  a settled GRN is one with status Submitted or Closed (Cancelled ignored).
 *  Returns the set of DC numbers that already have a settled Customer GRN. */
export async function fetchReturnedDcNos(dcNos: string[]): Promise<Set<string>> {
  const refs = dcNos.filter(Boolean).map((n) => gdcReturnRef(n));
  if (refs.length === 0) return new Set();
  const { data, error } = await supabase
    .from("grns" as never)
    .select("reference_no,status,category")
    .eq("category", "customer")
    .in("reference_no", refs);
  if (error) throw error;
  const out = new Set<string>();
  for (const r of (data ?? []) as unknown as { reference_no: string | null; status: string | null }[]) {
    if (!docStatusSettled(r.status)) continue;
    const ref = (r.reference_no || "").trim();
    if (ref.startsWith("GDC ")) out.add(ref.slice(4).trim());
  }
  return out;
}

/** True when this General DC already has a settled Customer Return GRN. */
export async function isGdcReturned(dcNo: string | null): Promise<boolean> {
  if (!dcNo) return false;
  return (await fetchReturnedDcNos([dcNo])).has(dcNo);
}

export const GRN_CUSTOMER_PREFILL_KEY = "grn:prefill:new-customer";

/** Build the Return GRN prefill payload (same shape the Indent → Section D
 *  flow writes), one line per General DC item, condition editable per row. */
export function buildReturnGrnPrefill(dc: GeneralDcRow, warehouseNames: Record<string, string> = {}) {
  const items = (dc.items || []).flatMap((it) => {
    const base = {
      product_id: it.product_id ?? undefined,
      part_no: it.model_no || "",
      part_name: it.part_name || it.model_no || "",
      description: "",
      uom: it.uom || "Nos",
      batch_no: "",
      model_no: it.model_no || undefined,
      condition: "Good",
      remarks: "",
      warehouse_id: it.warehouse_id || undefined,
      warehouse_name: it.warehouse_id ? warehouseNames[it.warehouse_id] : undefined,
    };
    if (it.is_serialized && (it.serial_numbers || []).length > 0) {
      return (it.serial_numbers || []).map((sn) => ({
        ...base, serial_no: sn, qty_received: "1", qty_accepted: "1", qty_rejected: "0",
      }));
    }
    const q = String(Math.max(0, Number(it.qty) || 0));
    return [{ ...base, serial_no: "", qty_received: q, qty_accepted: q, qty_rejected: "0" }];
  });
  return {
    source: "general_dc",
    general_dc_id: dc.id,
    customer_id: dc.customer_id,
    reference_no: gdcReturnRef(dc.dc_no),
    source_doc_type: "Customer Return",
    source_doc_no: dc.dc_no || "",
    source_doc_date: dc.dc_date || "",
    internal_remarks: `Return against General DC ${dc.dc_no ?? ""}`.trim(),
    items,
  };
}

/** Store the prefill and hand off to the Customer GRN creation screen. */
export function stageReturnGrnPrefill(dc: GeneralDcRow, warehouseNames: Record<string, string> = {}) {
  try {
    sessionStorage.setItem(GRN_CUSTOMER_PREFILL_KEY, JSON.stringify(buildReturnGrnPrefill(dc, warehouseNames)));
  } catch { /* noop */ }
}

/** Overdue = returnable, still out, and the expected return date has passed. */
export function isReturnOverdue(dc: GeneralDcRow): boolean {
  if (!dc.expected_return_date) return false;
  return dc.expected_return_date < new Date().toISOString().slice(0, 10);
}