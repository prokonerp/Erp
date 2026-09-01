import * as React from "react";
import { useMemo, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { exportCSV } from "@/lib/exports";
import {
  fetchTallyTransactions,
  computeTallyLedger,
  fetchVoucherDocument,
  type TallyVoucher,
  type TallyMonth,
  type VoucherDocument,
} from "@/lib/tallyLedger";
import {
  listWarehouses,
  listProducts,
  TXN_TYPE_LABEL,
  type WarehouseLite,
  type ProductLite,
  type StockItem,
} from "@/lib/ims";
import { supabase } from "@/integrations/supabase/client";
import {
  Package,
  Warehouse,
  ArrowLeft,
  ChevronRight,
  Search,
  Calendar,
  TrendingUp,
  TrendingDown,
  FileText,
  Truck,
  Building,
  Eye,
  Download,
  ArrowDownCircle,
  ArrowUpCircle,
  Clock,
  Layers,
  X,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) => n.toLocaleString("en-IN");
const fmtInt = (n: number | null | undefined) =>
  typeof n === "number" ? n.toLocaleString("en-IN") : "—";

function fmtDateDMY(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  const date = d.toLocaleDateString("en-GB"); // dd/mm/yyyy
  const time = d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return { date, time };
}

function fyFromDate(d: Date): number {
  const m = d.getMonth(); // 0-indexed
  const y = d.getFullYear();
  return m >= 3 ? y : y - 1; // Apr=3
}

function fyPresets() {
  const now = new Date();
  const curFY = fyFromDate(now);
  const presets: { value: string; label: string; from: string; to: string }[] = [];
  for (let fy = curFY - 3; fy <= curFY + 1; fy++) {
    presets.push({
      value: `FY${fy}`,
      label: `FY ${fy}-${String(fy + 1).slice(-2)}`,
      from: `${fy}-04-01`,
      to: `${fy + 1}-03-31`,
    });
  }
  return presets.reverse(); // newest first
}

// Distinct product aggregated by part_model_no + oem
type DistinctProduct = {
  key: string;
  model: string | null;
  oem: string | null;
  part_name: string | null;
  totalQty: number;
  warehouseIds: Set<string>;
  sku: string | null;
};

function productKey(model: string | null, oem: string | null): string {
  const m = (model || "").trim() || "__na_model__";
  const o = (oem || "").trim() || "__na_oem__";
  return `${m}||${o}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TallyStockLedger() {
  const navigate = useNavigate();
  const presets = useMemo(() => fyPresets(), []);
  const curFY = useMemo(() => presets[1] ?? presets[0], [presets]); // second newest ~ current FY (after reverse)
  // fallback if presets empty
  const defaultFY = curFY ?? { value: "__all", label: "All time", from: "", to: "" };

  // -- filters (persisted via routeState, scoped to tally)
  const [selectedProductKey, setSelectedProductKey] = useRouteState<string | null>("tally-selectedProductKey", null, { scope: "tally" });
  // derived selectedProduct object from key (keeps JSON serializable)
  const [warehouseId, setWarehouseId] = useRouteState<string>("tally-warehouseId", "__all", { scope: "tally" });
  const [fyValue, setFyValue] = useRouteState<string>("tally-fyValue", defaultFY.value, { scope: "tally" });
  const [fromDate, setFromDate] = useRouteState<string>("tally-fromDate", defaultFY.from || "", { scope: "tally" });
  const [toDate, setToDate] = useRouteState<string>("tally-toDate", defaultFY.to || "", { scope: "tally" });
  const [voucherSearch, setVoucherSearch] = useRouteState<string>("tally-voucherSearch", "", { scope: "tally" });
  const [drilledMonth, setDrilledMonth] = useRouteState<string | null>("tally-drilledMonth", null, { scope: "tally" });
  const [activeVoucher, setActiveVoucher] = useState<TallyVoucher | null>(null);
  const [voucherDialogOpen, setVoucherDialogOpen] = useState(false);
  const [voucherDoc, setVoucherDoc] = useState<VoucherDocument | null>(null);
  const [voucherDocLoading, setVoucherDocLoading] = useState(false);
  const [voucherDocErr, setVoucherDocErr] = useState<string | null>(null);

  // -- queries
  const whQ = useQuery({
    queryKey: ["warehouses", "list"],
    queryFn: listWarehouses,
    staleTime: 60_000,
  });

  const productsQ = useQuery({
    queryKey: ["products", "list"],
    queryFn: listProducts,
    staleTime: 60_000,
  });

  const stockAggQ = useQuery({
    queryKey: ["tally", "stock-agg"],
    queryFn: async (): Promise<StockItem[]> => {
      const { fetchAllWith } = await import("@/lib/fetchAll");
      const rows = await fetchAllWith<StockItem>((c) =>
        c
          .from("ims_stock_items")
          .select("id,part_model_no,oem,part_name,warehouse_id,qty,opening_stock,created_at")
          .order("part_model_no"),
      );
      return rows;
    },
    staleTime: 60_000,
  });

  const warehouses: WarehouseLite[] = (whQ.data ?? []) as WarehouseLite[];
  const products: ProductLite[] = (productsQ.data ?? []) as ProductLite[];
  const stockRows: StockItem[] = (stockAggQ.data ?? []) as StockItem[];

  const whMap = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);
  const whName = (id: string | null) => {
    if (!id) return "—";
    const w = whMap.get(id);
    return w ? w.name : id.slice(0, 8);
  };

  // distinct products derived from stock
  const distinctProducts: DistinctProduct[] = useMemo(() => {
    const map = new Map<string, DistinctProduct>();
    const prodSkuMap = new Map<string, string | null>();
    for (const p of products) {
      const k = (p.model || "").trim().toLowerCase();
      if (k && p.sku) prodSkuMap.set(k, p.sku);
    }
    for (const r of stockRows) {
      const model = (r.part_model_no || "").trim() || null;
      const oem = (r.oem || "").trim() || null;
      const key = productKey(model, oem);
      let entry = map.get(key);
      if (!entry) {
        const sku =
          model ? (prodSkuMap.get(model.toLowerCase()) ?? null) : null;
        entry = {
          key,
          model,
          oem,
          part_name: r.part_name || null,
          totalQty: 0,
          warehouseIds: new Set<string>(),
          sku,
        };
        map.set(key, entry);
      }
      entry.totalQty += Number(r.qty ?? 1) || 0;
      if (r.warehouse_id) entry.warehouseIds.add(r.warehouse_id);
      if (!entry.part_name && r.part_name) entry.part_name = r.part_name;
    }
    return [...map.values()].sort((a, b) => {
      const am = (a.model || "").toLowerCase();
      const bm = (b.model || "").toLowerCase();
      if (am !== bm) return am.localeCompare(bm);
      return (a.oem || "").localeCompare(b.oem || "");
    });
  }, [stockRows, products]);

  // Derived selectedProduct from persisted key
  const selectedProduct: DistinctProduct | null = useMemo(() => {
    if (!selectedProductKey) return null;
    return distinctProducts.find((p) => p.key === selectedProductKey) ?? null;
  }, [selectedProductKey, distinctProducts]);

  // Selected distinct for header enrichment (same as selectedProduct after lookup)
  const selectedDistinct = useMemo(() => {
    if (!selectedProduct) return null;
    return distinctProducts.find((p) => p.key === selectedProduct.key) ?? selectedProduct;
  }, [selectedProduct, distinctProducts]);

  // txn fetch — only when product selected
  const modelParam = selectedProduct?.model ?? null;
  const oemParam = selectedProduct?.oem ?? null;

  const tallyQ = useQuery({
    queryKey: ["tally", modelParam, oemParam, warehouseId, fromDate, toDate],
    queryFn: () =>
      fetchTallyTransactions({
        model: modelParam,
        oem: oemParam,
        warehouseId: warehouseId === "__all" ? null : warehouseId,
        fromDate: fromDate || null,
        toDate: toDate || null,
      }),
    enabled: !!selectedProduct,
    staleTime: 30_000,
  });

  const rawTxns = (tallyQ.data ?? []) as unknown as import("@/lib/ims").Transaction[];

  const ledger = useMemo(() => computeTallyLedger(rawTxns, 0), [rawTxns]);
  const { vouchers, months, totals } = ledger;

  // voucher search client filter (search within vouchers)
  const filteredVouchers = useMemo(() => {
    const s = voucherSearch.trim().toLowerCase();
    if (!s) return vouchers;
    return vouchers.filter((v) =>
      [
        v.txn_no,
        v.part_name,
        v.part_model_no,
        v.part_serial_no,
        v.oem,
        v.reference,
        v.notes,
        v.from_party,
        v.to_party,
        v.particulars,
        v.voucherTypeLabel,
      ]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(s)),
    );
  }, [vouchers, voucherSearch]);

  // drilled month derived vouchers (filtered then month-scoped)
  const drilledVouchers: TallyVoucher[] = useMemo(() => {
    if (!drilledMonth) return [];
    return filteredVouchers.filter((v) => {
      const k = v.txn_date ? (() => {
        const d = new Date(v.txn_date);
        if (Number.isNaN(d.getTime())) return "";
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        return `${y}-${m}`;
      })() : "";
      return k === drilledMonth;
    });
  }, [filteredVouchers, drilledMonth]);

  const drilledMonthMeta: TallyMonth | null = useMemo(() => {
    if (!drilledMonth) return null;
    return months.find((m) => m.key === drilledMonth) ?? null;
  }, [months, drilledMonth]);

  // FY summary KPIs
  const openingBal = months[0]?.opening ?? 0;
  const closingBal = months.length ? months[months.length - 1].closing : openingBal;

  // --- handlers
  const handleFyChange = (v: string) => {
    setFyValue(v);
    if (v === "__all") {
      setFromDate("");
      setToDate("");
      return;
    }
    const p = presets.find((x) => x.value === v);
    if (p) {
      setFromDate(p.from);
      setToDate(p.to);
    }
  };

  const handleClear = () => {
    setWarehouseId("__all");
    setFyValue("__all");
    setFromDate("");
    setToDate("");
    setVoucherSearch("");
    setDrilledMonth(null);
  };

  const handleProductChange = (key: string) => {
    if (!key || key === "__none__") {
      setSelectedProductKey(null);
      setDrilledMonth(null);
      setVoucherSearch("");
      return;
    }
    setSelectedProductKey(key);
    setDrilledMonth(null);
    setVoucherSearch("");
  };

  const handleMonthClick = (m: TallyMonth) => setDrilledMonth(m.key);

  const openVoucher = async (v: TallyVoucher) => {
    setActiveVoucher(v);
    setVoucherDialogOpen(true);
    setVoucherDoc(null);
    setVoucherDocErr(null);
    setVoucherDocLoading(true);
    try {
      const doc = await fetchVoucherDocument(v);
      setVoucherDoc(doc);
      if (!doc) setVoucherDocErr("Document archived — ref: " + (v.reference || v.docRef || "—"));
    } catch (e: unknown) {
      setVoucherDocErr(e instanceof Error ? e.message : "Failed to resolve document");
    } finally {
      setVoucherDocLoading(false);
    }
  };

  const handleOpenDocument = () => {
    if (!voucherDoc?.id || !voucherDoc.type) {
      // fallback copy already handled
      return;
    }
    const id = voucherDoc.id;
    let to: string | null = null;
    switch (voucherDoc.type) {
      case "grn":
        to = `/grn/${id}`;
        break;
      case "dc":
        to = `/challan/${id}`;
        break;
      case "gdc":
        to = `/sales/general-dc/${id}`;
        break;
      case "invoice":
        to = `/sales/invoices/${id}`;
        break;
      case "transfer":
        to = `/ims/transfers/${id}`;
        break;
      default:
        to = null;
    }
    if (to) {
      // Prefer TanStack navigate; fallback to location
      try {
        navigate({ to } as never);
      } catch {
        window.location.href = to;
      }
      setVoucherDialogOpen(false);
    }
  };

  const handleExportMonthly = () => {
    const cols = [
      { header: "Month", get: (r: TallyMonth) => r.label },
      { header: "Opening", get: (r: TallyMonth) => r.opening },
      { header: "Inwards", get: (r: TallyMonth) => r.inwards },
      { header: "Outwards", get: (r: TallyMonth) => r.outwards },
      { header: "Closing", get: (r: TallyMonth) => r.closing },
      { header: "Vouchers", get: (r: TallyMonth) => r.count },
    ];
    exportCSV(`tally_ledger_${(selectedDistinct?.model || "product").replace(/\s+/g, "_")}_${fromDate || "all"}`, cols as never, months as never);
  };

  const handleExportVouchers = () => {
    const rows = drilledVouchers.length ? drilledVouchers : filteredVouchers;
    const cols = [
      { header: "Date", get: (r: TallyVoucher) => new Date(r.txn_date).toLocaleDateString("en-GB") },
      { header: "Txn No", get: (r: TallyVoucher) => r.txn_no || "" },
      { header: "Voucher Type", get: (r: TallyVoucher) => r.voucherTypeLabel },
      { header: "Particulars", get: (r: TallyVoucher) => r.particulars },
      { header: "Reference", get: (r: TallyVoucher) => r.reference || "" },
      { header: "Inwards", get: (r: TallyVoucher) => r.stock_in },
      { header: "Outwards", get: (r: TallyVoucher) => r.stock_out },
      { header: "Closing", get: (r: TallyVoucher) => r.running },
      { header: "Warehouse", get: (r: TallyVoucher) => whName(r.warehouse_id) },
    ];
    exportCSV(`tally_vouchers_${drilledMonth ?? "all"}`, cols as never, rows as never);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      {/* Top filter bar — Prokon Navy Premium chrome */}
      <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4">
            {/* Row 1: Product + Warehouse */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              {/* Product search — autocomplete searchable select */}
              <div className="flex-1 min-w-0">
                <label className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5">
                  Product
                </label>
                {stockAggQ.isLoading || productsQ.isLoading ? (
                  <Skeleton className="h-9 w-full rounded-md" />
                ) : distinctProducts.length === 0 ? (
                  <div className="h-9 rounded-md border border-border bg-muted/20 px-3 flex items-center text-sm text-muted-foreground">
                    No stock products found
                  </div>
                ) : (
                  <Select
                    value={selectedProduct?.key ?? "__none__"}
                    onValueChange={handleProductChange}
                  >
                    <SelectTrigger className="h-9 w-full bg-card border-border text-[13px] focus:ring-primary/20 focus:border-primary/30 shadow-sm">
                      <SelectValue placeholder="Select product — model / OEM" />
                    </SelectTrigger>
                    <SelectContent searchable searchPlaceholder="Search model / OEM…">
                      <SelectItem value="__none__">— Select product —</SelectItem>
                      {distinctProducts.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          <span className="inline-flex items-center gap-2 min-w-0">
                            <span className="font-medium tracking-tight truncate">{p.model || "—"}</span>
                            {p.oem ? (
                              <span className="rounded-full border border-border bg-muted px-1.5 py-0 text-[11px] font-mono leading-none">
                                {p.oem}
                              </span>
                            ) : null}
                            <span className="text-xs text-muted-foreground tabular-nums hidden sm:inline">
                              · {fmt(p.totalQty)} pcs · {p.warehouseIds.size} WH
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Warehouse filter */}
              <div className="sm:w-[220px] shrink-0">
                <label className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5">
                  Warehouse
                </label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger className="h-9 w-full bg-card border-border text-[13px] focus:ring-primary/20 focus:border-primary/30 shadow-sm">
                    <SelectValue placeholder="All warehouses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All warehouses</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.code ? `${w.code} — ` : ""}
                        {w.name}
                        {w.type ? ` · ${w.type}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 2: FY preset + From/To + Search within vouchers + Clear */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              {/* FY preset */}
              <div className="w-full sm:w-[180px] shrink-0">
                <label className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5">
                  FY Preset
                </label>
                <Select value={fyValue} onValueChange={handleFyChange}>
                  <SelectTrigger className="h-9 w-full bg-card border-border text-[13px] shadow-sm">
                    <SelectValue placeholder="FY" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All time</SelectItem>
                    {presets.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* From / To */}
              <div className="flex gap-2 shrink-0">
                <div>
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5">
                    From
                  </label>
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                    <Input
                      type="date"
                      value={fromDate}
                      onChange={(e) => {
                        setFromDate(e.target.value);
                        setFyValue("__all");
                      }}
                      className="h-9 pl-8 w-[150px] bg-card border-border text-[13px] shadow-sm focus-visible:ring-primary/20"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5">
                    To
                  </label>
                  <div className="relative">
                    <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
                    <Input
                      type="date"
                      value={toDate}
                      onChange={(e) => {
                        setToDate(e.target.value);
                        setFyValue("__all");
                      }}
                      className="h-9 pl-8 w-[150px] bg-card border-border text-[13px] shadow-sm focus-visible:ring-primary/20"
                    />
                  </div>
                </div>
              </div>

              {/* Search within vouchers */}
              <div className="flex-1 min-w-0">
                <label className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground block mb-1.5">
                  Search within vouchers
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                  <Input
                    placeholder="Txn no / party / ref / notes…"
                    value={voucherSearch}
                    onChange={(e) => setVoucherSearch(e.target.value)}
                    className="h-9 pl-9 bg-card border-border text-[13px] placeholder:text-muted-foreground/50 focus-visible:ring-primary/20 focus-visible:border-primary/30 shadow-sm"
                    disabled={!selectedProduct}
                  />
                </div>
              </div>

              {/* Clear */}
              <div className="shrink-0 flex items-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  className="h-9 border-border bg-card hover:bg-muted text-[13px] shadow-sm"
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Clear
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* No product selected — empty state */}
      {!selectedProduct ? (
        <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
          <CardContent className="p-0">
            <div className="px-6 py-14 flex flex-col items-center justify-center text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/[0.08] border border-primary/10 text-primary mb-4">
                <Layers className="h-7 w-7" />
              </span>
              <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
                Select a product to view its ledger
              </h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground max-w-[520px]">
                Tally Gateway — choose a product (model + OEM) above. Monthly summary and voucher
                register will appear here, filtered by warehouse and FY.
              </p>
              <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                <Package className="h-3.5 w-3.5" />
                {distinctProducts.length.toLocaleString("en-IN")} products · aggregated by model + OEM from stock
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Product header Card */}
          <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
            <CardContent className="p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex items-start gap-3">
                  <span className="hidden sm:grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm shadow-primary/15 ring-1 ring-primary/10 shrink-0">
                    <Package className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[16px] font-bold tracking-tight leading-none text-foreground">
                        {selectedDistinct?.model || "—"}
                      </h2>
                      {selectedDistinct?.oem ? (
                        <Badge
                          variant="outline"
                          className="bg-card border-border/70 font-mono text-[11px] font-semibold tracking-tight px-2 py-0.5 rounded-full"
                        >
                          {selectedDistinct.oem}
                        </Badge>
                      ) : null}
                      {selectedDistinct?.sku ? (
                        <span className="text-xs font-mono text-muted-foreground border border-border rounded-full px-2 py-0.5 bg-muted/30">
                          {selectedDistinct.sku}
                        </span>
                      ) : null}
                    </div>
                    {selectedDistinct?.part_name ? (
                      <p className="mt-1 text-xs text-muted-foreground truncate max-w-[520px]">
                        {selectedDistinct.part_name}
                      </p>
                    ) : null}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted border border-border px-2.5 py-1 font-medium">
                        <Warehouse className="h-3 w-3 text-muted-foreground" />
                        {selectedDistinct ? fmt(selectedDistinct.warehouseIds.size) : "—"} warehouses
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-card border border-border px-2.5 py-1 font-medium tabular-nums">
                        <Layers className="h-3 w-3 text-muted-foreground" />
                        Total qty {fmt(selectedDistinct?.totalQty ?? 0)}
                      </span>
                      {tallyQ.isFetching && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 border border-primary/15 px-2.5 py-1 font-medium text-primary">
                          <Clock className="h-3 w-3 animate-spin" />
                          Loading
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
                  <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5 text-center min-w-[84px]">
                    <div className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">Opening</div>
                    <div className="text-[15px] font-bold tabular-nums leading-none mt-1">{fmt(openingBal)}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-2.5 text-center min-w-[84px]">
                    <div className="text-[10px] font-semibold tracking-widest uppercase text-emerald-700">Available</div>
                    <div className="text-[15px] font-bold tabular-nums leading-none mt-1 text-emerald-700">{fmt(closingBal)}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-card px-3 py-2.5 text-center min-w-[84px]">
                    <div className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">Vouchers</div>
                    <div className="text-[15px] font-bold tabular-nums leading-none mt-1">{fmt(vouchers.length)}</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Loading */}
          {tallyQ.isLoading ? (
            <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="text-[13px] font-semibold tracking-tight flex items-center gap-2">
                  <Skeleton className="h-4 w-32" />
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ) : tallyQ.isError ? (
            <Card className="rounded-xl border-destructive/30 bg-card shadow-sm overflow-hidden">
              <CardContent className="p-6 text-center">
                <p className="text-sm font-medium text-destructive">Failed to load ledger</p>
                <p className="text-xs text-muted-foreground mt-1">{(tallyQ.error as Error)?.message || "Unknown error"}</p>
                <Button size="sm" variant="outline" className="mt-3" onClick={() => tallyQ.refetch()}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          ) : vouchers.length === 0 ? (
            <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
              <CardContent className="p-0">
                <div className="px-6 py-12 flex flex-col items-center justify-center text-center">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/50 mb-3">
                    <FileText className="h-6 w-6" />
                  </span>
                  <p className="text-sm font-semibold tracking-tight">No vouchers for this product</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                    No transactions match {selectedDistinct?.model || ""} {selectedDistinct?.oem ? `· ${selectedDistinct.oem}` : ""} {warehouseId !== "__all" ? `in ${whName(warehouseId)}` : ""} {fromDate || toDate ? `within the selected date range` : ""}. Try clearing warehouse or FY filters.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : drilledMonth ? (
            /* Level 2 — Monthly Voucher Register */
            <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
              {/* Breadcrumb header */}
              <div className="flex flex-col gap-3 border-b border-border/60 bg-card px-4 sm:px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDrilledMonth(null)}
                    className="h-8 border-border bg-card shadow-sm shrink-0"
                    aria-label="Back to monthly summary"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1.5" />
                    Back
                  </Button>
                  <nav aria-label="Breadcrumb" className="min-w-0 flex items-center gap-1.5 text-sm">
                    <button
                      onClick={() => setDrilledMonth(null)}
                      className="text-muted-foreground hover:text-foreground transition-colors truncate cursor-pointer"
                    >
                      Monthly Summary
                    </button>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-semibold tracking-tight truncate text-foreground">
                      {drilledMonthMeta?.label ?? drilledMonth}
                    </span>
                    {drilledMonthMeta ? (
                      <span className="hidden sm:inline-flex items-center rounded-full bg-primary/10 border border-primary/10 px-2 py-0.5 text-xs font-medium text-primary ml-1">
                        {fmt(drilledMonthMeta.count)} vouchers
                      </span>
                    ) : null}
                  </nav>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" variant="outline" onClick={handleExportVouchers} className="h-8 shadow-sm">
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export
                  </Button>
                </div>
              </div>

              {/* KPI strip for month */}
              {drilledMonthMeta && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-4 sm:px-5 py-3 bg-muted/20 border-b border-border/60">
                  <div className="rounded-lg border border-border bg-card px-3 py-2">
                    <div className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">Opening</div>
                    <div className="text-sm font-bold tabular-nums mt-0.5">{fmt(drilledMonthMeta.opening)}</div>
                  </div>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                    <div className="text-[10px] font-semibold tracking-widest uppercase text-emerald-700">Inwards</div>
                    <div className="text-sm font-bold tabular-nums mt-0.5 text-emerald-700">{fmt(drilledMonthMeta.inwards)}</div>
                  </div>
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
                    <div className="text-[10px] font-semibold tracking-widest uppercase text-rose-700">Outwards</div>
                    <div className="text-sm font-bold tabular-nums mt-0.5 text-rose-700">{fmt(drilledMonthMeta.outwards)}</div>
                  </div>
                  <div className="rounded-lg border border-primary/15 bg-primary/[0.06] px-3 py-2">
                    <div className="text-[10px] font-semibold tracking-widest uppercase text-primary">Closing</div>
                    <div className="text-sm font-bold tabular-nums mt-0.5 text-primary">{fmt(drilledMonthMeta.closing)}</div>
                  </div>
                </div>
              )}

              {/* Voucher table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[860px]">
                  <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                    <tr className="border-y border-border/60">
                      <th className="px-3 py-2.5 text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap w-[110px]">
                        Date
                      </th>
                      <th className="px-3 py-2.5 text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap min-w-[280px]">
                        Particulars
                      </th>
                      <th className="px-3 py-2.5 text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                        Voucher Type
                      </th>
                      <th className="px-3 py-2.5 text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap font-mono">
                        Voucher No
                      </th>
                      <th className="px-3 py-2.5 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-emerald-700 whitespace-nowrap">
                        Inwards
                      </th>
                      <th className="px-3 py-2.5 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-rose-700 whitespace-nowrap">
                        Outwards
                      </th>
                      <th className="px-3 py-2.5 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                        Closing
                      </th>
                      <th className="px-3 py-2.5 text-center align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap w-[56px]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilledVouchers.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-6 py-10 text-center">
                          <div className="mx-auto max-w-sm rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 flex flex-col items-center gap-2">
                            <Search className="h-5 w-5 text-muted-foreground" />
                            <p className="text-sm font-medium">No vouchers match your search</p>
                            <p className="text-xs text-muted-foreground">Try clearing the “Search within vouchers”.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      drilledVouchers.map((v) => {
                        const { date, time } = fmtDateDMY(v.txn_date);
                        const isIn = v.direction === "in";
                        const isOut = v.direction === "out";
                        return (
                          <tr
                            key={v.id}
                            tabIndex={0}
                            role="button"
                            aria-label={`Open voucher ${v.txn_no || v.id.slice(0, 8)}`}
                            onClick={() => openVoucher(v)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openVoucher(v);
                              }
                            }}
                            className="group border-b border-border/50 bg-card hover:bg-muted/50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-inset"
                          >
                            <td className="px-3 py-2.5 align-top whitespace-nowrap">
                              <div className="text-xs font-medium tabular-nums leading-none">{date}</div>
                              <div className="text-[11px] text-muted-foreground tabular-nums leading-none mt-1">{time}</div>
                            </td>
                            <td className="px-3 py-2.5 align-top">
                              <div className="flex items-start gap-2 min-w-0">
                                <span
                                  className={`grid h-7 w-7 place-items-center rounded-full border shrink-0 mt-0.5 ${
                                    isIn
                                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                                      : isOut
                                        ? "bg-rose-50 border-rose-200 text-rose-700"
                                        : "bg-muted border-border text-muted-foreground"
                                  }`}
                                >
                                  {isIn ? <Building className="h-3.5 w-3.5" /> : isOut ? <Truck className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
                                </span>
                                <span className="min-w-0">
                                  <span className="block text-[13px] font-medium leading-tight truncate" title={v.particulars}>
                                    {isIn ? (
                                      <>
                                        <span className="text-emerald-700">GRN</span>
                                        <span className="text-muted-foreground font-normal"> — From </span>
                                        <span className="font-semibold">{v.from_party || whName(v.from_warehouse_id) || "—"}</span>
                                      </>
                                    ) : isOut ? (
                                      <>
                                        <span className="text-rose-700">DC</span>
                                        <span className="text-muted-foreground font-normal"> — To </span>
                                        <span className="font-semibold">{v.to_party || whName(v.to_warehouse_id) || "—"}</span>
                                      </>
                                    ) : (
                                      <span>{v.particulars}</span>
                                    )}
                                  </span>
                                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                    {v.reference ? (
                                      <span className="inline-flex items-center rounded-full bg-muted border border-border px-1.5 py-0 text-[11px] font-mono leading-none truncate max-w-[180px]" title={v.reference}>
                                        {v.reference}
                                      </span>
                                    ) : null}
                                    <span className="inline-flex items-center gap-1 rounded-full bg-card border border-border px-1.5 py-0.5 text-[11px] font-medium leading-none">
                                      <Warehouse className="h-3 w-3 text-muted-foreground shrink-0" />
                                      {whName(v.warehouse_id)}
                                    </span>
                                  </span>
                                  {v.part_serial_no ? (
                                    <span className="mt-0.5 block text-[11px] font-mono text-muted-foreground truncate" title={v.part_serial_no}>
                                      SN: {v.part_serial_no}
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 align-middle">
                              <Badge
                                variant="outline"
                                className={`rounded-full text-[11px] px-2 py-0 whitespace-nowrap border ${
                                  isIn
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : isOut
                                      ? "bg-rose-50 text-rose-700 border-rose-200"
                                      : "bg-muted text-muted-foreground border-border"
                                }`}
                              >
                                {isIn ? <ArrowDownCircle className="h-3 w-3 mr-1" /> : isOut ? <ArrowUpCircle className="h-3 w-3 mr-1" /> : null}
                                {v.voucherTypeLabel}
                              </Badge>
                            </td>
                            <td className="px-3 py-2.5 align-middle font-mono text-xs tabular-nums max-w-[140px] truncate" title={v.txn_no || ""}>
                              {v.txn_no || "—"}
                            </td>
                            <td className="px-3 py-2.5 align-middle text-right tabular-nums font-medium text-emerald-700">
                              {v.stock_in ? fmt(v.stock_in) : "—"}
                            </td>
                            <td className="px-3 py-2.5 align-middle text-right tabular-nums font-medium text-rose-700">
                              {v.stock_out ? fmt(v.stock_out) : "—"}
                            </td>
                            <td className="px-3 py-2.5 align-middle text-right tabular-nums font-semibold">{fmt(v.running)}</td>
                            <td className="px-3 py-2.5 align-middle text-center">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 rounded-full hover:bg-primary/10 hover:text-primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openVoucher(v);
                                }}
                                aria-label={`View voucher ${v.txn_no || ""}`}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {drilledVouchers.length > 0 && drilledMonthMeta && (
                    <tfoot className="bg-muted/30 border-t border-border">
                      <tr className="font-semibold">
                        <td colSpan={4} className="px-3 py-3 text-right text-xs tracking-wide text-muted-foreground">
                          Month totals — {drilledMonthMeta.label}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{fmt(drilledMonthMeta.inwards)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-rose-700">{fmt(drilledMonthMeta.outwards)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmt(drilledMonthMeta.closing)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </Card>
          ) : (
            /* Level 1 — Monthly Summary Table */
            <Card className="rounded-xl border-border/60 bg-card shadow-sm overflow-hidden">
              {/* KPIs + export */}
              <div className="flex flex-col gap-3 border-b border-border/60 bg-card px-4 sm:px-5 py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm shrink-0">
                      <Calendar className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="text-[13px] font-semibold tracking-tight leading-none">Monthly Summary</h3>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Tally style — opening → inwards / outwards → closing · FY
                        {fromDate ? ` ${fromDate.slice(0, 10)} to ${toDate ? toDate.slice(0, 10) : "…"}` : " all time"}
                      </p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" onClick={handleExportMonthly} className="h-8 shadow-sm shrink-0">
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Export CSV
                  </Button>
                </div>

                {/* FY summary KPIs */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Opening
                    </div>
                    <div className="text-[18px] font-bold tabular-nums leading-none mt-1">{fmt(openingBal)}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">balance before first month</div>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase text-emerald-700">
                      <TrendingUp className="h-3 w-3" />
                      Total Inwards
                    </div>
                    <div className="text-[18px] font-bold tabular-nums leading-none mt-1 text-emerald-700">{fmt(totals.inwards)}</div>
                    <div className="text-[11px] text-emerald-700/70 mt-0.5">stock in</div>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase text-rose-700">
                      <TrendingDown className="h-3 w-3" />
                      Total Outwards
                    </div>
                    <div className="text-[18px] font-bold tabular-nums leading-none mt-1 text-rose-700">{fmt(totals.outwards)}</div>
                    <div className="text-[11px] text-rose-700/70 mt-0.5">stock out</div>
                  </div>
                  <div className="rounded-xl border border-primary/15 bg-primary/[0.06] px-3 py-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-widest uppercase text-primary">
                      <Package className="h-3 w-3" />
                      Closing
                    </div>
                    <div className="text-[18px] font-bold tabular-nums leading-none mt-1 text-primary">{fmt(closingBal)}</div>
                    <div className="text-[11px] text-primary/70 mt-0.5">balance after last month</div>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse min-w-[640px]">
                  <thead className="bg-muted/80 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
                    <tr className="border-y border-border/60">
                      <th className="px-4 py-3 text-left align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">
                        Particulars <span className="font-normal normal-case tracking-normal hidden sm:inline">· Month</span>
                      </th>
                      <th className="px-3 py-3 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-muted-foreground whitespace-nowrap">
                        Opening
                      </th>
                      <th className="px-3 py-3 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-emerald-700 whitespace-nowrap">
                        Inwards
                      </th>
                      <th className="px-3 py-3 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-rose-700 whitespace-nowrap">
                        Outwards
                      </th>
                      <th className="px-3 py-3 text-right align-middle text-[11px] font-semibold tracking-widest uppercase text-foreground whitespace-nowrap">
                        Closing
                      </th>
                      <th className="px-3 py-3 text-center align-middle w-[40px]" aria-hidden>
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {months.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-6 py-10 text-center">
                          <div className="mx-auto max-w-sm rounded-xl border border-dashed border-border bg-card/50 px-6 py-8 flex flex-col items-center gap-2">
                            <Calendar className="h-5 w-5 text-muted-foreground" />
                            <p className="text-sm font-medium">No monthly buckets</p>
                            <p className="text-xs text-muted-foreground">This product has vouchers but none in the selected range.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      months.map((m) => (
                        <tr
                          key={m.key}
                          tabIndex={0}
                          role="button"
                          aria-label={`Open ${m.label} vouchers`}
                          onClick={() => handleMonthClick(m)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleMonthClick(m);
                            }
                          }}
                          className="group border-b border-border/50 bg-card hover:bg-muted/50 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:ring-inset"
                        >
                          <td className="px-4 py-3 align-middle">
                            <span className="inline-flex items-center gap-2 min-w-0">
                              <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/10 shrink-0">
                                <Calendar className="h-3.5 w-3.5" />
                              </span>
                              <span className="flex flex-col">
                                <span className="text-[13px] font-semibold tracking-tight leading-none">{m.label}</span>
                                <span className="text-[11px] text-muted-foreground tabular-nums">{m.count} voucher{m.count === 1 ? "" : "s"}</span>
                              </span>
                            </span>
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums font-medium">{fmt(m.opening)}</td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums font-medium text-emerald-700">
                            <span className="inline-flex min-w-[28px] justify-end rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold leading-none tabular-nums text-emerald-700">
                              {m.inwards ? fmt(m.inwards) : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums font-medium text-rose-700">
                            <span className="inline-flex min-w-[28px] justify-end rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-xs font-semibold leading-none tabular-nums text-rose-700">
                              {m.outwards ? fmt(m.outwards) : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-3 align-middle text-right tabular-nums font-bold">{fmt(m.closing)}</td>
                          <td className="px-3 py-3 align-middle text-center">
                            <span className="grid h-7 w-7 place-items-center rounded-full border border-border bg-card group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary transition-colors mx-auto">
                              <ChevronRight className="h-3.5 w-3.5" />
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {months.length > 0 && (
                    <tfoot className="bg-muted/30 border-t border-border">
                      <tr className="font-bold">
                        <td className="px-4 py-3 text-[13px] tracking-tight">Grand Total · {months.length} month{months.length === 1 ? "" : "s"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{fmt(openingBal)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{fmt(totals.inwards)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-rose-700">{fmt(totals.outwards)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-primary">{fmt(closingBal)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Grand Total bar */}
              {months.length > 0 && (
                <div className="px-4 sm:px-5 py-3 bg-primary text-primary-foreground flex flex-wrap items-center gap-2 text-xs sm:text-sm border-t border-primary/10">
                  <span className="font-semibold tracking-tight">Totals</span>
                  <Separator orientation="vertical" className="h-4 bg-primary-foreground/20 hidden sm:block" />
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 border border-primary-foreground/20 px-2.5 py-1 font-medium tabular-nums">
                    Inwards <b>{fmt(totals.inwards)}</b>
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary-foreground/15 border border-primary-foreground/20 px-2.5 py-1 font-medium tabular-nums">
                    Outwards <b>{fmt(totals.outwards)}</b>
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-card text-foreground border border-border px-2.5 py-1 font-semibold tabular-nums shadow-sm">
                    Closing <b className="text-primary">{fmt(closingBal)}</b>
                  </span>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {/* Voucher Detail Dialog */}
      <Dialog open={voucherDialogOpen} onOpenChange={setVoucherDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto bg-card border-border/60 shadow-xl rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold tracking-tight flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground shrink-0">
                <FileText className="h-4 w-4" />
              </span>
              Voucher Detail
              {activeVoucher?.txn_no ? (
                <span className="font-mono text-xs font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5 bg-muted/50">
                  {activeVoucher.txn_no}
                </span>
              ) : null}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {activeVoucher ? `${activeVoucher.voucherTypeLabel} · ${fmtDateDMY(activeVoucher.txn_date).date} ${fmtDateDMY(activeVoucher.txn_date).time}` : "Voucher details"}
            </DialogDescription>
          </DialogHeader>

          {activeVoucher ? (
            <div className="space-y-4 pt-2">
              {/* Meta grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Date</div>
                  <div className="text-sm font-medium tabular-nums">
                    {(() => {
                      const { date, time } = fmtDateDMY(activeVoucher.txn_date);
                      return `${date} · ${time}`;
                    })()}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Type</div>
                  <Badge variant="outline" className="rounded-full border-border bg-card">
                    {activeVoucher.voucherTypeLabel}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Product</div>
                  <div className="text-sm font-medium leading-tight">{activeVoucher.part_name || "—"}</div>
                  <div className="text-xs font-mono text-muted-foreground">{activeVoucher.part_model_no || "—"}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Serial</div>
                  <div className="text-sm font-mono tabular-nums">{activeVoucher.part_serial_no || "—"}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">OEM</div>
                  <div className="text-sm font-mono">{activeVoucher.oem || "—"}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Warehouse</div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-card border border-border px-2.5 py-1 text-xs font-medium">
                    <Warehouse className="h-3 w-3 text-muted-foreground" />
                    {whName(activeVoucher.warehouse_id)}
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Party / Counter</div>
                  <div className="text-sm">
                    {activeVoucher.direction === "in"
                      ? activeVoucher.from_party || whName(activeVoucher.from_warehouse_id) || "—"
                      : activeVoucher.direction === "out"
                        ? activeVoucher.to_party || whName(activeVoucher.to_warehouse_id) || "—"
                        : activeVoucher.from_party || activeVoucher.to_party || "—"}
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Qty</div>
                  <div className="text-sm font-bold tabular-nums">
                    <span className={activeVoucher.direction === "in" ? "text-emerald-700" : activeVoucher.direction === "out" ? "text-rose-700" : ""}>
                      {activeVoucher.direction === "in" ? "+" : activeVoucher.direction === "out" ? "−" : ""}
                      {fmtInt(activeVoucher.qty)}
                    </span>
                    <span className="ml-2 text-xs font-medium text-muted-foreground">Running {fmt(activeVoucher.running)}</span>
                  </div>
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Reference</div>
                  <div className="text-sm font-mono break-all">{activeVoucher.reference || activeVoucher.docRef || "—"}</div>
                </div>
                <div className="sm:col-span-2 space-y-1">
                  <div className="text-[11px] font-semibold tracking-widest uppercase text-muted-foreground">Notes</div>
                  <div className="text-sm text-muted-foreground leading-relaxed break-words">{activeVoucher.notes || "—"}</div>
                </div>
              </div>

              <Separator className="bg-border/60" />

              {/* Document resolution */}
              <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">Source Document</h4>
                  {voucherDocLoading ? <span className="text-xs text-muted-foreground inline-flex items-center gap-1"><Clock className="h-3 w-3 animate-spin" />Resolving…</span> : null}
                </div>

                {voucherDocLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ) : voucherDoc?.id ? (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold tracking-tight">
                        {voucherDoc.type === "grn" && "GRN"}
                        {voucherDoc.type === "dc" && "Delivery Challan"}
                        {voucherDoc.type === "gdc" && "General Delivery Challan"}
                        {voucherDoc.type === "invoice" && "Invoice"}
                        {voucherDoc.type === "transfer" && "Stock Transfer"}
                        <span className="ml-2 font-mono text-xs font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5 bg-muted/50">
                          {voucherDoc.no || activeVoucher.reference || "—"}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">Resolved from reference “{activeVoucher.reference}”</p>
                    </div>
                    <Button size="sm" onClick={handleOpenDocument} className="shrink-0 shadow-sm">
                      <FileText className="h-3.5 w-3.5 mr-1.5" />
                      Open Document
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <p className="text-xs font-medium text-amber-800">
                      {voucherDocErr || `Document archived — ref: ${activeVoucher.reference || activeVoucher.docRef || "—"}`}
                    </p>
                    <p className="text-xs text-amber-700/80 mt-1">
                      The source document could not be found. It may have been archived or the reference was entered manually.
                    </p>
                    {activeVoucher.reference ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7 text-xs bg-card border-amber-200 hover:bg-amber-50"
                        onClick={() => {
                          navigator.clipboard.writeText(activeVoucher.reference || "");
                        }}
                      >
                        Copy ref
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setVoucherDialogOpen(false)} className="border-border bg-card">
                  Close
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => window.print()}
                  className="hidden sm:inline-flex"
                >
                  Print
                </Button>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">No voucher selected.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default TallyStockLedger;
