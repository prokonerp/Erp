import { supabase } from "@/integrations/supabase/client";
import { fetchAllWith } from "@/lib/fetchAll";
import type { Transaction, TxnType } from "@/lib/ims";
import { TXN_TYPE_LABEL } from "@/lib/ims";

/**
 * Tally-style Stock Ledger data helpers.
 *
 * This module is intentionally isolated — it does not mutate `ims.ts` and does
 * not touch any UI component. It provides pure computation plus two Supabase
 * fetchers that downstream Tally UI can consume directly.
 *
 * Supabase tables touched:
 *  - `ims_transactions` (via fetchTallyTransactions / computeTallyLedger)
 *  - `grns` (grn_no), `delivery_challans` (challan_no),
 *    `general_delivery_challans` (dc_no), `invoices` (invoice_no),
 *    `ims_transfers` (transfer_no / id) via fetchVoucherDocument
 */

const sb = supabase as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (t: string) => any;
};

// ---------------------------------------------------------------------------
// Constants — keep in sync with src/routes/_app/ims.ledger.tsx
// ---------------------------------------------------------------------------

/** Transaction types that increase stock. */
export const IN_TYPES: TxnType[] = [
  "good_in",
  "defective_in",
  "transfer_in",
  "oem_replacement_receipt",
];

/** Transaction types that decrease stock. */
export const OUT_TYPES: TxnType[] = [
  "good_out",
  "defective_out",
  "transfer_out",
  "oem_return",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Monthly aggregate for the Tally ledger.
 * `key` is `YYYY-MM` (lexically sortable, chronological).
 * `label` is locale formatted e.g. `April 2025` via `en-IN`.
 * `opening` = running balance at start of month.
 * `closing` = running balance at end of month.
 */
export type TallyMonth = {
  /** `YYYY-MM` */
  key: string;
  /** e.g. `April 2025` (en-IN) */
  label: string;
  year: number;
  month: number; // 1-12
  opening: number;
  inwards: number;
  outwards: number;
  closing: number;
  count: number;
};

/**
 * Transaction enriched for Tally display.
 * Extends the raw `Transaction` with computed running balance and
 * voucher-type helpers used by the Tally UI.
 */
export type TallyVoucher = Transaction & {
  /** Warehouse this txn is accounted against (to_wh for inwards, from_wh for outwards). */
  warehouse_id: string | null;
  /** Direction derived from txn_type + warehouse fields. */
  direction: "in" | "out" | "adj";
  /** Quantity counted as inward (0 if outward/adj). */
  stock_in: number;
  /** Quantity counted as outward (0 if inward/adj). */
  stock_out: number;
  /** Running balance after this voucher (per-product aggregate, not per-warehouse). */
  running: number;
  /** Human label for voucher type (from TXN_TYPE_LABEL). */
  voucherTypeLabel: string;
  /** Human-readable particulars (part + party + reference/notes). */
  particulars: string;
  /** Raw document reference (`reference` column) — used for voucher navigation. */
  docRef: string | null;
};

// ---------------------------------------------------------------------------
// Helpers — parseReference / monthKey / monthLabel
// ---------------------------------------------------------------------------

/**
 * Parse the `reference` column (`GRN G-001`, `DC DC-005`, `GDC GDC-001`,
 * `Invoice INV-...` etc.) into its prefix and document number.
 *
 * - `"GRN GRN-CUST/26-27/0001"` → `{prefix:"GRN", number:"GRN-CUST/26-27/0001"}`
 * - `"Invoice INV-2026/0001"`   → `{prefix:"Invoice", number:"INV-2026/0001"}`
 * - `null` / `""`               → `{prefix:null, number:null}`
 * - No space (e.g. `"PHS/IMT/123"`) → heuristic split via regex fallback
 */
export function parseReference(
  reference: string | null,
): { prefix: string | null; number: string | null } {
  if (!reference) return { prefix: null, number: null };
  const trimmed = reference.trim();
  if (!trimmed) return { prefix: null, number: null };

  const firstSpace = trimmed.search(/\s/);
  if (firstSpace !== -1) {
    const prefix = trimmed.slice(0, firstSpace).trim();
    const number = trimmed.slice(firstSpace + 1).trim();
    return { prefix: prefix || null, number: number || null };
  }

  // No whitespace — try to split known prefixed tokens without a space
  // e.g. "GRN-CUST/26-27/0001" or "PHS/IMT/17062617100001"
  const m = trimmed.match(/^(GRN|GDC|DC|Invoice|INV|PHS\/IMT)(.+)?$/i);
  if (m) {
    const prefix = (m[1] || "").trim();
    const rest = (m[2] || "").trim().replace(/^[\s:\-]+/, "");
    return { prefix: prefix || null, number: rest || null };
  }

  return { prefix: trimmed || null, number: null };
}

/**
 * Derive `YYYY-MM` key from an ISO date string.
 * Falls back to `1970-01` for invalid dates (should not happen with DB data).
 */
export function monthKey(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return "1970-01";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Locale label for a year+month, e.g. `April 2025`.
 * Uses `en-IN` so month names match the rest of the app.
 */
export function monthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/**
 * Convenience: label directly from a `YYYY-MM` key.
 * Returns `"—"` for malformed keys.
 */
export function monthKeyToLabel(key: string): string {
  const parts = key.split("-");
  if (parts.length !== 2) return key || "—";
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return key;
  return monthLabel(y, m);
}

// ---------------------------------------------------------------------------
// classifyTxnForTally
// ---------------------------------------------------------------------------

/**
 * Classify a transaction for Tally accounting.
 *
 * - `IN_TYPES`  → `{wh: to_warehouse_id, dir:"in"}`
 * - `OUT_TYPES` → `{wh: from_warehouse_id, dir:"out"}`
 * - `stock_adjustment` / `scrap_adjustment` (and any future type) →
 *   picks whichever warehouse is set; if both are null → `adj` with no balance effect.
 *
 * Mirrors `classifyTxn` in `src/routes/_app/ims.ledger.tsx` but returns the
 * Tally-specific direction union `"in" | "out" | "adj"`.
 */
export function classifyTxnForTally(t: Transaction): {
  wh: string | null;
  dir: "in" | "out" | "adj";
} {
  if (IN_TYPES.includes(t.txn_type)) return { wh: t.to_warehouse_id, dir: "in" };
  if (OUT_TYPES.includes(t.txn_type)) return { wh: t.from_warehouse_id, dir: "out" };
  const wh = t.to_warehouse_id || t.from_warehouse_id || null;
  // `adj` only when neither warehouse is set; otherwise treat as in/out by presence
  const dir: "in" | "out" | "adj" = t.to_warehouse_id
    ? "in"
    : t.from_warehouse_id
      ? "out"
      : "adj";
  return { wh, dir };
}

// ---------------------------------------------------------------------------
// computeTallyLedger
// ---------------------------------------------------------------------------

function buildParticulars(t: Transaction, wh: string | null, dir: "in" | "out" | "adj"): string {
  const baseParts = [
    t.part_name || "",
    t.part_model_no ? `/ ${t.part_model_no}` : "",
    t.part_serial_no ? `#${t.part_serial_no}` : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  // Counter-party: from for inwards, to for outwards
  let party = "";
  if (dir === "in") {
    party = t.from_party || (t.from_warehouse_id ? `WH ${t.from_warehouse_id.slice(0, 8)}` : "");
  } else if (dir === "out") {
    party = t.to_party || (t.to_warehouse_id ? `WH ${t.to_warehouse_id.slice(0, 8)}` : "");
  } else {
    party = t.from_party || t.to_party || wh || "";
  }

  const bits = [baseParts, party ? (dir === "in" ? `From ${party}` : dir === "out" ? `To ${party}` : party) : "", t.notes || ""]
    .filter(Boolean)
    .join(" · ")
    .trim();

  // Fallback to reference / warehouse when no descriptive bits
  return bits || t.reference || wh || "—";
}

/**
 * Compute Tally vouchers and monthly aggregates from a raw transaction list.
 *
 * - Sorts ascending by `txn_date` (then `txn_no`, then `id` for determinism).
 * - Derives `warehouse_id`, `direction`, `stock_in`, `stock_out`, `running` per voucher.
 * - Running balance starts at `openingOverride` (default `0`) — this is the
 *   per-product aggregate balance, **not** per-warehouse. When the caller
 *   scopes by warehouse (see `fetchTallyTransactions`), pass the product's
 *   opening stock as override if available.
 * - Groups vouchers by calendar month (`YYYY-MM`) to produce `TallyMonth[]`
 *   sorted ascending chronological. Month `opening` is the balance before the
 *   first voucher in that month (equals previous month's `closing`), `closing`
 *   is the running balance after the last voucher in that month, and
 *   `inwards`/`outwards` sum the period's movements. Labels use `en-IN`.
 *
 * @param txns - Raw `ims_transactions` rows (unsorted is fine).
 * @param openingOverride - Starting balance before the first voucher (default 0).
 *   If the stock_item has `opening_stock`, callers should pass its qty here.
 */
export function computeTallyLedger(
  txns: Transaction[],
  openingOverride: number = 0,
): { vouchers: TallyVoucher[]; months: TallyMonth[]; totals: { inwards: number; outwards: number } } {
  const opening = openingOverride ?? 0;

  const sorted = [...txns].sort((a, b) => {
    const da = new Date(a.txn_date).getTime();
    const db = new Date(b.txn_date).getTime();
    if (da !== db) return da - db;
    const na = (a.txn_no || "").localeCompare(b.txn_no || "");
    if (na !== 0) return na;
    return a.id.localeCompare(b.id);
  });

  let bal = opening;
  const totals = { inwards: 0, outwards: 0 };
  const vouchers: TallyVoucher[] = [];
  const monthsMap = new Map<string, TallyMonth>();

  for (const t of sorted) {
    const { wh, dir } = classifyTxnForTally(t);
    const qty = Number(t.qty) || 0;
    let stock_in = 0;
    let stock_out = 0;
    const before = bal;

    if (dir === "in") {
      stock_in = qty;
      bal += qty;
      totals.inwards += qty;
    } else if (dir === "out") {
      stock_out = qty;
      bal -= qty;
      totals.outwards += qty;
    }
    // dir === "adj" → no balance change (both remain 0)

    const voucher: TallyVoucher = {
      ...(t as Transaction),
      warehouse_id: wh,
      direction: dir,
      stock_in,
      stock_out,
      running: bal,
      voucherTypeLabel: TXN_TYPE_LABEL[t.txn_type] ?? t.txn_type,
      particulars: buildParticulars(t, wh, dir),
      docRef: t.reference ?? null,
    };
    vouchers.push(voucher);

    const key = monthKey(t.txn_date);
    const d = new Date(t.txn_date);
    const year = Number.isNaN(d.getTime()) ? 1970 : d.getFullYear();
    const month = Number.isNaN(d.getTime()) ? 1 : d.getMonth() + 1;

    let entry = monthsMap.get(key);
    if (!entry) {
      entry = {
        key,
        label: monthLabel(year, month),
        year,
        month,
        opening: before,
        inwards: 0,
        outwards: 0,
        closing: bal,
        count: 0,
      };
      monthsMap.set(key, entry);
    }
    entry.inwards += stock_in;
    entry.outwards += stock_out;
    entry.closing = bal;
    entry.count += 1;
  }

  const months = Array.from(monthsMap.values()).sort((a, b) => a.key.localeCompare(b.key));

  return { vouchers, months, totals };
}

// ---------------------------------------------------------------------------
// fetchTallyTransactions
// ---------------------------------------------------------------------------

/**
 * Fetch Tally transactions directly from Supabase with optional filters.
 *
 * - `model` / `oem` → server-side `ilike` exact (case-insensitive) on
 *   `part_model_no` / `oem`. Trims input; ignores empty.
 * - `fromDate` / `toDate` → `txn_date` `gte` / `lte` (inclusive).
 * - `warehouseId` → **post-filtered** in JS via `classifyTxnForTally`
 *   (so the fetch remains broad, matching the existing ledger pattern).
 * - Uses `fetchAllWith` to page past the 1000-row cap (`range` loop).
 * - Orders ascending by `txn_date` so `computeTallyLedger` can run without re-sorting
 *   (though it re-sorts defensively).
 *
 * @example
 * ```ts
 * const txns = await fetchTallyTransactions({ model: "UPS-600VA", oem: "Luminous", fromDate: "2025-04-01", toDate: "2026-03-31" });
 * const { vouchers, months } = computeTallyLedger(txns, openingOverride);
 * ```
 */
export async function fetchTallyTransactions(filters: {
  model: string | null;
  oem: string | null;
  warehouseId?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
}): Promise<Transaction[]> {
  const { model, oem, warehouseId, fromDate, toDate } = filters;

  const raw = await fetchAllWith<Transaction>((client) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = client.from("ims_transactions").select("*").order("txn_date", { ascending: true });

    const m = (model || "").trim();
    if (m) q = q.ilike("part_model_no", m);

    const o = (oem || "").trim();
    if (o) q = q.ilike("oem", o);

    const fd = (fromDate || "").trim();
    if (fd) q = q.gte("txn_date", fd);

    const td = (toDate || "").trim();
    if (td) q = q.lte("txn_date", td);

    return q;
  });

  // Warehouse is classified, not queried — keeps semantics aligned with ledger.tsx
  const wid = (warehouseId || "").trim();
  if (!wid) return (raw || []) as Transaction[];

  return (raw || []).filter((t) => {
    const { wh } = classifyTxnForTally(t as Transaction);
    return wh === wid;
  }) as Transaction[];
}

// ---------------------------------------------------------------------------
// fetchVoucherDocument
// ---------------------------------------------------------------------------

export type VoucherDocument = {
  type: "grn" | "dc" | "gdc" | "invoice" | "transfer" | null;
  id: string | null;
  no: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  record: any;
};

function inferVoucherTypeAndNo(
  reference: string,
  txn: Transaction,
): { type: VoucherDocument["type"]; docNo: string | null } {
  const trimmed = reference.trim();
  const upper = trimmed.toUpperCase();

  if (upper.startsWith("GRN ")) return { type: "grn", docNo: trimmed.slice(4).trim() || null };
  if (upper.startsWith("GDC ")) return { type: "gdc", docNo: trimmed.slice(4).trim() || null };
  if (upper.startsWith("DC ")) return { type: "dc", docNo: trimmed.slice(3).trim() || null };
  if (upper.startsWith("INVOICE ")) return { type: "invoice", docNo: trimmed.slice(8).trim() || null };
  if (upper.startsWith("INV ")) return { type: "invoice", docNo: trimmed.slice(4).trim() || null };

  // Pattern-based (handles refs without the `PREFIX ` space, or free-form notes containing a doc no)
  const grnMatch = trimmed.match(/(GRN-(?:CUST|OEM|GEN)\/[^\s,;]+)/i);
  if (grnMatch) return { type: "grn", docNo: grnMatch[1] };
  if (/GRN[\/-]/i.test(trimmed)) {
    const m = trimmed.match(/(GRN[^\s,;]*\/[^\s,;]+)/i);
    if (m) return { type: "grn", docNo: m[1] };
    return { type: "grn", docNo: trimmed };
  }

  const gdcMatch = trimmed.match(/(GDC\/[^\s,;]+)/i);
  if (gdcMatch) return { type: "gdc", docNo: gdcMatch[1] };

  const dcCustOemMatch = trimmed.match(/(DC-(?:CUST|OEM)\/[^\s,;]+)/i);
  if (dcCustOemMatch) return { type: "dc", docNo: dcCustOemMatch[1] };
  if (/^DC[\/-]/i.test(trimmed) || /DC\//i.test(trimmed)) {
    const m = trimmed.match(/(DC[^\s,;]*\/[^\s,;]+)/i);
    if (m) return { type: "dc", docNo: m[1] };
  }

  const isTransferType = txn.txn_type === "transfer_in" || txn.txn_type === "transfer_out";
  if (isTransferType || upper.includes("PHS/IMT") || /^PHS\/IMT/i.test(trimmed)) {
    return { type: "transfer", docNo: trimmed || null };
  }

  if (
    upper.includes("INVOICE") ||
    upper.includes("INV/") ||
    upper.includes("INV-") ||
    /\bINV\b/i.test(trimmed)
  ) {
    const invMatch = trimmed.match(/(?:Invoice\s+)?(INV[^\s,;]*)/i);
    if (invMatch && invMatch[1]) return { type: "invoice", docNo: invMatch[1] };
    return { type: "invoice", docNo: trimmed || null };
  }

  return { type: null, docNo: null };
}

/**
 * Resolve a transaction's voucher reference to its source document.
 *
 * Parses `txn.reference` (e.g. `GRN GRN-CUST/...`, `DC DC-CUST/...`,
 * `GDC GDC/2026/0001`, `Invoice INV-...`) and queries the matching table:
 *  - `grns` by `grn_no`
 *  - `delivery_challans` by `challan_no`
 *  - `general_delivery_challans` by `dc_no`
 *  - `invoices` by `invoice_no`
 *  - `ims_transfers` by `transfer_no` (or by `id` if `transfer_id` FK is set)
 *
 * Returns `{type, id, no, record}` on success, or `{type, id:null, no, record:null}`
 * when the type is inferred but the row is not found, or `null` when the
 * reference is empty/unknown and no transfer FK exists.
 *
 * Navigation: use `id` to link to `/grn/$id`, `/dc/$id`, `/gdc/$id`,
 * `/sales/invoices/$id`, `/ims/transfers/$id` respectively.
 */
export async function fetchVoucherDocument(
  txn: Transaction,
): Promise<VoucherDocument | null> {
  const ref = (txn.reference || "").trim();
  const transferId = (txn as unknown as { transfer_id?: string | null }).transfer_id ?? txn.transfer_id ?? null;

  // Direct FK — most reliable for transfers (DB trigger stores transfer_id)
  if (transferId) {
    try {
      const { data, error } = await sb.from("ims_transfers").select("*").eq("id", transferId).maybeSingle();
      if (error) throw error;
      if (data) {
        const r = data as unknown as { id: string; transfer_no: string | null };
        return { type: "transfer", id: r.id, no: (r.transfer_no ?? (ref || null)), record: data };
      }
    } catch {
      // fall through to reference-based lookup
    }
  }

  if (!ref) return null;

  const { type, docNo } = inferVoucherTypeAndNo(ref, txn);
  if (!type || !docNo) return null;

  try {
    if (type === "grn") {
      const { data } = await sb.from("grns").select("*").eq("grn_no", docNo).maybeSingle();
      if (data) {
        const r = data as unknown as { id: string; grn_no: string | null };
        return { type: "grn", id: r.id, no: r.grn_no ?? docNo, record: data };
      }
      const { data: ilike } = await sb.from("grns").select("*").ilike("grn_no", docNo).maybeSingle();
      if (ilike) {
        const r = ilike as unknown as { id: string; grn_no: string | null };
        return { type: "grn", id: r.id, no: r.grn_no ?? docNo, record: ilike };
      }
      return { type: "grn", id: null, no: docNo, record: null };
    }

    if (type === "dc") {
      const { data } = await sb.from("delivery_challans").select("*").eq("challan_no", docNo).maybeSingle();
      if (data) {
        const r = data as unknown as { id: string; challan_no: string | null };
        return { type: "dc", id: r.id, no: r.challan_no ?? docNo, record: data };
      }
      const { data: ilike } = await sb.from("delivery_challans").select("*").ilike("challan_no", docNo).maybeSingle();
      if (ilike) {
        const r = ilike as unknown as { id: string; challan_no: string | null };
        return { type: "dc", id: r.id, no: r.challan_no ?? docNo, record: ilike };
      }
      return { type: "dc", id: null, no: docNo, record: null };
    }

    if (type === "gdc") {
      const { data } = await sb.from("general_delivery_challans").select("*").eq("dc_no", docNo).maybeSingle();
      if (data) {
        const r = data as unknown as { id: string; dc_no: string | null };
        return { type: "gdc", id: r.id, no: r.dc_no ?? docNo, record: data };
      }
      const { data: ilike } = await sb.from("general_delivery_challans").select("*").ilike("dc_no", docNo).maybeSingle();
      if (ilike) {
        const r = ilike as unknown as { id: string; dc_no: string | null };
        return { type: "gdc", id: r.id, no: r.dc_no ?? docNo, record: ilike };
      }
      return { type: "gdc", id: null, no: docNo, record: null };
    }

    if (type === "invoice") {
      const { data } = await sb.from("invoices").select("*").eq("invoice_no", docNo).maybeSingle();
      if (data) {
        const r = data as unknown as { id: string; invoice_no: string | null };
        return { type: "invoice", id: r.id, no: r.invoice_no ?? docNo, record: data };
      }
      const { data: ilike } = await sb.from("invoices").select("*").ilike("invoice_no", docNo).maybeSingle();
      if (ilike) {
        const r = ilike as unknown as { id: string; invoice_no: string | null };
        return { type: "invoice", id: r.id, no: r.invoice_no ?? docNo, record: ilike };
      }
      return { type: "invoice", id: null, no: docNo, record: null };
    }

    if (type === "transfer") {
      // Try transfer_no first (reference holds PHS/IMT/...)
      const { data } = await sb.from("ims_transfers").select("*").eq("transfer_no", docNo).maybeSingle();
      if (data) {
        const r = data as unknown as { id: string; transfer_no: string | null };
        return { type: "transfer", id: r.id, no: r.transfer_no ?? docNo, record: data };
      }
      // Fallback: reference might be the UUID id itself
      const { data: byId } = await sb.from("ims_transfers").select("*").eq("id", docNo).maybeSingle();
      if (byId) {
        const r = byId as unknown as { id: string; transfer_no: string | null };
        return { type: "transfer", id: r.id, no: r.transfer_no ?? docNo, record: byId };
      }
      return { type: "transfer", id: null, no: docNo, record: null };
    }
  } catch {
    // On query error, surface inferred type with null id so caller can still render voucher no
    return { type, id: null, no: docNo, record: null };
  }

  return null;
}
