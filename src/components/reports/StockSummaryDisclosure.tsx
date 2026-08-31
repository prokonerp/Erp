import * as React from "react";
import {
  PackageCheck,
  Bookmark,
  Truck,
  Send,
  Layers,
  Info,
} from "lucide-react";
import { computeStockStatTotals } from "@/hooks/useReportsData";
import type { StockItem, WarehouseLite } from "@/lib/ims";

// ────────────────────────────────────────────────────────────────
// StockSummaryDisclosure — premium disclosure for Stock tab
// Theme: Prokon Navy Premium — Glacier #F1F5F9 canvas, Navy #1E3A5F
// primary, secondary #2563EB, accent #059669, border #E2E8F0,
// rounded-xl, Inter, tokens: bg-card, border-border/60, etc.
// ────────────────────────────────────────────────────────────────
// Shows: Available 105 · Reserved 8 · In transit 9 · Issued 3 = Total 126
// All counts are "good" stock by status; defective is surfaced as a
// separate subtle hint so the arithmetic stays honest for the disclosure.
// No console logs, no edits to reports.tsx — standalone drop-in.
// ────────────────────────────────────────────────────────────────

export type StockSummaryDisclosureProps = {
  filteredStock: StockItem[];
  /** Accepted for API parity; not required for the arithmetic. */
  warehouses?: WarehouseLite[];
  className?: string;
};

function fmt(n: number): string {
  return n.toLocaleString("en-IN");
}

export function StockSummaryDisclosure({
  filteredStock,
  warehouses,
  className,
}: StockSummaryDisclosureProps) {
  const totals = React.useMemo(() => {
    // Build a lightweight wMap only if warehouses was provided — keeps
    // hook parity (computeStockStatTotals takes an optional wMap).
    const wMap = warehouses
      ? Object.fromEntries(warehouses.map((w) => [w.id, w]))
      : undefined;
    return computeStockStatTotals(filteredStock, wMap as never);
  }, [filteredStock, warehouses]);

  const {
    goodAvailable,
    goodTotal,
    reservedCount,
    inTransitCount,
    issuedCount,
    defectiveAvailable,
    totalAvailable,
  } = totals;

  // Nothing to disclose when the filtered slice is empty — caller likely
  // shows the premium dashed empty state; keep disclosure hidden.
  if (filteredStock.length === 0) return null;

  const hasReserved = reservedCount > 0;
  const hasInTransit = inTransitCount > 0;
  const hasIssued = issuedCount > 0;
  const hasDefective = defectiveAvailable > 0;

  // Arithmetic hint: goodAvailable + (goodTotal - goodAvailable) = goodTotal
  const remainder = goodTotal - goodAvailable;

  return (
    <div
      className={[
        "rounded-xl border border-border/60 bg-card shadow-sm",
        "px-3 py-3 sm:px-4 sm:py-3.5",
        "flex flex-col gap-3",
        className ?? "",
      ].join(" ")}
      aria-label="Stock summary breakdown"
    >
      {/* ── Top line: disclosure pills ───────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {/* label */}
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase text-muted-foreground shrink-0">
          <Layers className="h-3.5 w-3.5 opacity-60" aria-hidden />
          Breakdown
        </span>

        <span className="hidden sm:inline-flex h-3 w-px bg-border/60 mx-1 shrink-0" aria-hidden />

        {/* Available — emerald */}
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold leading-none text-emerald-700 tabular-nums shadow-sm">
          <PackageCheck className="h-3.5 w-3.5" aria-hidden />
          Available {fmt(goodAvailable)}
        </span>

        {/* · separator — only when there is a remainder to show */}
        {remainder > 0 && (
          <span className="text-muted-foreground/60 text-xs font-medium" aria-hidden>
            +
          </span>
        )}

        {/* Reserved — amber (only when non-zero; muted dashed pill otherwise) */}
        {hasReserved ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold leading-none text-amber-700 tabular-nums shadow-sm">
            <Bookmark className="h-3.5 w-3.5" aria-hidden />
            Reserved {fmt(reservedCount)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-muted/50 px-2.5 py-1 text-xs font-medium leading-none text-muted-foreground tabular-nums">
            Reserved 0
          </span>
        )}

        <span className="text-muted-foreground/40 text-xs" aria-hidden>
          ·
        </span>

        {/* In transit — secondary/blue (amber family per spec, rendered as secondary for hierarchy) */}
        {hasInTransit ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-secondary/20 bg-secondary/[0.08] px-2.5 py-1 text-xs font-semibold leading-none text-secondary tabular-nums shadow-sm">
            <Truck className="h-3.5 w-3.5" aria-hidden />
            In transit {fmt(inTransitCount)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-muted/50 px-2.5 py-1 text-xs font-medium leading-none text-muted-foreground tabular-nums">
            In transit 0
          </span>
        )}

        <span className="text-muted-foreground/40 text-xs" aria-hidden>
          ·
        </span>

        {/* Issued — rose */}
        {hasIssued ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold leading-none text-rose-700 tabular-nums shadow-sm">
            <Send className="h-3.5 w-3.5" aria-hidden />
            Issued {fmt(issuedCount)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-muted/50 px-2.5 py-1 text-xs font-medium leading-none text-muted-foreground tabular-nums">
            Issued 0
          </span>
        )}

        {/* = Total — primary */}
        <span className="text-muted-foreground/60 text-xs font-semibold" aria-hidden>
          =
        </span>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/10 bg-primary text-primary-foreground px-2.5 py-1 text-xs font-semibold leading-none tabular-nums shadow-sm shadow-primary/15">
          Total {fmt(goodTotal)}
        </span>

        {/* good-only hint */}
        <span className="hidden sm:inline-flex items-center gap-1 text-[11px] leading-none text-muted-foreground/70 ml-1">
          <span className="h-1 w-1 rounded-full bg-emerald-500" aria-hidden />
          good stock
        </span>
      </div>

      {/* ── Sub line: reconciliation + defective hint ───────────── */}
      <div className="flex flex-wrap items-center gap-2 text-xs leading-relaxed">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Info className="h-3.5 w-3.5 opacity-60 shrink-0" aria-hidden />
          <span className="tabular-nums">
            <span className="font-semibold text-emerald-700">{fmt(goodAvailable)}</span>
            {" available"}
            {remainder > 0 && (
              <>
                {" + "}
                <span className="font-semibold text-foreground">{fmt(remainder)}</span>
                {" reserved / in-transit / issued"}
              </>
            )}
            {" = "}
            <span className="font-semibold text-primary">{fmt(goodTotal)}</span>
            {" total good"}
          </span>
        </span>

        <span className="hidden sm:inline text-border" aria-hidden>
          ·
        </span>

        <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums text-muted-foreground">
          <span>
            Available (all types){" "}
            <span className="font-semibold text-foreground">{fmt(totalAvailable)}</span>
          </span>
          {hasDefective && (
            <>
              <span className="text-border" aria-hidden>
                ·
              </span>
              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold leading-none text-rose-700">
                Defective {fmt(defectiveAvailable)}
              </span>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

export default StockSummaryDisclosure;
