import { createFileRoute } from "@tanstack/react-router";
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Package,
  Search,
  Warehouse as WarehouseIcon,
  Boxes,
  CheckCircle2,
  Clock,
  Send,
  ShieldCheck,
  AlertTriangle,
  Trash2,
  Inbox,
  X,
  RefreshCw,
  Layers,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchStockPage,
  fetchTransactionsPage,
  listWarehouses,
  STOCK_STATUS_LABEL,
  type StockItem,
  type Transaction,
  type WarehouseLite,
} from "@/lib/ims";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { stockKeys, txnKeys } from "@/lib/queryKeys";
import { TableSkeleton } from "@/components/shared/skeletons";
import { PaginationFooter } from "@/components/PaginationFooter";
import { useDebounced } from "@/lib/sales.hooks";
import { StockStatusBadge } from "@/components/StockStatusBadge";
import { aggregateBeta, type BetaProductRow } from "@/lib/stockBetaAggregation";
import { StockBetaDetail } from "@/components/ims/StockBetaDetail";

// Lazy-load the recharts-backed chart sections (~400KB) so the stock table and filters render immediately
const StockDashboardCharts = lazy(() =>
  import("@/components/StockManagementCharts").then((m) => ({ default: m.StockDashboardCharts })),
);
const ProductDetailCharts = lazy(() =>
  import("@/components/StockManagementCharts").then((m) => ({ default: m.ProductDetailCharts })),
);

export const Route = createFileRoute("/_app/ims/stock-management-beta")({
  component: StockManagementBeta,
});

function warehouseBreakdown(items: StockItem[], whName: (id: string | null) => string) {
  const map = new Map<
    string,
    {
      name: string;
      total: number;
      available: number;
      reserved: number;
      issued: number;
      good: number;
      defective: number;
      scrap: number;
    }
  >();
  for (const s of items) {
    const id = s.warehouse_id || "—";
    let r = map.get(id);
    if (!r) {
      r = {
        name: whName(s.warehouse_id),
        total: 0,
        available: 0,
        reserved: 0,
        issued: 0,
        good: 0,
        defective: 0,
        scrap: 0,
      };
      map.set(id, r);
    }
    const q = s.qty ?? 1;
    r.total += q;
    if (s.stock_status === "available") r.available += q;
    if (s.stock_status === "reserved") r.reserved += q;
    if (s.stock_status === "issued") r.issued += q;
    if (s.stock_status === "scrapped") r.scrap += q;
    if (s.stock_type === "good") r.good += q;
    if (s.stock_type === "defective") r.defective += q;
  }
  return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
}

function StockManagementBeta() {
  const [q, setQ] = useRouteState<string>("q", "");
  const [oemFilter, setOemFilter] = useRouteState<string>("oemFilter", "all");
  const [whFilter, setWhFilter] = useRouteState<string>("whFilter", "all");
  const [statusFilter, setStatusFilter] = useRouteState<string>("statusFilter", "all");
  const [expandedKeys, setExpandedKeys] = useRouteState<string[]>("expandedKeys", []);
  const [selectedProductKey, setSelectedProductKey] = useRouteState<string | null>(
    "selectedProductKey",
    null,
  );
  const [page, setPage] = useRouteState<number>("page", 0);
  const pageSize = 25;
  const qDebounced = useDebounced(q.trim(), 250);

  // Head title
  useEffect(() => {
    document.title = "Stock Management (BETA) — Prokon IMS";
  }, []);

  // IMPORTANT: fetch ALL matching search (2000) to aggregate correctly, not paginated 25
  const stockQ = useQuery({
    queryKey: stockKeys.paginated({
      page: 0,
      pageSize: 2000,
      search: qDebounced || null,
    } as unknown as Record<string, unknown> & { page: number; pageSize: number }),
    queryFn: () => fetchStockPage({ page: 0, pageSize: 2000, search: qDebounced || null }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const txnQ = useQuery({
    queryKey: txnKeys.paginated({
      page: 0,
      pageSize: 500,
    } as unknown as Record<string, unknown> & { page: number; pageSize: number }),
    queryFn: () => fetchTransactionsPage({ page: 0, pageSize: 500 }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const whQ = useQuery({
    queryKey: ["warehouses", "list"],
    queryFn: listWarehouses,
    staleTime: 30_000,
  });

  const items: StockItem[] = (stockQ.data?.data ?? []) as StockItem[];
  const txns: Transaction[] = (txnQ.data?.data ?? []) as Transaction[];
  const warehouses: WarehouseLite[] = (whQ.data ?? []) as WarehouseLite[];
  const loading = stockQ.isLoading || txnQ.isLoading || whQ.isLoading;

  const whName = (id: string | null) => warehouses.find((w) => w.id === id)?.name || "—";

  async function load() {
    await Promise.all([stockQ.refetch(), txnQ.refetch(), whQ.refetch()]);
  }

  // Realtime: debounce reload 300ms and skip if page hidden
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const debounced = () => {
      if (document.visibilityState !== "visible") return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        load();
      }, 300);
    };
    const ch = supabase
      .channel("stock-beta-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "ims_stock_items" }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "ims_transactions" }, debounced)
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(ch);
    };
  }, []);

  useEffect(() => {
    setPage(0);
  }, [qDebounced, oemFilter, whFilter, statusFilter]);

  const filteredItems = useMemo(() => {
    const s = q.toLowerCase().trim();
    return items.filter((r) => {
      if (oemFilter !== "all" && (r.oem || "") !== oemFilter) return false;
      if (whFilter !== "all" && r.warehouse_id !== whFilter) return false;
      if (statusFilter !== "all" && r.stock_status !== statusFilter) return false;
      if (!s) return true;
      return [r.part_name, r.part_model_no, r.part_serial_no, r.oem, r.category, r.customer_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(s));
    });
  }, [items, q, oemFilter, whFilter, statusFilter]);

  const products = useMemo(() => aggregateBeta(filteredItems, txns), [filteredItems, txns]);
  const expanded = useMemo(() => new Set(expandedKeys), [expandedKeys]);
  const selectedProduct = useMemo(() => {
    if (!selectedProductKey) return null;
    return products.find((p) => p.key === selectedProductKey) ?? null;
  }, [products, selectedProductKey]);

  // Clamp page when filtered set shrinks below current offset
  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(products.length / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [products.length, page]);

  const oems = useMemo(
    () => Array.from(new Set(items.map((i) => i.oem).filter(Boolean))).sort() as string[],
    [items],
  );

  const summary = useMemo(() => {
    let total = 0,
      available = 0,
      reserved = 0,
      issued = 0,
      good = 0,
      defective = 0,
      scrap = 0,
      returnedToOem = 0;
    let recvTotal = 0,
      recvOem = 0,
      recvCust = 0,
      recvGen = 0;
    for (const s of filteredItems) {
      const qv = s.qty ?? 1;
      total += qv;
      if (s.stock_status === "available") available += qv;
      if (s.stock_status === "reserved") reserved += qv;
      if (s.stock_status === "issued") issued += qv;
      if (s.stock_status === "scrapped") scrap += qv;
      if (s.stock_status === "returned_to_oem") returnedToOem += qv;
      if (s.stock_type === "good") good += qv;
      if (s.stock_type === "defective") defective += qv;
    }
    for (const p of products) {
      recvTotal += p.received.total;
      recvOem += p.received.oem;
      recvCust += p.received.customer;
      recvGen += p.received.general;
    }
    return {
      total,
      available,
      reserved,
      issued,
      good,
      defective,
      scrap,
      returnedToOem,
      products: products.length,
      recvTotal,
      recvOem,
      recvCust,
      recvGen,
    };
  }, [filteredItems, products]);

  const compositionData = useMemo(
    () =>
      [
        { name: "Good", value: summary.good, color: "#10b981" },
        { name: "Defective", value: summary.defective, color: "#f43f5e" },
        { name: "Scrap", value: summary.scrap, color: "#64748b" },
      ].filter((d) => d.value > 0),
    [summary],
  );

  const warehouseChart = useMemo(() => {
    const map = new Map<
      string,
      { name: string; Available: number; Reserved: number; Issued: number; Defective: number }
    >();
    for (const s of filteredItems) {
      const name = whName(s.warehouse_id);
      let r = map.get(name);
      if (!r) {
        r = { name, Available: 0, Reserved: 0, Issued: 0, Defective: 0 };
        map.set(name, r);
      }
      const q = s.qty ?? 1;
      if (s.stock_status === "available") r.Available += q;
      if (s.stock_status === "reserved") r.Reserved += q;
      if (s.stock_status === "issued") r.Issued += q;
      if (s.stock_type === "defective" && s.stock_status !== "issued") r.Defective += q;
    }
    return Array.from(map.values())
      .sort(
        (a, b) =>
          b.Available + b.Reserved + b.Issued + b.Defective - (a.Available + a.Reserved + a.Issued + a.Defective),
      )
      .slice(0, 8);
  }, [filteredItems, warehouses]);

  function toggleExpand(k: string) {
    setExpandedKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  // Client pagination: slice products by page*pageSize
  const paginatedProducts = useMemo(
    () => products.slice(page * pageSize, (page + 1) * pageSize),
    [products, page],
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" /> Stock Management (BETA){" "}
            <Badge variant="outline" className="ml-1 bg-amber-50 text-amber-700 border-amber-200">
              BETA
            </Badge>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            1 Model = 1 Row — aggregated inventory across warehouses, OEMs and product lines.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI grid 8 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi icon={Boxes} label="Total Inventory" value={summary.total} tone="blue" />
        <Kpi icon={CheckCircle2} label="Available" value={summary.available} tone="emerald" />
        <Kpi icon={Clock} label="Reserved" value={summary.reserved} tone="amber" />
        <Kpi icon={Send} label="Issued" value={summary.issued} tone="violet" />
        <Kpi icon={ShieldCheck} label="Good Stock" value={summary.good} tone="emerald" />
        <Kpi icon={AlertTriangle} label="Defective" value={summary.defective} tone="rose" />
        <Kpi icon={Trash2} label="Scrap" value={summary.scrap ?? 0} tone="slate" />
        <Kpi icon={Inbox} label="Received (GRN)" value={summary.recvTotal} tone="sky" />
      </div>

      {/* Charts row */}
      <Suspense fallback={<div className="h-56 animate-pulse bg-muted rounded-xl" />}>
        <StockDashboardCharts compositionData={compositionData} warehouseChart={warehouseChart} />
      </Suspense>

      {/* Filters */}
      <Card className="rounded-xl">
        <CardContent className="p-3">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8 h-9"
                placeholder="Search product, model, serial, OEM, customer…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <Select value={oemFilter} onValueChange={setOemFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="OEM" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All OEMs</SelectItem>
                {oems.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={whFilter} onValueChange={setWhFilter}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Warehouse" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9">
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

          {/* Filter chips Active filters + Clear all */}
          {(q || oemFilter !== "all" || whFilter !== "all" || statusFilter !== "all") && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t">
              <span className="text-xs text-muted-foreground mr-1">Active filters:</span>
              {q && <Chip onClear={() => setQ("")}>Search: “{q}”</Chip>}
              {oemFilter !== "all" && <Chip onClear={() => setOemFilter("all")}>OEM: {oemFilter}</Chip>}
              {whFilter !== "all" && (
                <Chip onClear={() => setWhFilter("all")}>Warehouse: {whName(whFilter)}</Chip>
              )}
              {statusFilter !== "all" && (
                <Chip onClear={() => setStatusFilter("all")}>
                  Status: {STOCK_STATUS_LABEL[statusFilter as keyof typeof STOCK_STATUS_LABEL] || statusFilter}
                </Chip>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => {
                  setQ("");
                  setOemFilter("all");
                  setWhFilter("all");
                  setStatusFilter("all");
                }}
              >
                Clear all
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Product Grid Card */}
      <Card className="rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
          <div className="text-sm font-medium flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            Products <span className="text-muted-foreground font-normal">({products.length})</span>
          </div>
          <div className="text-xs text-muted-foreground">Click row to open detailed view like new window</div>
        </div>
        <CardContent className="p-0">
          {stockQ.isLoading ? (
            <TableSkeleton rows={6} />
          ) : (
            <div
              className="max-h-[60vh] overflow-auto overscroll-contain scroll-pt-0"
              style={{ contain: "content" }}
            >
              <table className="w-full text-sm table-auto">
                <colgroup>
                  <col className="w-7" />
                  <col />
                  <col className="w-[1%]" />
                  <col className="w-[1%]" />
                  <col className="w-[1%]" />
                  <col className="w-[1%]" />
                  <col className="w-[1%]" />
                  <col className="w-[1%]" />
                  <col className="w-[1%]" />
                  <col className="w-[1%]" />
                  <col className="w-[1%]" />
                  <col className="w-[118px]" />
                  <col className="w-[1%]" />
                </colgroup>
                <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-200 shadow-[0_1px_0_rgba(0,0,0,0.06)]">
                  <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-slate-600">
                    <th scope="col" className="p-1.5 w-7"></th>
                    <th scope="col" className="px-2 py-1.5">Product</th>
                    <th scope="col" className="px-2 py-1.5">Model</th>
                    <th scope="col" className="px-2 py-1.5">OEM</th>
                    <th scope="col" className="px-1 py-1.5 text-right tabular-nums">Total</th>
                    <th scope="col" className="px-1 py-1.5 text-right tabular-nums">Avail</th>
                    <th scope="col" className="px-1 py-1.5 text-right tabular-nums">Resvd</th>
                    <th scope="col" className="px-1 py-1.5 text-right tabular-nums">Iss</th>
                    <th scope="col" className="px-1 py-1.5 text-right tabular-nums">Good</th>
                    <th scope="col" className="px-1 py-1.5 text-right tabular-nums">Def</th>
                    <th scope="col" className="px-1 py-1.5 text-right tabular-nums" title="Received via GRN — total">
                      Recd
                    </th>
                    <th scope="col" className="px-2 py-1.5">Latest GRN</th>
                    <th scope="col" className="px-1 py-1.5 text-right tabular-nums">WH</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={13} className="p-6 text-center text-muted-foreground">
                        Loading inventory…
                      </td>
                    </tr>
                  ) : products.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="p-6 text-center text-muted-foreground">
                        No stock matches your filters.
                      </td>
                    </tr>
                  ) : (
                    paginatedProducts.map((p, idx) => {
                      const isOpen = expanded.has(p.key);
                      const wh = warehouseBreakdown(p.items, whName);
                      const zebra = idx % 2 === 1 ? "bg-slate-50/60" : "";
                      return (
                        <React.Fragment key={p.key}>
                          <tr
                            key={`${p.key}-row`}
                            className={`border-t border-slate-100 transition-colors hover:bg-slate-50 cursor-pointer ${zebra}`}
                            onClick={() => setSelectedProductKey(p.key)}
                          >
                            <td className="p-1.5">
                              <button
                                type="button"
                                aria-label={isOpen ? "Collapse warehouse breakdown" : "Expand warehouse breakdown"}
                                aria-expanded={isOpen}
                                className="h-7 w-7 grid place-items-center rounded hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleExpand(p.key);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleExpand(p.key);
                                  }
                                }}
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </button>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-2">
                                <div className="h-7 w-7 rounded-md bg-primary/10 text-primary grid place-items-center shrink-0">
                                  <Package className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium leading-tight break-words whitespace-normal text-[13px]" title={p.part_name}>{p.part_name}</div>
                                  <div className="text-[11px] text-muted-foreground leading-tight break-words whitespace-normal" title={p.category || ""}>
                                    {p.category || "—"}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-1.5 font-mono text-xs break-all leading-tight" title={p.part_model_no || ""}>{p.part_model_no || "—"}</td>
                            <td className="px-2 py-1.5 text-xs truncate" title={p.oem || ""}>{p.oem || "—"}</td>
                            <td className="px-1 py-1.5 text-right font-semibold tabular-nums text-xs">{p.total}</td>
                            <td className="px-1 py-1.5 text-right">
                              <NumPill value={p.available} tone="emerald" />
                            </td>
                            <td className="px-1 py-1.5 text-right">
                              <NumPill value={p.reserved} tone="amber" />
                            </td>
                            <td className="px-1 py-1.5 text-right">
                              <NumPill value={p.issued} tone="violet" />
                            </td>
                            <td className="px-1 py-1.5 text-right tabular-nums text-emerald-700 text-xs">
                              {p.good || "—"}
                            </td>
                            <td className="px-1 py-1.5 text-right tabular-nums text-rose-700 text-xs">
                              {p.defective || "—"}
                            </td>
                            <td className="px-1 py-1.5 text-right font-medium tabular-nums text-xs">
                              {p.received.total || "—"}
                            </td>
                            <td className="px-2 py-1.5 text-xs">
                              {p.received.latestGrn ? (
                                <>
                                  <div className="font-mono">{p.received.latestGrn}</div>
                                  {p.received.latestDate && (
                                    <div className="text-muted-foreground">
                                      {new Date(p.received.latestDate).toLocaleDateString()}
                                    </div>
                                  )}
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="px-1 py-1.5 text-right tabular-nums text-xs">{p.warehouses.size}</td>
                          </tr>
                          {isOpen && (
                            <tr key={p.key + "-exp"} className="bg-primary/[0.03]">
                              <td colSpan={13} className="p-3">
                                <div className="text-[11px] font-semibold mb-2 text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                                  <WarehouseIcon className="h-3.5 w-3.5" /> Warehouse Breakdown
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                  {wh.map((w) => (
                                    <div key={w.id} className="rounded-lg border bg-background p-2.5">
                                      <div className="font-medium text-sm mb-1.5 flex items-center gap-1.5">
                                        <WarehouseIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                        {w.name}
                                      </div>
                                      <div className="grid grid-cols-3 gap-1 text-xs">
                                        <Stat label="Available" value={w.available} />
                                        <Stat label="Reserved" value={w.reserved} />
                                        <Stat label="Issued" value={w.issued} />
                                        <Stat label="Good" value={w.good} />
                                        <Stat label="Defective" value={w.defective} />
                                        <Stat label="Total" value={w.total} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={products.length}
            onPage={setPage}
            isFetching={stockQ.isFetching && !stockQ.isLoading}
          />
        </CardContent>
      </Card>

      <StockBetaDetail
        product={selectedProduct}
        isOpen={!!selectedProduct}
        onClose={() => setSelectedProductKey(null)}
        whName={whName}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between border rounded px-1.5 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

type KpiTone = "blue" | "emerald" | "amber" | "violet" | "rose" | "slate" | "sky";
const KPI_TONES: Record<KpiTone, { bg: string; fg: string; ring: string; bar: string }> = {
  blue: { bg: "bg-blue-50", fg: "text-blue-700", ring: "ring-blue-100", bar: "bg-blue-500" },
  emerald: {
    bg: "bg-emerald-50",
    fg: "text-emerald-700",
    ring: "ring-emerald-100",
    bar: "bg-emerald-500",
  },
  amber: { bg: "bg-amber-50", fg: "text-amber-700", ring: "ring-amber-100", bar: "bg-amber-500" },
  violet: {
    bg: "bg-violet-50",
    fg: "text-violet-700",
    ring: "ring-violet-100",
    bar: "bg-violet-500",
  },
  rose: { bg: "bg-rose-50", fg: "text-rose-700", ring: "ring-rose-100", bar: "bg-rose-500" },
  slate: { bg: "bg-slate-50", fg: "text-slate-700", ring: "ring-slate-100", bar: "bg-slate-500" },
  sky: { bg: "bg-sky-50", fg: "text-sky-700", ring: "ring-sky-100", bar: "bg-sky-500" },
};

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: KpiTone;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className="relative rounded-xl border bg-card p-3 hover:shadow-sm transition overflow-hidden">
      <div className={`absolute left-0 top-0 h-full w-1 ${t.bar}`} />
      <div className="flex items-start justify-between">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`h-7 w-7 grid place-items-center rounded-lg ring-1 ${t.bg} ${t.fg} ${t.ring}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${t.fg}`}>{value}</div>
    </div>
  );
}

function NumPill({
  value,
  tone,
}: {
  value: number;
  tone: "emerald" | "amber" | "violet" | "rose";
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const cls =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : tone === "violet"
          ? "bg-violet-50 text-violet-700 border-violet-200"
          : "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[22px] px-1 py-0 rounded-md border text-[11px] font-semibold tabular-nums leading-4 ${cls}`}
    >
      {value}
    </span>
  );
}

function Chip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted/40 pl-2.5 pr-1 py-0.5 text-xs">
      {children}
      <button
        type="button"
        onClick={onClear}
        className="rounded-full h-4 w-4 grid place-items-center hover:bg-muted"
        aria-label={`Remove filter ${typeof children === "string" ? children : "filter"}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function MiniKpi({
  icon: Icon,
  label,
  value,
  pct,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  pct?: number;
  tone: KpiTone;
}) {
  const cls =
    tone === "emerald"
      ? "text-emerald-700"
      : tone === "amber"
        ? "text-amber-700"
        : tone === "blue"
          ? "text-blue-700"
          : tone === "rose"
            ? "text-rose-700"
            : tone === "violet"
              ? "text-violet-700"
              : "text-slate-700";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className={`text-xl font-bold ${cls}`}>{value}</div>
        {pct !== undefined && <div className="text-[11px] text-muted-foreground">{pct}% of total</div>}
      </CardContent>
    </Card>
  );
}
