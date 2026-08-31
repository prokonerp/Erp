import { supabase } from "@/integrations/supabase/client";

/**
 * @deprecated for UI lists — use bounded server queries with explicit cols + limit + useQuery.
 * Kept only for export paths (Excel/PDF) where full table scan is intentional.
 * For pickers/lists, use useCustomersForPicker / useProductsForPicker (25/30 limit, 6-8 cols, debounced 150ms, shouldFilter=false).
 * Fetch ALL rows from a Supabase table, bypassing the default 1000-row cap
 * by paging through with .range() in batches of `pageSize`.
 *
 * Usage:
 *   const rows = await fetchAll("customers", (q) => q.select("*").order("company"));
 */
/**
 * Fetch ALL rows for a Supabase query, bypassing the default 1000-row cap
 * by paging through with .range() in batches of `pageSize`.
 *
 * Usage:
 *   const rows = await fetchAllWith<Grn>((q) => q.from("grns").select("*").order("created_at"));
 */
export async function fetchAllWith<T = any>(
  build: (sbClient: any) => any,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Safety cap to avoid runaway loops
  for (let i = 0; i < 1000; i++) {
    const to = from + pageSize - 1;
    const q = build(supabase).range(from, to);
    const { data, error } = await q;
    if (error) throw error;
    const batch = (data || []) as T[];
    all.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function fetchAll<T = any>(
  table: string,
  build: (q: any) => any,
  pageSize = 1000,
): Promise<T[]> {
  return fetchAllWith<T>((client) => build(client.from(table)), pageSize);
}