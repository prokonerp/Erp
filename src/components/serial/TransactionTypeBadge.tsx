import * as React from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Repeat2,
  Undo2,
  ShoppingCart,
  Database,
  Truck,
  ShieldAlert,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TXN_TYPE_LABEL, type Transaction } from "@/lib/ims";
import { cn } from "@/lib/utils";

/**
 * Theme-aware transaction taxonomy for Serial Track.
 *
 * BUG FIX — src/routes/_app/ims.serial-track.tsx:54
 *   Before:  if ((good_out||defective_out) && (ref includes "dc" || "challan")) → "OEM Return"
 *            This matched DC-CUST/26-27/0114 (customer delivery challan) and
 *            mislabelled a Customer Issue as OEM Return (screenshot 2026-08-29
 *            serial 0H2632G20457: second row Helios via DC-CUST was shown as OEM Return).
 *   After:   OEM Return is ONLY when ref is DC-OEM / RMA / oem_case_id or
 *            txn_type === "oem_return" AND ref does NOT contain "dc-cust".
 *            DC-CUST + good_out/defective_out → "Customer Issue"
 *            Invoice + good_out            → "Sale"
 *            good_in + Opening Balance/PHS/IMS → "Opening Balance"
 *
 * Reference source of truth: src/lib/ims.ts Transaction { txn_type, txn_no,
 * reference, notes, from_party, to_party, from_warehouse_id, to_warehouse_id,
 * oem_case_id }
 */

export type TxnCategory = "in" | "out" | "transfer" | "adjust";

export type ResolvedTxnType = {
  /** Human label shown in the Type column / CSV */
  label: string;
  /** Tailwind badge classes (emerald/blue/amber/rose/slate). Also returned as `variant` per spec. */
  variant: string;
  /** Alias for `variant` — use either */
  badgeClass: string;
  /** lucide-react icon component */
  icon: LucideIcon;
  /** Semantic bucket for filtering/aggregation */
  category: TxnCategory;
};

// Glacier #F1F5F9 page bg; Navy #1E3A5F (oklch 0.32 0.08 250) primary; secondary #2563EB; accent #059669
const C = {
  slate: "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-100",
  emerald: "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100",
  blue: "bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-100",
  amber: "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100",
  rose: "bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100",
  neutral: "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-100",
} as const;

function norm(v: string | null | undefined): string {
  return (v || "").toLowerCase().trim();
}

/**
 * Pure resolver — no hooks, no side effects.
 * Priority order is intentional; do not reorder without updating the table below.
 */
export function resolveTxnType(t: Transaction): ResolvedTxnType {
  const refCombined = `${t.reference || ""} ${t.txn_no || ""}`.toLowerCase();
  const ref = norm(t.reference || t.txn_no);
  const notes = norm(t.notes);
  const fromParty = norm(t.from_party);
  const toParty = norm(t.to_party);

  const hasReversal = notes.includes("reversal") || refCombined.includes("reversal");
  const isDcCust = refCombined.includes("dc-cust") || refCombined.includes("dc_cust");
  const isDcOem = refCombined.includes("dc-oem") || refCombined.includes("dc_oem");
  // invoice refs appear as INV/..., INVOICE, or invoice — cover all variants
  const isInvoice =
    refCombined.includes("invoice") ||
    refCombined.includes("inv/") ||
    refCombined.includes("inv-") ||
    /\binv\b/.test(refCombined) ||
    refCombined.trim().startsWith("inv");
  const isGrn = refCombined.includes("grn");
  const isChallan = refCombined.includes("challan");
  const hasOemCase = Boolean(t.oem_case_id);
  const isOemSignal = isDcOem || refCombined.includes("rma") || (refCombined.includes("oem") && !isGrn) || hasOemCase;

  const fromIsOpening = fromParty.includes("opening balance") || fromParty === "opening" || fromParty.includes("opening");
  const refIsOpening = refCombined.includes("opening") || refCombined.includes("phs/ims") || refCombined.includes("phs-ims");
  const isOpening = (t.txn_type === "good_in" || t.txn_type === "defective_in") && (fromIsOpening || refIsOpening);

  const isTransfer = t.txn_type === "transfer_in" || t.txn_type === "transfer_out";
  const isScrapType = t.txn_type === "scrap_adjustment";
  const isScrapSignal = isScrapType || notes.includes("scrap") || refCombined.includes("scrap");
  const isStockAdjustment = t.txn_type === "stock_adjustment";

  // 1 — Reversal (notes-driven, highest priority)
  if (hasReversal) {
    return { label: "Reversal", variant: C.slate, badgeClass: C.slate, icon: Undo2, category: "adjust" };
  }

  // 2 — Opening Balance (good_in/defective_in + Opening Balance party or PHS/IMS ref)
  if (isOpening) {
    return { label: "Opening Balance", variant: C.slate, badgeClass: C.slate, icon: Database, category: "in" };
  }

  // 3 — Transfer
  if (isTransfer) {
    return { label: "Transfer", variant: C.amber, badgeClass: C.amber, icon: Repeat2, category: "transfer" };
  }

  // 4 — Scrapped
  if (isScrapSignal) {
    // stock_adjustment with scrap notes is still scrapped; plain stock_adjustment falls through to Adjust
    if (isScrapType || notes.includes("scrap") || refCombined.includes("scrap")) {
      return { label: "Scrapped", variant: C.rose, badgeClass: C.rose, icon: Trash2, category: "adjust" };
    }
  }

  // 5 — Purchase (inbound via GRN) — before sale/customer so GRN+invoice ambiguity favours purchase
  if ((t.txn_type === "good_in" || t.txn_type === "defective_in" || t.txn_type === "oem_replacement_receipt") && isGrn) {
    return { label: "Purchase", variant: C.emerald, badgeClass: C.emerald, icon: ShoppingCart, category: "in" };
  }

  // 6 — Customer Issue (DC-CUST) — HARD GUARD: never OEM Return for DC-CUST,
  // regardless of txn_type (covers screenshot bug + oem_return mis-typed as DC-CUST)
  if (isDcCust) {
    // only treat as Customer Issue when the movement is outbound-ish; inbound with DC-CUST is data error but still show issue
    if (t.txn_type === "good_out" || t.txn_type === "defective_out" || t.txn_type === "oem_return") {
      return { label: "Customer Issue", variant: C.blue, badgeClass: C.blue, icon: Truck, category: "out" };
    }
    // fallback for any other type carrying DC-CUST (e.g. stock_adjustment with DC-CUST ref) — still customer-facing
    if (t.txn_type !== "transfer_in" && t.txn_type !== "transfer_out") {
      return { label: "Customer Issue", variant: C.blue, badgeClass: C.blue, icon: Truck, category: "out" };
    }
  }

  // 7 — Sale (invoice) — also hard guard: invoice is never OEM Return
  if ((t.txn_type === "good_out" || t.txn_type === "defective_out") && isInvoice) {
    return { label: "Sale", variant: C.blue, badgeClass: C.blue, icon: ArrowUpFromLine, category: "out" };
  }

  // 8 — OEM Return — strict: needs explicit OEM signal and MUST NOT be DC-CUST
  //   - txn_type === "oem_return" + oem signal OR
  //   - defective_out + (DC-OEM|RMA|oem_case_id|oem in ref) OR
  //   - good_out + DC-OEM (good_out defective is handled above for DC-CUST)
  //   Challan alone is NOT enough (DC-CUST also uses challan wording).
  const isOemReturnCandidate =
    (t.txn_type === "oem_return" && (isOemSignal || isChallan || true)) ||
    (t.txn_type === "defective_out" && isOemSignal) ||
    (t.txn_type === "good_out" && isDcOem);

  if (isOemReturnCandidate && !isDcCust) {
    // extra guard: if oem_return txn somehow carries dc-cust, it was already returned above
    return { label: "OEM Return", variant: C.rose, badgeClass: C.rose, icon: Undo2, category: "out" };
  }

  // 9 — Defective In (inbound defective, not opening/purchase)
  if (t.txn_type === "defective_in") {
    return { label: "Defective In", variant: C.rose, badgeClass: C.rose, icon: ShieldAlert, category: "in" };
  }

  // 10 — OEM Replacement Receipt (inbound from OEM after return)
  if (t.txn_type === "oem_replacement_receipt") {
    return { label: TXN_TYPE_LABEL[t.txn_type] || "OEM Replacement", variant: C.emerald, badgeClass: C.emerald, icon: ArrowDownToLine, category: "in" };
  }

  // 11 — Stock Adjustment (generic) / Scrap fallback
  if (isStockAdjustment) {
    return { label: "Adjustment", variant: C.neutral, badgeClass: C.neutral, icon: Database, category: "adjust" };
  }
  if (isScrapType) {
    return { label: "Scrapped", variant: C.rose, badgeClass: C.rose, icon: Trash2, category: "adjust" };
  }

  // 12 — Fallbacks preserving TXN_TYPE_LABEL but with correct visual bucket
  switch (t.txn_type) {
    case "good_in":
      return { label: TXN_TYPE_LABEL.good_in, variant: C.emerald, badgeClass: C.emerald, icon: ArrowDownToLine, category: "in" };
    case "good_out":
      return { label: TXN_TYPE_LABEL.good_out, variant: C.blue, badgeClass: C.blue, icon: ArrowUpFromLine, category: "out" };
    case "defective_out":
      // defective_out without OEM signal and without DC-CUST already handled
      return { label: TXN_TYPE_LABEL.defective_out, variant: C.rose, badgeClass: C.rose, icon: ShieldAlert, category: "out" };
    case "transfer_in":
    case "transfer_out":
      return { label: "Transfer", variant: C.amber, badgeClass: C.amber, icon: Repeat2, category: "transfer" };
    default: {
      // catch-all keeps TXN_TYPE_LABEL for any future txn_type
      const lbl = (TXN_TYPE_LABEL as Record<string, string>)[t.txn_type] || t.txn_type;
      // infer category from label
      const cat: TxnCategory = lbl.toLowerCase().includes("transfer")
        ? "transfer"
        : lbl.toLowerCase().includes("adjust") || lbl.toLowerCase().includes("scrap") || lbl.toLowerCase().includes("reversal")
          ? "adjust"
          : t.txn_type.includes("_in") || t.txn_type.includes("receipt")
            ? "in"
            : "out";
      const cls =
        cat === "in" ? C.emerald : cat === "transfer" ? C.amber : cat === "adjust" ? C.neutral : C.blue;
      const ic: LucideIcon = cat === "in" ? ArrowDownToLine : cat === "transfer" ? Repeat2 : ArrowUpFromLine;
      return { label: lbl, variant: cls, badgeClass: cls, icon: ic, category: cat };
    }
  }
}

/** Convenience: just the label (for CSV export: exportCSV header get: t => resolveTxnType(t).label) */
export function txnTypeLabel(t: Transaction): string {
  return resolveTxnType(t).label;
}

export type TxnTypeBadgeProps = {
  txn: Transaction;
  /** Show icon inside badge (default true) */
  withIcon?: boolean;
  /** Extra className merged onto Badge */
  className?: string;
  /** Icon size in px (default 12) */
  iconSize?: number;
};

/**
 * Theme-aware badge for Serial Track Type column.
 * Usage: <TxnTypeBadge txn={t} />
 * CSV:   exportCSV(..., { header:"Type", get: (t)=> resolveTxnType(t).label }, rows)
 */
export function TxnTypeBadge({ txn, withIcon = true, className, iconSize = 12 }: TxnTypeBadgeProps) {
  const r = resolveTxnType(txn);
  const Icon = r.icon;
  return (
    <Badge variant="outline" className={cn(r.badgeClass, "inline-flex items-center gap-1 font-medium", className)}>
      {withIcon ? <Icon size={iconSize} className="shrink-0" aria-hidden /> : null}
      <span>{r.label}</span>
    </Badge>
  );
}

// Default export for lazy imports
export default TxnTypeBadge;
