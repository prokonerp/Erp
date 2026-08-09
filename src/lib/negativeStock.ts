import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserName } from "@/lib/currentUser";

/**
 * Shared availability checks for NON-SERIALIZED products.
 * Mirrors the FIFO deduction in `public.ims_deduct_qty`: only pooled
 * (part_serial_no IS NULL) rows with stock_status = 'available' count.
 */

export type StockLine = {
  /** Product model no (products.model / part_model_no) */
  model: string;
  /** Label shown to the user (short name / description) */
  label?: string | null;
  /** Warehouse to scope to; null = across all warehouses (DC behaviour) */
  warehouseId?: string | null;
  warehouseName?: string | null;
  qty: number;
  stockType?: "good" | "defective";
};

export type Shortfall = StockLine & {
  available: number;
  shortfall: number;
};

/** Available pooled quantity for a model (optionally scoped to a warehouse). */
export async function availableQty(
  model: string,
  warehouseId?: string | null,
  stockType: "good" | "defective" = "good",
): Promise<number> {
  let q = supabase
    .from("ims_stock_items")
    .select("qty")
    .eq("part_model_no", model)
    .eq("stock_type", stockType)
    .eq("stock_status", "available")
    .is("part_serial_no", null);
  if (warehouseId) q = q.eq("warehouse_id", warehouseId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).reduce((s, r) => s + (Number((r as { qty: number }).qty) || 0), 0);
}

/** Aggregate requested quantity per model+warehouse and return only the short ones. */
export async function findShortfalls(lines: StockLine[]): Promise<Shortfall[]> {
  const grouped = new Map<string, StockLine>();
  for (const l of lines) {
    const model = (l.model || "").trim();
    if (!model || !l.qty || l.qty <= 0) continue;
    const key = `${model.toLowerCase()}|${l.warehouseId || ""}|${l.stockType || "good"}`;
    const prev = grouped.get(key);
    if (prev) prev.qty += l.qty;
    else grouped.set(key, { ...l, model, qty: l.qty });
  }
  const out: Shortfall[] = [];
  for (const l of grouped.values()) {
    const available = await availableQty(l.model, l.warehouseId, l.stockType || "good");
    if (available < l.qty) out.push({ ...l, available, shortfall: l.qty - available });
  }
  return out;
}

/** Audit every approved oversell against a posted document. */
export async function logNegativeOverrides(input: {
  documentType: "invoice" | "dc";
  documentId?: string | null;
  documentNo?: string | null;
  shortfalls: Shortfall[];
  reason?: string | null;
}): Promise<void> {
  if (input.shortfalls.length === 0) return;
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id ?? null;
  if (!uid) return;
  const name = await getCurrentUserName().catch(() => "");
  const rows = input.shortfalls.map((s) => ({
    document_type: input.documentType,
    document_id: input.documentId ?? null,
    document_no: input.documentNo ?? null,
    product_model: s.model,
    warehouse_id: s.warehouseId ?? null,
    requested_qty: s.qty,
    available_qty: s.available,
    resulting_negative_qty: -s.shortfall,
    overridden_by: uid,
    overridden_by_name: name || null,
    reason: input.reason || null,
  }));
  const { error } = await supabase.from("stock_negative_overrides" as never).insert(rows as never);
  if (error) throw error;
}

export type NegativeOverrideRow = {
  id: string;
  document_type: string;
  document_id: string | null;
  document_no: string | null;
  product_model: string;
  warehouse_id: string | null;
  requested_qty: number;
  available_qty: number;
  resulting_negative_qty: number;
  overridden_by_name: string | null;
  overridden_at: string;
  reason: string | null;
};

export async function listNegativeOverrides(): Promise<NegativeOverrideRow[]> {
  const { data, error } = await supabase
    .from("stock_negative_overrides" as never)
    .select("*")
    .order("overridden_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []) as unknown as NegativeOverrideRow[];
}

/** Message for staff without override rights. */
export function blockMessage(s: Shortfall): string {
  return `Insufficient stock: only ${s.available} available, ${s.qty} requested${
    s.label ? ` for ${s.label}` : ""
  }. Contact an admin to proceed.`;
}

/** Class names for a stock quantity cell — negatives are a backorder signal. */
export function qtyCellClass(n: number | undefined | null): string {
  return typeof n === "number" && n < 0
    ? "text-destructive font-semibold bg-destructive/10"
    : "";
}
