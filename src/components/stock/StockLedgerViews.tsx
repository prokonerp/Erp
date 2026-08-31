/**
 * StockLedgerViews — Glacier Navy premium stock ledger views
 * ----------------------------------------------------------
 * Two standalone views sharing correct inventory figures:
 *  - Compact  : Item × warehouse.type (godown vs service) Good/Scrap matrix
 *  - Detailed : Line-item ledger (All statuses — 126 by default, not just 105 available)
 *
 * Theme: Glacier #F1F5F9 canvas + Navy #1E3A5F primary, tokens only
 *        bg-card / border-border/60 / muted / primary / emerald / rose
 *        rounded-xl / shadow-sm / backdrop-blur / tabular-nums / Inter
 *
 * Standalone — does not edit reports.tsx. Drop into any tab via:
 *   import { StockLedgerCompact, StockLedgerDetailed } from "@/components/stock/StockLedgerViews"
 *
 * Usage — Compact
 * ───────────────────────────────────────────────────────────────
 *   const warehouses = await listWarehouses()
 *   const products   = await listProducts()
 *   const stock      = await listStock() // 126 rows (all statuses)
 *   <StockLedgerCompact
 *     items={stock}
 *     warehouses={warehouses}
 *     products={products}
 *     search={q} onSearchChange={setQ}
 *     warehouseTypeFilter="all" // "all" | "godown" | "service"
 *   />
 *   // or shorthand aliases:
 *   <StockLedgerCompact filteredStock={stock} warehouses={whs} stockProducts={products} />
 *
 * Usage — Detailed (All statuses by default)
 * ───────────────────────────────────────────────────────────────
 *   <StockLedgerDetailed
 *     items={stock}              // 126 — all statuses shown by default
 *     warehouses={warehouses}
 *     filters={{ q, warehouseId, stockType, stockStatus, openingOnly }}
 *     onFilterChange={setFilters}
 *     density="comfortable"      // "compact" | "comfortable"
 *     onView={(row) => openDetail(row)}
 *   />
 *   // uncontrolled (manages its own filters + pagination internally, defaults to All):
 *   <StockLedgerDetailed items={stock} warehouses={warehouses} />
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { StockStatusBadge } from "@/components/StockStatusBadge";
import { PaginationFooter } from "@/components/PaginationFooter";
import { exportCSV, type ExportColumn } from "@/lib/exports";
import { qtyCellClass } from "@/lib/negativeStock";
import type { StockItem, WarehouseLite, ProductLite, StockStatus, StockType } from "@/lib/ims";
import { STOCK_STATUS_LABEL } from "@/lib/ims";
import {
  Package,
  Warehouse,
  Search,
  Download,
  Eye,
  Layers,
  Boxes,
  Clock3,
  Ticket,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const norm = (v: string | null | undefined) => (v || "").trim().toLowerCase();
const fmt = (n: number) => n.toLocaleString("en-IN");

function plainWhName(wh: WarehouseLite): string {
  // Strip parenthetical suffixes like "NIT-3 (Godown)" → "NIT-3"
  const raw = (wh.name || "").trim();
  // Keep short names as-is; only strip trailing "(…)" if present
  const m = raw.match(/^(.+?)\s*\([^)]+\)\s*$/);
  return m ? m[1].trim() : raw || "—";
}

function ageDays(iso: string): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function ageLabel(iso: string): string {
  const d = ageDays(iso);
  if (d === 0) return "today";
  if (d === 1) return "1d";
  return `${d}d`;
}

// ---------------------------------------------------------------------------
// Compact — Item × Warehouse.type matrix
// ---------------------------------------------------------------------------

type Bucket = "good" | "scrap";

type CompactRow = {
  key: string;
  item: string;
  oem: string | null;
  sku: string | null;
  hsn: string | null; // product description/sku fallback
  cells: Record<string, Partial<Record<Bucket, number>>>;
};

function bucketOfCompact(r: StockItem): Bucket | null {
  if (r.stock_status === "scrapped") return "scrap";
  if (r.stock_status !== "available") return null;
  if (r.stock_type === "good") return "good";
  // defective available is not counted in Good/Scrap compact buckets per SalesServiceStockTables
  // but keep scrapped defective as scrap already handled above.
  return null;
}

function buildCompactRows(
  stock: StockItem[],
  whIds: Set<string>,
  products: ProductLite[],
): { rows: CompactRow[]; orphanCount: number } {
  const productMap = new Map<string, ProductLite>();
  for (const p of products) {
    const k = norm(p.model);
    if (k) productMap.set(k, p);
  }
  const map = new Map<string, CompactRow>();
  let orphanCount = 0;
  for (const r of stock) {
    const product = productMap.get(norm(r.part_model_no));
    const isOrphan = !product;
    // Still count orphans under a synthetic row so figures reconcile with detailed ledger
    const wid = r.warehouse_id || "";
    if (!whIds.has(wid)) continue;
    const b = bucketOfCompact(r);
    if (!b) continue;
    if (isOrphan) orphanCount += Number(r.qty ?? 1) || 0;
    const key = product ? product.id : "__orphan__";
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        item: isOrphan ? "Unknown / Orphan" : product!.model || r.part_model_no || "—",
        oem: isOrphan ? null : product!.brand ?? r.oem ?? null,
        sku: isOrphan ? null : product!.sku ?? null,
        hsn: isOrphan ? null : product!.description ?? null,
        cells: {},
      };
      map.set(key, g);
    }
    const cell = (g.cells[wid] ||= {});
    cell[b] = (cell[b] || 0) + (Number(r.qty ?? 1) || 0);
  }
  // orphan row last
  const rows = [...map.values()].sort((a, b) => {
    if (a.key === "__orphan__") return 1;
    if (b.key === "__orphan__") return -1;
    return a.item.localeCompare(b.item);
  });
  return { rows, orphanCount };
}

// Props — supports both canonical and alias shapes
export type StockLedgerCompactProps = {
  // canonical
  items?: StockItem[];
  warehouses: WarehouseLite[];
  products?: ProductLite[];
  // alias shorthand (prompt compatibility)
  filteredStock?: StockItem[];
  stockProducts?: ProductLite[];
  // controls
  search?: string;
  onSearchChange?: (v: string) => void;
  defaultSearch?: string;
  showSearch?: boolean;
  warehouseTypeFilter?: string; // "all" | "godown" | "service" | "service centre"
  title?: string;
  showExport?: boolean;
  exportSlot?: React.ReactNode;
  className?: string;
};

export function StockLedgerCompact(props: StockLedgerCompactProps) {
  const {
    warehouses,
    search: controlledSearch,
    onSearchChange,
    defaultSearch = "",
    showSearch = true,
    warehouseTypeFilter = "all",
    title = "Stock Ledger — Compact Matrix",
    showExport = true,
    exportSlot,
    className,
  } = props;

  const stock = React.useMemo(
    () => props.items ?? props.filteredStock ?? [],
    [props.items, props.filteredStock],
  );
  const products = React.useMemo(
    () => props.products ?? props.stockProducts ?? [],
    [props.products, props.stockProducts],
  );

  const [innerSearch, setInnerSearch] = React.useState(defaultSearch);
  const search = controlledSearch !== undefined ? controlledSearch : innerSearch;
  const setSearch = React.useCallback(
    (v: string) => {
      if (onSearchChange) onSearchChange(v);
      else setInnerSearch(v);
    },
    [onSearchChange],
  );

  const displayWarehouses = React.useMemo(() => {
    const f = norm(warehouseTypeFilter);
    if (!f || f === "all") return warehouses;
    if (f === "godown") return warehouses.filter((w) => norm(w.type) === "godown");
    if (f === "service" || f === "service centre" || f === "service center") {
      return warehouses.filter((w) => norm(w.type).includes("service"));
    }
    // generic fallback: match type contains filter
    return warehouses.filter((w) => norm(w.type).includes(f));
  }, [warehouses, warehouseTypeFilter]);

  const whIds = React.useMemo(() => new Set(displayWarehouses.map((w) => w.id)), [displayWarehouses]);

  const { rows: allRows } = React.useMemo(
    () => buildCompactRows(stock, whIds, products),
    [stock, whIds, products],
  );

  const filteredRows = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return allRows;
    return allRows.filter((r) =>
      [r.item, r.oem, r.sku].filter(Boolean).some((v) => String(v).toLowerCase().includes(term)),
    );
  }, [allRows, search]);

  const buckets: Bucket[] = ["good", "scrap"];

  const cellVal = (row: CompactRow, wid: string, b: Bucket) => row.cells[wid]?.[b];
  const rowTotalGood = (row: CompactRow) =>
    displayWarehouses.reduce((s, w) => s + (cellVal(row, w.id, "good") ?? 0), 0);
  const rowTotalScrap = (row: CompactRow) =>
    displayWarehouses.reduce((s, w) => s + (cellVal(row, w.id, "scrap") ?? 0), 0);
  const rowTotal = (row: CompactRow) => rowTotalGood(row) + rowTotalScrap(row);

  const colTotal = (wid: string, b: Bucket): number | undefined => {
    let has = false;
    let sum = 0;
    for (const r of filteredRows) {
      const v = cellVal(r, wid, b);
      if (v !== undefined) {
        has = true;
        sum += v;
      }
    }
    return has ? sum : undefined;
  };
  const grandGood = filteredRows.reduce((s, r) => s + rowTotalGood(r), 0);
  const grandScrap = filteredRows.reduce((s, r) => s + rowTotalScrap(r), 0);
  const grandTotal = grandGood + grandScrap;
  const goodPct = grandTotal ? Math.round((grandGood / grandTotal) * 100) : 0;

  // CSV export — one row per product, per-warehouse Good/Scrap + totals
  function download() {
    const cols: ExportColumn<CompactRow>[] = [
      { header: "Item", get: (r) => r.item },
      { header: "OEM", get: (r) => r.oem ?? "" },
      { header: "SKU", get: (r) => r.sku ?? "" },
    ];
    for (const w of displayWarehouses) {
      for (const b of buckets) {
        const label = b === "good" ? "Good" : "Scrap";
        cols.push({ header: `${plainWhName(w)} — ${label}`, get: (r) => cellVal(r, w.id, b) ?? "" });
      }
    }
    cols.push({ header: "Total Good", get: (r) => rowTotalGood(r) });
    cols.push({ header: "Total Scrap", get: (r) => rowTotalScrap(r) });
    cols.push({ header: "Total", get: (r) => rowTotal(r) });
    exportCSV("stock_ledger_compact", cols, filteredRows);
  }

  const colCount = 1 + displayWarehouses.length * buckets.length + 2; // item + per-wh buckets + total good/scrap

  return (
    <Card className={`rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden ${className ?? ""}`}>
      {/* Header — title + search + export */}
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm shrink-0">
            <Layers className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-[13px] font-semibold tracking-tight leading-none">{title}</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Good &amp; Scrap by warehouse type · <span className="tabular-nums font-medium text-foreground">{fmt(filteredRows.length)}</span> SKUs
              {search ? <span className="text-muted-foreground"> · filtered</span> : null}
              {displayWarehouses.length ? <span> · {displayWarehouses.length} warehouses</span> : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {showSearch && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search model / OEM / SKU…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 w-[220px] sm:w-[260px] pl-8 text-sm bg-card"
              />
            </div>
          )}
          {exportSlot ? (
            exportSlot
          ) : showExport ? (
            <Button size="sm" variant="outline" onClick={download} disabled={filteredRows.length === 0} className="h-8">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download CSV
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[720px]">
            {/* Sticky header — type grouping + bucket subheader */}
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
              {/* Warehouse grouping row */}
              <tr className="border-y border-border/60">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-20 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/80 px-3 py-2.5 text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap border-r border-border/60 min-w-[220px]"
                >
                  Item
                </th>
                {displayWarehouses.length === 0 ? (
                  <th colSpan={2} className="px-3 py-2 text-center text-muted-foreground font-medium border-r border-border/40">
                    No warehouses
                  </th>
                ) : (
                  displayWarehouses.map((w) => (
                    <th
                      key={w.id}
                      colSpan={buckets.length}
                      className="px-2 py-2 text-center align-middle border-r border-border/40 last:border-r-0"
                    >
                      <span className="inline-flex items-center gap-1.5 justify-center">
                        <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/10 shrink-0">
                          <Warehouse className="h-3 w-3" />
                        </span>
                        <span className="text-[12px] font-semibold tracking-tight text-foreground">{plainWhName(w)}</span>
                        {w.type ? (
                          <span className="hidden sm:inline text-[10px] font-medium tracking-wide text-muted-foreground border border-border/60 rounded-full px-1.5 py-0.5 bg-card/60 capitalize">
                            {w.type}
                          </span>
                        ) : null}
                      </span>
                    </th>
                  ))
                )}
                {/* Total grouping */}
                <th
                  colSpan={2}
                  className="px-2 py-2 text-center align-middle bg-primary/5 border-l border-border/60"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                    <span className="text-[11px] font-semibold tracking-widest uppercase text-primary">Total</span>
                  </span>
                </th>
              </tr>
              {/* Bucket subheader row */}
              <tr className="border-b border-border/60">
                {displayWarehouses.map((w) =>
                  buckets.map((b) => (
                    <th
                      key={`${w.id}-${b}`}
                      className={`px-2 py-1.5 text-center align-middle text-[11px] font-semibold tracking-widest uppercase whitespace-nowrap border-r border-border/40 last:border-r-0 ${
                        b === "good" ? "text-emerald-700 bg-emerald-50/60" : "text-slate-600 bg-slate-50/70"
                      }`}
                    >
                      {b === "good" ? "Good" : "Scrap"}
                    </th>
                  )),
                )}
                <th className="px-2 py-1.5 text-center align-middle text-[11px] font-semibold tracking-widest uppercase whitespace-nowrap bg-emerald-50/60 text-emerald-700 border-l border-border/60">
                  Good
                </th>
                <th className="px-2 py-1.5 text-center align-middle text-[11px] font-semibold tracking-widest uppercase whitespace-nowrap bg-slate-50/70 text-slate-600">
                  Scrap
                </th>
              </tr>
            </thead>

            <tbody className="[&_tr:last-child]:border-0">
              {displayWarehouses.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center">
                    <div className="mx-auto max-w-sm rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 flex flex-col items-center gap-2">
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50">
                        <Warehouse className="h-5 w-5" />
                      </span>
                      <p className="text-sm font-semibold tracking-tight">No warehouses of this type configured</p>
                      <p className="text-xs text-muted-foreground">Add warehouses in Warehouse Master or switch the type filter to “All”.</p>
                    </div>
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center">
                    <div className="mx-auto max-w-sm rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 flex flex-col items-center gap-2">
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50">
                        <Boxes className="h-5 w-5" />
                      </span>
                      <p className="text-sm font-semibold tracking-tight">No stock to display</p>
                      <p className="text-xs text-muted-foreground">
                        {search ? "No items match your search." : "No Good/Scrap stock in these warehouses."}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => {
                  const isOrphan = r.key === "__orphan__";
                  return (
                    <tr
                      key={r.key}
                      className={`group border-b border-border/50 bg-card hover:bg-muted/30 transition-colors ${isOrphan ? "bg-amber-50/40" : ""}`}
                    >
                      {/* Item — Package icon + model + OEM/HSN */}
                      <td className="sticky left-0 z-[1] bg-inherit px-3 py-2.5 align-middle border-r border-border/60 min-w-[220px]">
                        <span className="inline-flex items-center gap-2.5 min-w-0 max-w-[280px]">
                          <span className="grid h-7 w-7 place-items-center rounded-full bg-secondary/10 text-secondary ring-1 ring-secondary/10 shrink-0">
                            <Package className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span
                              className="block text-[13px] font-medium tracking-tight leading-none truncate text-foreground"
                              title={r.item}
                            >
                              {r.item}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                              {r.oem ? (
                                <Badge
                                  variant="outline"
                                  className="bg-card border-border/70 font-mono text-[11px] font-medium tracking-tight px-1.5 py-0 rounded-md max-w-[118px] truncate"
                                  title={r.oem}
                                >
                                  {r.oem}
                                </Badge>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">—</span>
                              )}
                              {r.sku ? (
                                <span className="text-[11px] font-mono text-muted-foreground truncate max-w-[90px]" title={r.sku}>
                                  {r.sku}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </span>
                      </td>

                      {/* Per-warehouse Good/Scrap */}
                      {displayWarehouses.map((w) =>
                        buckets.map((b) => {
                          const v = cellVal(r, w.id, b);
                          const isNeg = typeof v === "number" && v < 0;
                          return (
                            <td
                              key={`${w.id}-${b}`}
                              className={`px-2 py-2.5 align-middle text-center tabular-nums border-r border-border/40 ${qtyCellClass(v)} ${v === undefined ? "text-muted-foreground/60" : ""}`}
                            >
                              <span
                                className={
                                  v === undefined
                                    ? "text-muted-foreground text-xs"
                                    : v === 0
                                      ? "text-muted-foreground text-xs tabular-nums"
                                      : `inline-flex min-w-[28px] justify-center rounded-full border px-2 py-0.5 text-xs font-semibold leading-none tabular-nums ${
                                          isNeg
                                            ? "bg-destructive/10 text-destructive border-destructive/20"
                                            : b === "good"
                                              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                              : "bg-slate-50 border-slate-200 text-slate-700"
                                        }`
                                }
                              >
                                {v === undefined ? "—" : fmt(v)}
                              </span>
                            </td>
                          );
                        }),
                      )}

                      {/* Totals — bold + primary tint */}
                      <td className="px-2 py-2.5 align-middle text-center tabular-nums bg-primary/[0.04] border-l border-border/60">
                        <span className="inline-flex min-w-[28px] justify-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-bold leading-none tabular-nums text-emerald-700">
                          {fmt(rowTotalGood(r))}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 align-middle text-center tabular-nums bg-primary/[0.04]">
                        <span className="inline-flex min-w-[28px] justify-center rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs font-bold leading-none tabular-nums text-slate-700">
                          {fmt(rowTotalScrap(r))}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {/* Footer totals + health */}
            {filteredRows.length > 0 && (
              <tfoot className="bg-muted/30 border-t border-border">
                <tr className="font-semibold">
                  <td className="sticky left-0 z-[1] bg-muted/30 px-3 py-3 text-[13px] tracking-tight text-foreground border-r border-border/60">
                    <span className="inline-flex items-center gap-2">
                      Total — {fmt(filteredRows.length)} SKU{filteredRows.length === 1 ? "" : "s"}
                      <span className="hidden sm:inline-flex items-center gap-1 ml-1">
                        <span className="h-1.5 w-14 rounded-full bg-muted border border-border/40 overflow-hidden flex">
                          <span className="h-full bg-emerald-500" style={{ width: `${goodPct}%` }} />
                          <span className="h-full bg-slate-400" style={{ width: `${100 - goodPct}%` }} />
                        </span>
                        <span className="text-[11px] font-medium tabular-nums text-muted-foreground">{goodPct}% good</span>
                      </span>
                    </span>
                  </td>
                  {displayWarehouses.map((w) =>
                    buckets.map((b) => {
                      const v = colTotal(w.id, b);
                      return (
                        <td
                          key={`f-${w.id}-${b}`}
                          className={`px-2 py-3 text-center tabular-nums border-r border-border/40 ${qtyCellClass(v)}`}
                        >
                          <span
                            className={
                              v === undefined
                                ? "text-muted-foreground text-xs"
                                : `inline-flex min-w-[28px] justify-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none tabular-nums ${
                                    b === "good"
                                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                      : "bg-slate-50 border-slate-200 text-slate-700"
                                  }`
                            }
                          >
                            {v === undefined ? "—" : fmt(v)}
                          </span>
                        </td>
                      );
                    }),
                  )}
                  <td className="px-2 py-3 text-center tabular-nums bg-primary/[0.04] border-l border-border/60">
                    <span className="inline-flex min-w-[28px] justify-center rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-semibold leading-none tabular-nums text-emerald-700">
                      {fmt(grandGood)}
                    </span>
                  </td>
                  <td className="px-2 py-3 text-center tabular-nums bg-primary/[0.04]">
                    <span className="inline-flex min-w-[28px] justify-center rounded-full bg-slate-50 border border-slate-200 px-2.5 py-1 text-xs font-semibold leading-none tabular-nums text-slate-700">
                      {fmt(grandScrap)}
                    </span>
                  </td>
                </tr>
                {/* grand total + health summary row */}
                <tr className="bg-muted/20">
                  <td colSpan={colCount} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-card border border-border px-2.5 py-1 font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Good <b className="tabular-nums">{fmt(grandGood)}</b>
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-card border border-border px-2.5 py-1 font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        Scrap <b className="tabular-nums">{fmt(grandScrap)}</b>
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground border border-primary/10 px-2.5 py-1 font-semibold shadow-sm tabular-nums">
                        All <b>{fmt(grandTotal)}</b>
                      </span>
                      <span className="ml-auto inline-flex items-center gap-2">
                        <span className="text-muted-foreground hidden sm:inline">Health</span>
                        <span className="h-1.5 w-24 rounded-full bg-muted border border-border/40 overflow-hidden flex">
                          <span className="h-full bg-emerald-500" style={{ width: `${goodPct}%` }} />
                          <span className="h-full bg-slate-400" style={{ width: `${100 - goodPct}%` }} />
                        </span>
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Detailed — premium line-item ledger (All statuses by default)
// ---------------------------------------------------------------------------

export type StockLedgerDetailedFilters = {
  q: string;
  warehouseId: string; // "all" | warehouse.id | "__unassigned__"
  stockType: string; // "all" | "good" | "defective"
  stockStatus: string; // "all" | StockStatus
  openingOnly?: boolean;
};

export type StockLedgerDetailedProps = {
  items: StockItem[];
  warehouses: WarehouseLite[];
  // controlled filters (if omitted, component manages its own — defaults to All statuses)
  filters?: Partial<StockLedgerDetailedFilters>;
  onFilterChange?: (next: StockLedgerDetailedFilters) => void;
  // display
  density?: "compact" | "comfortable";
  page?: number;
  pageSize?: number; // default 50
  onPageChange?: (p: number) => void;
  onView?: (row: StockItem) => void;
  title?: string;
  className?: string;
  showFilters?: boolean;
  showPagination?: boolean;
  isAdmin?: boolean;
};

const DEFAULT_DETAILED_FILTERS: StockLedgerDetailedFilters = {
  q: "",
  warehouseId: "all",
  stockType: "all",
  stockStatus: "all",
  openingOnly: false,
};

function useControllableFilters(
  controlled: Partial<StockLedgerDetailedFilters> | undefined,
  onChange: ((n: StockLedgerDetailedFilters) => void) | undefined,
): [StockLedgerDetailedFilters, (patch: Partial<StockLedgerDetailedFilters>) => void] {
  const [inner, setInner] = React.useState<StockLedgerDetailedFilters>(() => ({
    ...DEFAULT_DETAILED_FILTERS,
    ...controlled,
  }));
  // keep inner in sync if parent switches to controlled after mount
  React.useEffect(() => {
    if (controlled) setInner((prev) => ({ ...prev, ...controlled }));
  }, [controlled?.q, controlled?.warehouseId, controlled?.stockType, controlled?.stockStatus, controlled?.openingOnly]);

  const current: StockLedgerDetailedFilters = controlled
    ? { ...DEFAULT_DETAILED_FILTERS, ...controlled } as StockLedgerDetailedFilters
    : inner;

  const set = React.useCallback(
    (patch: Partial<StockLedgerDetailedFilters>) => {
      if (controlled && onChange) {
        onChange({ ...current, ...patch });
      } else if (onChange) {
        const next = { ...current, ...patch };
        setInner(next);
        onChange(next);
      } else {
        setInner((p) => ({ ...p, ...patch }));
      }
    },
    [controlled, onChange, current],
  );

  return [current, set];
}

export function StockLedgerDetailed(props: StockLedgerDetailedProps) {
  const {
    items,
    warehouses,
    filters: controlledFilters,
    onFilterChange,
    density: controlledDensity,
    page: controlledPage,
    pageSize = 50,
    onPageChange,
    onView,
    title = "Stock Ledger — Detailed",
    className,
    showFilters = true,
    showPagination = true,
    // isAdmin reserved for future action gating; actions column always shows View
  } = props;

  const [filters, setFilters] = useControllableFilters(controlledFilters, onFilterChange);

  const [innerPage, setInnerPage] = React.useState(0);
  const page = controlledPage ?? innerPage;
  const setPage = React.useCallback(
    (p: number) => {
      if (onPageChange) onPageChange(p);
      else setInnerPage(p);
    },
    [onPageChange],
  );

  // Reset to first page when filters change
  const filterKey = `${filters.q}|${filters.warehouseId}|${filters.stockType}|${filters.stockStatus}|${filters.openingOnly}`;
  React.useEffect(() => {
    setPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  const [innerDensity, setInnerDensity] = React.useState<"compact" | "comfortable">(
    controlledDensity ?? "comfortable",
  );
  const density = controlledDensity ?? innerDensity;

  const whMap = React.useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const whName = React.useCallback(
    (id: string | null) => {
      if (!id) return "—";
      return whMap.get(id)?.name ?? "—";
    },
    [whMap],
  );

  // Filtering — share correct figures: by default shows ALL statuses (126)
  const filtered = React.useMemo(() => {
    const s = filters.q.trim().toLowerCase();
    return items.filter((r) => {
      if (filters.warehouseId !== "all") {
        if (filters.warehouseId === "__unassigned__") {
          if (r.warehouse_id) return false;
        } else if (r.warehouse_id !== filters.warehouseId) return false;
      }
      if (filters.stockType !== "all" && r.stock_type !== filters.stockType) return false;
      if (filters.stockStatus !== "all" && r.stock_status !== filters.stockStatus) return false;
      if (filters.openingOnly && !r.opening_stock) return false;
      if (!s) return true;
      return [r.part_name, r.part_model_no, r.part_serial_no, r.oem, r.oem_case_id, r.customer_name, r.ticket_id, r.indent_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s));
    });
  }, [items, filters]);

  const total = filtered.length;
  const paged = React.useMemo(() => {
    const start = page * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const padCell = density === "compact" ? "px-3 py-1.5" : "px-3 py-2.5";
  const headerH = density === "compact" ? "h-8" : "h-10";

  // For header count label: show All by default, not just available
  const statusCountLabel =
    filters.stockStatus === "all"
      ? `${fmt(total)} of ${fmt(items.length)}`
      : `${fmt(total)} · ${STOCK_STATUS_LABEL[filters.stockStatus as StockStatus] ?? filters.stockStatus}`;

  return (
    <Card className={`rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden ${className ?? ""}`}>
      {/* Header */}
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between space-y-0 pb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm shrink-0">
            <Boxes className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-[13px] font-semibold tracking-tight leading-none">{title}</CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              <span className="tabular-nums font-medium text-foreground">{statusCountLabel}</span>
              {filters.stockStatus === "all" ? (
                <span className="ml-1 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  All statuses
                </span>
              ) : null}
              {filters.openingOnly ? (
                <span className="ml-1 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                  Opening only
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {/* density toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="hidden sm:flex items-center gap-1 rounded-full border border-border bg-muted/40 p-0.5">
            {(["comfortable", "compact"] as const).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={density === d}
                onClick={() => {
                  if (!controlledDensity) setInnerDensity(d);
                }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                  density === d ? "bg-card shadow-sm border border-border text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          {onView ? (
            <span className="hidden sm:inline text-[11px] text-muted-foreground">View</span>
          ) : null}
        </div>
      </CardHeader>

      {/* Filters row */}
      {showFilters && (
        <div className="px-4 pb-3">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <div className="relative lg:col-span-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Model / Serial / OEM / Case ID / Customer…"
                  value={filters.q}
                  onChange={(e) => setFilters({ q: e.target.value })}
                  className="h-8 pl-8 text-sm bg-card"
                />
              </div>

              <Select value={filters.warehouseId} onValueChange={(v) => setFilters({ warehouseId: v })}>
                <SelectTrigger className="h-8 bg-card text-sm">
                  <SelectValue placeholder="Warehouse" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Warehouses</SelectItem>
                  {warehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                      {w.type ? ` · ${w.type}` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filters.stockType} onValueChange={(v) => setFilters({ stockType: v })}>
                <SelectTrigger className="h-8 bg-card text-sm">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="defective">Defective</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filters.stockStatus} onValueChange={(v) => setFilters({ stockStatus: v })}>
                <SelectTrigger className="h-8 bg-card text-sm">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {Object.entries(STOCK_STATUS_LABEL).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <Switch checked={!!filters.openingOnly} onCheckedChange={(v) => setFilters({ openingOnly: v })} />
                <span className="text-xs font-medium">Opening only</span>
              </label>
              <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                {fmt(total)} row{total === 1 ? "" : "s"} · warehouse pill · age · opening · ticket
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse min-w-[1080px]">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
              <tr className="border-y border-border/60">
                <th className={`${headerH} ${padCell} text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  OEM
                </th>
                <th className={`${headerH} ${padCell} text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Model / Part
                </th>
                <th className={`${headerH} ${padCell} text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Serial
                </th>
                <th className={`${headerH} ${padCell} text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Qty
                </th>
                <th className={`${headerH} ${padCell} text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Warehouse
                </th>
                <th className={`${headerH} ${padCell} text-center align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Type
                </th>
                <th className={`${headerH} ${padCell} text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Status
                </th>
                <th className={`${headerH} ${padCell} text-center align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Age
                </th>
                <th className={`${headerH} ${padCell} text-center align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Opening
                </th>
                <th className={`${headerH} ${padCell} text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Ticket / Indent
                </th>
                <th className={`${headerH} ${padCell} text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap`}>
                  Actions
                </th>
              </tr>
            </thead>

            <tbody>
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-0">
                    <div className="p-4">
                      <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 flex flex-col items-center justify-center text-center gap-3">
                        <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50">
                          <Search className="h-6 w-6" />
                        </span>
                        <p className="text-sm font-semibold tracking-tight text-foreground">No stock items</p>
                        <p className="text-xs leading-relaxed text-muted-foreground max-w-sm">
                          {filters.q || filters.warehouseId !== "all" || filters.stockType !== "all" || filters.stockStatus !== "all" || filters.openingOnly
                            ? "No items match these filters. Try clearing search or switching Status to “All statuses”."
                            : "No stock items found."}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                paged.map((r) => (
                  <tr
                    key={r.id}
                    className="group border-b border-border/50 bg-card hover:bg-muted/30 transition-colors"
                  >
                    {/* OEM — outline mono Badge */}
                    <td className={`${padCell} align-middle`}>
                      {r.oem ? (
                        <Badge
                          variant="outline"
                          className="bg-card border-border/70 font-mono text-[11px] font-medium tracking-tight px-1.5 py-0.5 rounded-md text-foreground shadow-sm max-w-[140px] truncate inline-flex"
                          title={r.oem}
                        >
                          {r.oem}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>

                    {/* Model / Part — Package icon */}
                    <td className={`${padCell} align-middle`}>
                      <span className="inline-flex items-center gap-2 min-w-0 max-w-[220px]">
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-secondary/10 text-secondary ring-1 ring-secondary/10 shrink-0">
                          <Package className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0">
                          <span className="block font-medium tracking-tight text-foreground text-[13px] leading-none truncate" title={r.part_name}>
                            {r.part_name}
                          </span>
                          {r.part_model_no ? (
                            <span className="block text-[11px] font-mono text-muted-foreground truncate" title={r.part_model_no}>
                              {r.part_model_no}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </td>

                    {/* Serial — mono truncate */}
                    <td className={`${padCell} align-middle`}>
                      <span
                        className="inline-block max-w-[140px] truncate font-mono text-xs tabular-nums"
                        title={r.part_serial_no ?? undefined}
                      >
                        {r.part_serial_no || <span className="text-muted-foreground">—</span>}
                      </span>
                    </td>

                    {/* Qty — tabular */}
                    <td className={`${padCell} align-middle text-right tabular-nums font-medium ${qtyCellClass(r.qty as number)}`}>
                      {fmt(Number(r.qty ?? 1) || 0)}
                    </td>

                    {/* Warehouse — pill with icon */}
                    <td className={`${padCell} align-middle`}>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-card border border-border px-2 py-0.5 text-xs font-medium leading-none max-w-[160px] truncate">
                        <Warehouse className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate" title={whName(r.warehouse_id)}>
                          {whName(r.warehouse_id)}
                        </span>
                      </span>
                    </td>

                    {/* Type — Badge emerald/rose */}
                    <td className={`${padCell} align-middle text-center`}>
                      <Badge
                        variant={r.stock_type === "good" ? "default" : "secondary"}
                        className={
                          r.stock_type === "good"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50 rounded-full text-xs px-2 py-0"
                            : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-50 rounded-full text-xs px-2 py-0"
                        }
                      >
                        {r.stock_type === "good" ? "Good" : "Defective"}
                      </Badge>
                    </td>

                    {/* Status — StockStatusBadge */}
                    <td className={`${padCell} align-middle`}>
                      <StockStatusBadge status={r.stock_status as StockStatus} type={r.stock_type as StockType} />
                    </td>

                    {/* Age — d computed */}
                    <td className={`${padCell} align-middle text-center`}>
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-muted border border-border/60 px-2 py-0.5 text-[11px] font-medium tabular-nums"
                        title={new Date(r.created_at).toLocaleString()}
                      >
                        <Clock3 className="h-3 w-3 text-muted-foreground shrink-0" />
                        {ageLabel(r.created_at)}
                      </span>
                    </td>

                    {/* Opening */}
                    <td className={`${padCell} align-middle text-center`}>
                      {r.opening_stock ? (
                        <Badge className="bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-50 rounded-full text-[11px] px-2 py-0">Opening</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>

                    {/* Ticket / Indent xs mono */}
                    <td className={`${padCell} align-middle`}>
                      <span
                        className="inline-flex items-center gap-1 max-w-[140px] truncate font-mono text-xs tabular-nums"
                        title={r.ticket_id || r.indent_id || r.oem_case_id || undefined}
                      >
                        <Ticket className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate">{r.ticket_id || r.indent_id || r.oem_case_id || "—"}</span>
                      </span>
                    </td>

                    {/* Actions — View eye */}
                    <td className={`${padCell} align-middle text-right`}>
                      {onView ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => onView(r)}
                          title="View"
                          aria-label="View stock item"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      {/* Pagination */}
      {showPagination && total > 0 && (
        <PaginationFooter page={page} pageSize={pageSize} total={total} onPage={setPage} />
      )}

      {/* Helper caption */}
      <div className="border-t bg-muted/20 px-3 py-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Good
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-500" /> Defective
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Scrapped
        </span>
        <span className="ml-auto tabular-nums">
          Page {page + 1} · {fmt(total)} total · {fmt(items.length)} in ledger
        </span>
      </div>
    </Card>
  );
}

export default StockLedgerDetailed;
