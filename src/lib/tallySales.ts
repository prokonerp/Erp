import { supabase } from "@/integrations/supabase/client";
import type { TallyBranchRow, TallyInvoiceItemRow, TallyInvoiceRow } from "@/lib/tallyExport";

/**
 * Sales-side data loader for the Tally XML/CSV export.
 *
 * Deliberately separate from `tallyLedger.ts`, which is a STOCK-side reader:
 * that module reconstructs vouchers from inventory movements, while this one
 * reads the posted sales invoice + its own lines — the same rows the customer
 * holds and the IRN was generated against.
 *
 * The fetch is intentionally dumb about correctness. Cancelled invoices are
 * NOT filtered here; `buildSalesExport` owns that decision so the export result
 * can report `skippedCancelled` rather than silently shrinking the batch.
 */

export type TallySalesRange = {
  /** ISO YYYY-MM-DD inclusive. */
  from: string;
  /** ISO YYYY-MM-DD inclusive. */
  to: string;
  /** Restrict to one branch; `null`/`undefined`/`"__all"` means every branch. */
  branchId?: string | null;
};

export type TallySalesData = {
  invoices: TallyInvoiceRow[];
  /** Line items keyed by `invoice_id`, each list ordered by `sr_no`. */
  itemsByInvoice: Map<string, TallyInvoiceItemRow[]>;
  /** Every branch, keyed by id — also the source for the branch filter options. */
  branchesById: Map<string, TallyBranchRow>;
};

const ALL_BRANCHES = "__all";

/** `undefined`/sentinel → no branch filter, so the query omits `.eq()`. */
function branchFilter(branchId: string | null | undefined): string | null {
  if (!branchId || branchId === ALL_BRANCHES) return null;
  return branchId;
}

/**
 * Load invoices in an inclusive date range with their line items and the branch
 * master. Runs the item + branch reads in parallel with the invoice read only
 * where it is safe — the item read depends on the invoice ids, so it follows.
 */
export async function fetchInvoicesForTally(range: TallySalesRange): Promise<TallySalesData> {
  const from = range.from;
  const to = range.to;
  const branch = branchFilter(range.branchId);

  if (!from || !to) throw new Error("Both a from and a to date are required");
  if (from > to) throw new Error(`From date ${from} is after to date ${to}`);

  let invQ = supabase
    .from("invoices")
    .select("*")
    .gte("invoice_date", from)
    .lte("invoice_date", to)
    .order("invoice_date", { ascending: true })
    .order("invoice_no", { ascending: true });
  if (branch) invQ = invQ.eq("branch_id", branch);

  const { data: invRows, error: invErr } = await invQ;
  if (invErr) throw new Error(`Could not load invoices: ${invErr.message}`);
  const invoices = (invRows ?? []) as unknown as TallyInvoiceRow[];

  // Branches: the full master, not just the referenced ones — the export needs
  // a name for every `branch_id` that appears, and the UI needs the full list
  // to render the "All branches" filter even before a range is exported.
  const { data: branchRows, error: branchErr } = await supabase
    .from("branches")
    .select("id,name,code,gstin")
    .order("name", { ascending: true });
  if (branchErr) throw new Error(`Could not load branches: ${branchErr.message}`);

  const branchesById = new Map<string, TallyBranchRow>();
  for (const b of (branchRows ?? []) as unknown as TallyBranchRow[]) {
    branchesById.set(b.id, b);
  }

  const itemsByInvoice = new Map<string, TallyInvoiceItemRow[]>();
  const ids = invoices.map((i) => i.id);
  if (ids.length > 0) {
    // `.in()` is chunked: a fiscal-year range can carry more ids than one
    // request carries safely, and an unchunked list silently returns nothing
    // past the URL limit.
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const { data: itemRows, error: itemErr } = await supabase
        .from("invoice_items")
        .select("*")
        .in("invoice_id", chunk)
        .order("sr_no", { ascending: true });
      if (itemErr) throw new Error(`Could not load invoice items: ${itemErr.message}`);

      for (const row of (itemRows ?? []) as unknown as (TallyInvoiceItemRow & {
        invoice_id?: string | null;
      })[]) {
        const key = row.invoice_id;
        if (!key) continue;
        const { invoice_id: _drop, ...item } = row;
        const list = itemsByInvoice.get(key);
        if (list) list.push(item);
        else itemsByInvoice.set(key, [item]);
      }
    }
  }

  return { invoices, itemsByInvoice, branchesById };
}

/** Branch master for the filter select, ordered by name. */
export function branchOptions(branchesById: Map<string, TallyBranchRow>) {
  return [...branchesById.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export { ALL_BRANCHES };
