// Generic Product Bundle engine.
// Any product in Product Master can define a set of child products (with
// default qty, mandatory flag and editable-qty flag) that should be
// suggested when the parent is added to a Quotation or Invoice.
//
// This module is intentionally self-contained: it exposes fetchers,
// hooks and helpers, but never mutates line items itself. The consumer
// (quote editor, invoice form, future modules) decides how to append
// children into its own row shape.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ProductMaster } from "@/components/ProductPicker";

export type BundleChildRow = {
  id: string;
  parent_product_id: string;
  child_product_id: string;
  default_qty: number;
  mandatory: boolean;
  editable_qty: boolean;
  sort_order: number;
  note: string | null;
  child?: ProductMaster | null;
};

// Fetch the raw bundle rows for a parent product (no join).
export async function fetchBundleChildrenRaw(parentId: string): Promise<BundleChildRow[]> {
  const { data, error } = await supabase
    .from("product_bundles" as any)
    .select("*")
    .eq("parent_product_id", parentId)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return ((data ?? []) as unknown as BundleChildRow[]);
}

// Fetch bundle rows joined with the child product master.
export async function fetchBundleChildren(parentId: string): Promise<BundleChildRow[]> {
  const rows = await fetchBundleChildrenRaw(parentId);
  const childIds = Array.from(new Set(rows.map((r) => r.child_product_id)));
  if (!childIds.length) return rows;
  const { data: products } = await supabase
    .from("products")
    .select("*")
    .in("id", childIds);
  const map = new Map<string, ProductMaster>(
    ((products ?? []) as unknown as ProductMaster[]).map((p) => [p.id, p]),
  );
  return rows.map((r) => ({ ...r, child: map.get(r.child_product_id) || null }));
}

// React hook: fetch bundle children on demand for a parent product id.
export function useBundleChildren(parentId: string | null | undefined) {
  const [rows, setRows] = useState<BundleChildRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!parentId) { setRows([]); return; }
    setLoading(true);
    fetchBundleChildren(parentId)
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [parentId]);
  return { rows, loading };
}

// Persist the entire bundle definition for a parent (replace-all).
export async function saveBundleForParent(
  parentId: string,
  children: Array<{
    child_product_id: string;
    default_qty: number;
    mandatory: boolean;
    editable_qty: boolean;
    sort_order?: number;
    note?: string | null;
  }>,
): Promise<void> {
  const { error: delErr } = await supabase
    .from("product_bundles" as any)
    .delete()
    .eq("parent_product_id", parentId);
  if (delErr) throw delErr;
  if (!children.length) return;
  const payload = children.map((c, i) => ({
    parent_product_id: parentId,
    child_product_id: c.child_product_id,
    default_qty: Number(c.default_qty) || 1,
    mandatory: !!c.mandatory,
    editable_qty: c.editable_qty !== false,
    sort_order: c.sort_order ?? i,
    note: c.note ?? null,
  }));
  const { error } = await supabase.from("product_bundles" as any).insert(payload as any);
  if (error) throw error;
}

// Selection state used by the "apply bundle" dialog.
export type BundleSelection = {
  row: BundleChildRow;
  include: boolean; // false means user opted out (only optional rows)
  qty: number;
};

export function initialSelections(rows: BundleChildRow[]): BundleSelection[] {
  return rows.map((r) => ({
    row: r,
    include: true,
    qty: Number(r.default_qty) || 1,
  }));
}

// Scale selection quantities by the parent quantity — useful when the user
// enters "2 UPS" and expects 2× batteries/rack per unit.
export function scaleSelections(sels: BundleSelection[], parentQty: number): BundleSelection[] {
  const q = Math.max(1, Number(parentQty) || 1);
  return sels.map((s) => ({ ...s, qty: (Number(s.row.default_qty) || 1) * q }));
}