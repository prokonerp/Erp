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
  po_number: string | null; // exists in DB (migr 20260910000002)
  po_date: string | null; // exists in DB
  // Print carry-through — exists in DB (migr 20260913000002). If that migration is
  // pending, insert/update degrade via writeWithSchemaColumnFallback (warn, drop, retry).
  payment_terms: string | null;
  salesperson: string | null;
  contact_person: string | null;
  contact_email: string | null;
  contact_mobile: string | null;
  delivery_timeline: string | null;
  sales_type: string | null;
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
  warranty_applicable: null,
  warranty_duration: null,
  warranty_unit: null,
  warranty_start_from: null,
  warranty_months: null,
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

export type ProformasPaginatedParams = {
  page: number;
  pageSize: number;
  search?: string | null;
  status?: ProformaStatus | "all" | null;
};

export async function fetchProformasPage(
  params: ProformasPaginatedParams,
): Promise<{ data: ProformaRow[]; count: number }> {
  const { page, pageSize, search, status } = params;
  const capped = Math.min(Math.max(1, Math.floor(pageSize || 25)), 50);
  const from = page * capped;
  const to = from + capped - 1;

  let q: any = supabase
    .from(TBL)
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (status && status !== "all") {
    q = q.eq("status", status);
  }

  if (search && search.trim()) {
    const safe = search.trim().replace(/[%_\\]/g, "\\$&").replace(/[,()]/g, "\\$&");
    q = q.or(`proforma_no.ilike.%${safe}%,buyer_name.ilike.%${safe}%`);
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { data: ((data ?? []) as unknown as ProformaRow[]).map(normalizeProforma), count: count ?? 0 };
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
  const data = await writeWithSchemaColumnFallback<ProformaRow>(payload, (p) =>
    supabase.from(TBL).insert(p as never).select("*").single(),
  );
  return normalizeProforma(data);
}

export async function updateProforma(id: string, patch: Record<string, unknown>): Promise<ProformaRow> {
  const data = await writeWithSchemaColumnFallback<ProformaRow>(patch, (p) =>
    supabase.from(TBL).update(p as never).eq("id", id).select("*").single(),
  );
  return normalizeProforma(data);
}

// ── Schema-drift guard ────────────────────────────────────────────────────────
// PostgREST rejects a payload key that is not in the live schema cache with
// "Could not find the '<col>' column of '<table>' in the schema cache" (400) —
// i.e. app code ships print carry-through columns ahead of their migration
// (see docs/runbooks/proforma-columns-pending-migration.md). Instead of failing
// the WHOLE document write, drop exactly that one key and retry (bounded by
// payload size — one column is reported per attempt), loudly. Any error that is
// not this message propagates unchanged.

type SchemaWriteError = { code?: string | null; message?: string | null };
type SchemaWriteResult<T> = PromiseLike<{ data: T | null; error: SchemaWriteError | null }>;

const UNKNOWN_COLUMN_RE = /Could not find the '([^']+)' column/i;

export async function writeWithSchemaColumnFallback<T>(
  payload: Record<string, unknown>,
  run: (p: Record<string, unknown>) => SchemaWriteResult<T>,
): Promise<T> {
  let current = payload;
  // Each retry drops exactly one key → payload size is the hard upper bound.
  const maxAttempts = Math.max(1, Object.keys(payload).length);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, error } = await run(current);
    if (!error) return data as T;
    const missing = UNKNOWN_COLUMN_RE.exec(error.message ?? "")?.[1];
    if (!missing || !(missing in current)) throw error;
    console.warn(
      `[proforma] schema drift: column '${missing}' not in DB schema cache — dropped it and retried (migration pending? see docs/runbooks/proforma-columns-pending-migration.md)`,
    );
    const { [missing]: _dropped, ...rest } = current;
    current = rest;
  }
  throw new Error("proforma write: payload has no known columns left after schema-drift drops");
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
