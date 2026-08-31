import {
  type Quotation,
  groupKeyForThread,
  sortQuotationsForThread,
} from "@/lib/crm";

/**
 * Quotation with its derived thread key. Useful for workspace grouping where
 * multiple leads / orphan threads may be shown together.
 */
export type QuoteWithThread = Quotation & { threadKey: string };

/**
 * Group quotations by thread (lead_id → revision chain fallback).
 * Each group's array is sorted latest-first (revision_no desc, then created_at desc).
 *
 * This helper is intentionally isolated so `crm.leads.$id.tsx` and
 * `crm.quotations.tsx` can share the same grouping without duplicating logic
 * or conflicting on concurrent edits.
 */
export function groupQuotationsByThread(rows: Quotation[]): Map<string, Quotation[]> {
  const map = new Map<string, Quotation[]>();
  for (const q of rows) {
    const key = groupKeyForThread(q);
    const arr = map.get(key);
    if (arr) arr.push(q);
    else map.set(key, [q]);
  }
  for (const [k, arr] of map) {
    arr.sort(sortQuotationsForThread);
    map.set(k, arr);
  }
  return map;
}

/**
 * Convenience: attach threadKey to each row and return a flat sorted list.
 * Useful for single-lead thread views where callers want sorted rows with keys.
 */
export function attachThreadKey(rows: Quotation[]): QuoteWithThread[] {
  return rows
    .map((q) => ({ ...q, threadKey: groupKeyForThread(q) }))
    .sort(sortQuotationsForThread);
}
