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

export type GeneralDcStatus = "Draft" | "Issued" | "Converted";

export type GeneralDcRow = {
  id: string;
  dc_no: string | null;
  dc_date: string;
  returnable: boolean;
  customer_id: string | null;
  customer_name: string | null;
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