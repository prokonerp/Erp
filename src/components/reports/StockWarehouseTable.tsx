import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Warehouse, Package, Boxes } from "lucide-react";

// ---------------------------------------------------------------------------
// StockWarehouseTable — premium grouped-by-warehouse table
// Theme: Prokon Navy Premium — Glacier #F1F5F9 bg, Navy #1E3A5F primary
//        (oklch 0.32 0.08 250), secondary #2563EB, emerald GOOD, rose BAD.
// Spec: Group by warehouse → sticky warehouse header per group with pills
//       + health bar; rows with OEM mono badge, Product+Package,
//       emerald/rose pills, Health segmented bar.
// Used inside <CardContent className="p-0"> as <StockWarehouseTable groups={stockGroups} />
// ---------------------------------------------------------------------------

export type StockWarehouseGroup = {
  warehouse: string;
  product: string;
  oem: string;
  good: number;
  defective: number;
  qty: number;
};

export const StockWarehouseTable: React.FC<{ groups: StockWarehouseGroup[] }> = ({ groups }) => {
  // Empty — dashed card matching premium empty states
  if (groups.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 flex flex-col items-center justify-center text-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50">
            <Boxes className="h-6 w-6" />
          </span>
          <p className="text-sm font-semibold tracking-tight text-foreground">No stock to display</p>
          <p className="text-xs leading-relaxed text-muted-foreground max-w-sm">
            No available stock matches these filters.
          </p>
        </div>
      </div>
    );
  }

  // Group by warehouse — preserve first-seen order (already sorted warehouse asc upstream)
  const grouped = React.useMemo(() => {
    const m = new Map<string, StockWarehouseGroup[]>();
    for (const g of groups) {
      const arr = m.get(g.warehouse);
      if (arr) arr.push(g);
      else m.set(g.warehouse, [g]);
    }
    return m;
  }, [groups]);

  const totals = React.useMemo(() => {
    const good = groups.reduce((s, g) => s + g.good, 0);
    const defective = groups.reduce((s, g) => s + g.defective, 0);
    const qty = groups.reduce((s, g) => s + g.qty, 0);
    return { good, defective, qty };
  }, [groups]);

  const fmt = (n: number) => n.toLocaleString("en-IN");

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[720px]">
        <table className="w-full caption-bottom text-sm border-collapse">
          {/* ── Sticky column header ───────────────────────────────────── */}
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
            <tr className="border-b border-border">
              <th className="h-10 px-3 text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                OEM
              </th>
              <th className="h-10 px-3 text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                Product <span className="font-normal normal-case tracking-normal opacity-70">(Model No)</span>
              </th>
              <th className="h-10 px-3 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                Good
              </th>
              <th className="h-10 px-3 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                Defective
              </th>
              <th className="h-10 px-3 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                Total
              </th>
              <th className="h-10 px-3 text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                Health
              </th>
            </tr>
          </thead>

          <tbody className="[&_tr:last-child]:border-0">
            {Array.from(grouped.entries()).map(([warehouse, items]) => {
              const whGood = items.reduce((s, r) => s + r.good, 0);
              const whDef = items.reduce((s, r) => s + r.defective, 0);
              const whQty = items.reduce((s, r) => s + r.qty, 0);
              const whGoodPct = whQty ? (whGood / whQty) * 100 : 0;
              const whDefPct = whQty ? (whDef / whQty) * 100 : 0;

              return (
                <React.Fragment key={warehouse}>
                  {/* ── Warehouse section header — sticky below thead ───── */}
                  <tr className="sticky top-10 z-[5] bg-muted/40 backdrop-blur supports-[backdrop-filter]:bg-muted/40 border-y border-border/60">
                    <td colSpan={6} className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        {/* icon + name */}
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm shadow-primary/15 ring-1 ring-primary/10 shrink-0">
                          <Warehouse className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-[13px] font-semibold tracking-tight text-foreground leading-none">
                          {warehouse}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-card border border-border px-2 py-0.5 text-[11px] font-medium leading-none text-muted-foreground tabular-nums">
                          {fmt(items.length)} {items.length === 1 ? "product" : "products"}
                        </span>

                        {/* totals pills */}
                        <div className="flex items-center gap-1.5 ml-1 flex-wrap">
                          <span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold leading-none text-emerald-700 tabular-nums">
                            Good {fmt(whGood)}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs font-semibold leading-none text-rose-700 tabular-nums">
                            Bad {fmt(whDef)}
                          </span>
                          <span className="inline-flex items-center rounded-full bg-primary text-primary-foreground border border-primary/10 px-2 py-0.5 text-xs font-semibold leading-none tabular-nums shadow-sm shadow-primary/10">
                            Total {fmt(whQty)}
                          </span>
                        </div>

                        {/* spacer + health bar (overall warehouse health) */}
                        <div className="ml-auto hidden sm:flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-medium tracking-wide text-muted-foreground hidden lg:inline">Health</span>
                          <div
                            className="h-1.5 w-20 sm:w-24 rounded-full bg-muted border border-border/40 overflow-hidden flex"
                            aria-label={`Warehouse health: ${Math.round(whGoodPct)}% good, ${Math.round(whDefPct)}% defective`}
                          >
                            {whGood > 0 && (
                              <span className="h-full bg-emerald-500 transition-all" style={{ width: `${whGoodPct}%` }} />
                            )}
                            {whDef > 0 && (
                              <span className="h-full bg-rose-500 transition-all" style={{ width: `${whDefPct}%` }} />
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>

                  {/* ── Product rows ───────────────────────────────────── */}
                  {items.map((r, idx) => {
                    const goodPct = r.qty ? (r.good / r.qty) * 100 : 0;
                    const defPct = r.qty ? (r.defective / r.qty) * 100 : 0;
                    const accent = r.good >= r.defective ? "group-hover:border-l-emerald-500" : "group-hover:border-l-rose-500";
                    return (
                      <tr
                        key={`${warehouse}_${r.product}_${r.oem}_${idx}`}
                        className={`group border-b border-border/50 bg-card hover:bg-muted/30 transition-colors border-l-2 border-l-transparent ${accent}`}
                      >
                        {/* OEM — outline mono badge */}
                        <td className="px-3 py-2.5 align-middle">
                          <Badge
                            variant="outline"
                            className="bg-card border-border/70 font-mono text-[11px] font-medium tracking-tight px-1.5 py-0.5 rounded-md text-foreground shadow-sm max-w-[140px] truncate inline-flex"
                            title={r.oem}
                          >
                            {r.oem}
                          </Badge>
                        </td>

                        {/* Product — Package icon in secondary/10 circle */}
                        <td className="px-3 py-2.5 align-middle">
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <span className="grid h-7 w-7 place-items-center rounded-full bg-secondary/10 text-secondary ring-1 ring-secondary/10 shrink-0">
                              <Package className="h-3.5 w-3.5" />
                            </span>
                            <span className="font-medium tracking-tight text-foreground text-[13px] leading-none truncate max-w-[220px]" title={r.product}>
                              {r.product}
                            </span>
                          </span>
                        </td>

                        {/* Good — emerald pill or — */}
                        <td className="px-3 py-2.5 align-middle text-right tabular-nums">
                          {r.good > 0 ? (
                            <span className="inline-flex items-center justify-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold leading-none text-emerald-700 min-w-[28px]">
                              {fmt(r.good)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>

                        {/* Defective — rose pill or — */}
                        <td className="px-3 py-2.5 align-middle text-right tabular-nums">
                          {r.defective > 0 ? (
                            <span className="inline-flex items-center justify-center rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs font-semibold leading-none text-rose-700 min-w-[28px]">
                              {fmt(r.defective)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>

                        {/* Total — font-semibold */}
                        <td className="px-3 py-2.5 align-middle text-right font-semibold tabular-nums text-foreground">
                          {fmt(r.qty)}
                        </td>

                        {/* Health — segmented bar */}
                        <td className="px-3 py-2.5 align-middle">
                          <div className="flex items-center gap-2">
                            <div
                              className="h-1.5 w-20 rounded-full bg-muted border border-border/30 overflow-hidden flex shrink-0"
                              aria-label={`Health: ${Math.round(goodPct)}% good`}
                            >
                              {r.good > 0 && (
                                <span className="h-full bg-emerald-500" style={{ width: `${goodPct}%` }} />
                              )}
                              {r.defective > 0 && (
                                <span className="h-full bg-rose-500" style={{ width: `${defPct}%` }} />
                              )}
                            </div>
                            <span className="hidden lg:inline text-[11px] font-medium tabular-nums text-muted-foreground">
                              {r.defective > 0 && r.good > 0
                                ? `${Math.round(goodPct)}%`
                                : r.defective > 0
                                  ? "needs QC"
                                  : "good"}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>

          {/* ── Footer totals ──────────────────────────────────────────── */}
          <tfoot className="bg-muted/30 border-t border-border">
            <tr className="font-semibold">
              <td colSpan={2} className="px-3 py-3 text-[13px] tracking-tight text-foreground">
                Total — {fmt(groups.length)} SKU{groups.length === 1 ? "" : "s"} across {fmt(grouped.size)} warehouse{grouped.size === 1 ? "" : "s"}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                <span className="inline-flex items-center justify-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold leading-none text-emerald-700">
                  {fmt(totals.good)}
                </span>
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                <span className="inline-flex items-center justify-center rounded-full bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs font-semibold leading-none text-rose-700">
                  {fmt(totals.defective)}
                </span>
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-foreground">{fmt(totals.qty)}</td>
              <td className="px-3 py-3">
                <div
                  className="h-1.5 w-20 rounded-full bg-muted border border-border/40 overflow-hidden flex"
                  aria-label="Overall health"
                >
                  {totals.good > 0 && (
                    <span
                      className="h-full bg-emerald-500"
                      style={{ width: `${totals.qty ? (totals.good / totals.qty) * 100 : 0}%` }}
                    />
                  )}
                  {totals.defective > 0 && (
                    <span
                      className="h-full bg-rose-500"
                      style={{ width: `${totals.qty ? (totals.defective / totals.qty) * 100 : 0}%` }}
                    />
                  )}
                </div>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
};

export default StockWarehouseTable;
