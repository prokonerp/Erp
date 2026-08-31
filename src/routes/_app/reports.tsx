import { createFileRoute } from "@tanstack/react-router";
import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { istTodayIso, daysAgoIst } from "@/lib/dateRange";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, ChevronDown, CircleCheck, TriangleAlert, LayoutGrid, List, Layers, Hash, Shield } from "lucide-react";
import { ExportButtons } from "@/components/ExportButtons";
import {
  fetchStockPage, listWarehouses,
  type StockItem, type StockType, type WarehouseLite,
} from "@/lib/ims";
import { StockWarehouseKpis, StockWarehouseHeader } from "@/components/reports/StockWarehouseKpis";
import { StockWarehouseTable } from "@/components/reports/StockWarehouseTable";
import { ReportsPageHeader, ReportsFilters, ReportsWarrantyShell } from "@/components/reports/ReportsShell";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// Heavy report views (~40-60k each) — lazy so the initial /reports shell paints
// fast and the 140k chunk is split at route granularity.
const StockLedgerCompact = lazy(() =>
  import("@/components/stock/StockLedgerViews").then((m) => ({ default: m.StockLedgerCompact })),
);
const StockLedgerDetailed = lazy(() =>
  import("@/components/stock/StockLedgerViews").then((m) => ({ default: m.StockLedgerDetailed })),
);
const StockSummaryDisclosure = lazy(() =>
  import("@/components/reports/StockSummaryDisclosure").then((m) => ({ default: m.StockSummaryDisclosure })),
);

function LedgerFallback() {
  return <div className="h-48 animate-pulse bg-muted rounded-xl" />;
}
function DisclosureFallback() {
  return <div className="h-20 animate-pulse bg-muted rounded-xl" />;
}

export const Route = createFileRoute("/_app/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Stock & Serial Reports — Prokon" }] }),
});

type Serial = {
  id: string; product_id: string; serial_number: string; status: string;
  warehouse_id: string | null; warranty_end_date: string | null;
  warranty_start_date: string | null; purchase_date: string | null;
  sale_invoice_no: string | null; customer_id: string | null; installation_date: string | null;
};
type Product = { id: string; name: string; brand: string | null; model: string | null; description: string | null; serial_tracking: boolean; warranty_applicable: boolean };
type Customer = { id: string; company: string | null; contact_name: string | null };

/** Group by canonical model + OEM only; name/description are never part of the key. */
const groupKey = (r: { part_model_no: string | null; oem: string | null }) =>
  `${(r.part_model_no || "").toLowerCase()}|${(r.oem || "").toLowerCase()}`;

/** Product column shows ONLY the model number — no brand/name/description. */
const productLabel = (r: { part_model_no: string | null }) => r.part_model_no || "—";

/** One-serial-per-row: split comma/newline joined serials. */
function splitSerials(v: string | null): string[] {
  if (!v) return [];
  return v.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
}

function ReportsPage() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [serials, setSerials] = useState<Serial[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tab, setTab] = useState("stock-summary");
  const [wh, setWh] = useState("__all");
  const [prod, setProd] = useState("__all");
  const [q, setQ] = useState("");
  const [openSerialGroups, setOpenSerialGroups] = useState<Record<string, boolean>>({});
  // per-tab compact/detailed views (each tab remembers)
  const [stockView, setStockView] = useState<"compact" | "detailed">("compact");
  const [ledgerView, setLedgerView] = useState<"compact" | "detailed">("compact");
  const [serialView, setSerialView] = useState<"compact" | "detailed">("compact");
  const [warrantyView, setWarrantyView] = useState<"compact" | "detailed">("detailed");

  useEffect(() => {
    (async () => {
      const [stRes, w, s, p] = await Promise.all([
        fetchStockPage({ page: 0, pageSize: 500 }),
        listWarehouses(),
        supabase.from("serials").select("*"),
        supabase.from("products").select("id,name,brand,model,description,serial_tracking,warranty_applicable"),
      ]);
      setStock(stRes.data as StockItem[]);
      setWarehouses(w);
      setSerials((s.data || []) as any);
      setProducts((p.data || []) as any);
      const ids = ((s.data || []) as any[]).map((x) => x.customer_id);
      const { data: c } = ids.filter(Boolean).length
        ? await supabase.from("customers").select("id,company,contact_name").in("id", Array.from(new Set(ids.filter(Boolean))).slice(0, 1000))
        : { data: [] as any[] };
      setCustomers((c || []) as any);
    })();
  }, []);

  const pMap = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const wMap = useMemo(() => Object.fromEntries(warehouses.map((w) => [w.id, w])), [warehouses]);
  const cMap = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);
  const plainWhName = (id: string | null | undefined) => (id ? (wMap[id]?.name || "—") : "—");

  const stockProducts = useMemo(() => {
    const m = new Map<string, string>();
    stock.forEach((r) => { if (!m.has(groupKey(r))) m.set(groupKey(r), productLabel(r)); });
    return [...m.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [stock]);

  const filteredStock = useMemo(() => stock.filter((r) => {
    if (wh !== "__all" && r.warehouse_id !== wh) return false;
    if (prod !== "__all" && groupKey(r) !== prod) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![r.part_serial_no, r.part_name, r.part_model_no, r.oem, r.customer_name, r.transaction_ref]
        .some((v) => (v || "").toLowerCase().includes(s))) return false;
    }
    return true;
  }), [stock, wh, prod, q]);

  /** Stock Summary: available stock only, grouped by warehouse + product — compact intelligence (105) */
  const stockGroups = useMemo(() => {
    const m = new Map<string, { warehouse: string; product: string; oem: string; good: number; defective: number; qty: number }>();
    filteredStock.filter((r) => r.stock_status === "available").forEach((r) => {
      const key = `${r.warehouse_id || "__"}_${groupKey(r)}`;
      const e = m.get(key) || { warehouse: plainWhName(r.warehouse_id), product: productLabel(r), oem: r.oem || "—", good: 0, defective: 0, qty: 0 };
      const n = Number(r.qty ?? 1) || 0;
      if (r.stock_type === "defective") e.defective += n; else e.good += n;
      e.qty += n;
      m.set(key, e);
    });
    return Array.from(m.values()).sort((a, b) => a.warehouse.localeCompare(b.warehouse) || a.product.localeCompare(b.product));
  }, [filteredStock, warehouses]);

  /** Ledger figure (all statuses) for correct 126 vs 105 disclosure */
  const stockAllStats = useMemo(() => {
    let goodAll = 0, defectiveAll = 0, availableGood = 0, reserved = 0, inTransit = 0, issued = 0, returned = 0, scrapped = 0;
    filteredStock.forEach((r) => {
      const n = Number(r.qty ?? 1) || 0;
      if (r.stock_type === "defective") defectiveAll += n; else goodAll += n;
      if (r.stock_status === "available" && r.stock_type !== "defective") availableGood += n;
      if (r.stock_status === "reserved") reserved += n;
      if (r.stock_status === "in_transit") inTransit += n;
      if (r.stock_status === "issued") issued += n;
      if (r.stock_status === "returned_to_oem") returned += n;
      if (r.stock_status === "scrapped") scrapped += n;
    });
    return { goodAll, availableGood, defectiveAll, reserved, inTransit, issued, returned, scrapped, totalAll: goodAll + defectiveAll };
  }, [filteredStock]);

  /** Serial tracking: grouped by Model No + Warehouse */
  const serialGroups = useMemo(() => {
    type SerialEntry = { sn: string; type: StockType };
    const m = new Map<string, { key: string; model: string; oem: string; warehouse: string; serialMap: Map<string, StockType> }>();
    filteredStock.filter((r) => r.stock_status === "available").forEach((r) => {
      const list = splitSerials(r.part_serial_no);
      if (list.length === 0) return;
      const key = `${r.warehouse_id || "__"}_${groupKey(r)}`;
      let e = m.get(key);
      if (!e) {
        e = { key, model: r.part_model_no || "—", oem: r.oem || "—", warehouse: plainWhName(r.warehouse_id), serialMap: new Map<string, StockType>() };
        m.set(key, e);
      }
      for (const sn of list) {
        const cur = e.serialMap.get(sn);
        if (!cur) e.serialMap.set(sn, r.stock_type);
        else if (cur === "good" && r.stock_type === "defective") e.serialMap.set(sn, "defective");
      }
    });
    return Array.from(m.values())
      .map((g) => {
        const serials: SerialEntry[] = Array.from(g.serialMap.entries()).map(([sn, type]) => ({ sn, type })).sort((a, b) => a.sn.localeCompare(b.sn));
        const good = serials.filter((s) => s.type === "good").length;
        const defective = serials.filter((s) => s.type === "defective").length;
        return { key: g.key, model: g.model, oem: g.oem, warehouse: g.warehouse, qty: serials.length, good, defective, serials };
      })
      .sort((a, b) => a.model.localeCompare(b.model) || a.warehouse.localeCompare(b.warehouse));
  }, [filteredStock, warehouses]);

  const totalGoodSerials = useMemo(() => serialGroups.reduce((s, g) => s + g.good, 0), [serialGroups]);
  const totalDefectiveSerials = useMemo(() => serialGroups.reduce((s, g) => s + g.defective, 0), [serialGroups]);

  const enriched = useMemo(() => serials.map((s) => ({
    ...s,
    product: pMap[s.product_id]?.name || "—",
    brand_model: [pMap[s.product_id]?.brand, pMap[s.product_id]?.model].filter(Boolean).join(" / ") || "",
    customer: s.customer_id ? (cMap[s.customer_id]?.company || cMap[s.customer_id]?.contact_name || "—") : "—",
  })), [serials, pMap, cMap]);

  const filtered = useMemo(() => enriched.filter((r) => {
    if (wh !== "__all" && r.warehouse_id !== wh) return false;
    if (q) {
      const s = q.toLowerCase();
      if (![r.serial_number, r.product, r.customer, r.sale_invoice_no || ""].some((v) => (v || "").toLowerCase().includes(s))) return false;
    }
    return true;
  }), [enriched, wh, q]);

  const today = istTodayIso();
  const in30 = daysAgoIst(-30);
  const warrantyRows = useMemo(() => filtered.filter((r) => r.warranty_end_date), [filtered]);
  function warrantyState(end: string) {
    if (end < today) return { label: "Expired", cls: "bg-red-100 text-red-800" };
    if (end <= in30) return { label: "Expiring Soon", cls: "bg-amber-100 text-amber-800" };
    return { label: "Active", cls: "bg-green-100 text-green-800" };
  }

  const ViewToggle = ({ value, onChange }: { value: "compact" | "detailed"; onChange: (v: "compact" | "detailed") => void }) => (
    <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as any)} variant="default" size="sm" className="h-8 rounded-full border border-border bg-muted p-1 gap-1">
      <ToggleGroupItem value="compact" aria-label="Compact" className="rounded-full px-3 py-1 text-xs font-medium gap-1.5 border-0 bg-transparent text-muted-foreground hover:bg-card hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:border-primary transition-colors">
        <LayoutGrid className="h-3.5 w-3.5" /> Compact
      </ToggleGroupItem>
      <ToggleGroupItem value="detailed" aria-label="Detailed" className="rounded-full px-3 py-1 text-xs font-medium gap-1.5 border-0 bg-transparent text-muted-foreground hover:bg-card hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:border-primary transition-colors">
        <List className="h-3.5 w-3.5" /> Detailed
      </ToggleGroupItem>
    </ToggleGroup>
  );

  // counts for tabs (stock-summary = compact groups, ledger = filteredStock length proxy)
  const ledgerCompactCount = useMemo(() => {
    // distinct products in filteredStock regardless of status (for compact matrix header)
    const s = new Set(filteredStock.map((r) => groupKey(r)));
    return s.size;
  }, [filteredStock]);

  return (
    <div className="space-y-5">
      <ReportsPageHeader />

      <ReportsFilters
        warehouses={warehouses}
        stockProducts={stockProducts}
        wh={wh}
        prod={prod}
        q={q}
        onWhChange={setWh}
        onProdChange={setProd}
        onQChange={setQ}
        onClearAll={() => { setWh("__all"); setProd("__all"); setQ(""); }}
        resultsCount={tab === "stock-summary" ? stockGroups.length : tab === "stock-ledger" ? (ledgerView === "compact" ? ledgerCompactCount : filteredStock.length) : tab === "serials" ? serialGroups.length : warrantyRows.length}
        resultsLabel={tab === "stock-summary" ? "SKUs" : tab === "stock-ledger" ? (ledgerView === "compact" ? "Items" : "Rows") : tab === "serials" ? "Models" : "Rows"}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="inline-flex h-auto items-center gap-1 rounded-full bg-muted p-1 text-muted-foreground border border-border/40 shadow-inner">
            <TabsTrigger value="stock-summary" className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <Layers className="h-3.5 w-3.5 opacity-70" /> Stock Summary
              <span className="ml-1 inline-flex min-w-5 justify-center rounded-full bg-foreground/5 border border-border px-1.5 py-0 text-[11px] font-semibold tabular-nums">{stockGroups.length}</span>
            </TabsTrigger>
            <TabsTrigger value="stock-ledger" className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <List className="h-3.5 w-3.5 opacity-70" /> Stock Ledger
              <span className="ml-1 inline-flex min-w-5 justify-center rounded-full bg-foreground/5 border border-border px-1.5 py-0 text-[11px] font-semibold tabular-nums">{filteredStock.length}</span>
            </TabsTrigger>
            <TabsTrigger value="serials" className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <Hash className="h-3.5 w-3.5 opacity-70" /> Serial Tracking
              <span className="ml-1 inline-flex min-w-5 justify-center rounded-full bg-foreground/5 border border-border px-1.5 py-0 text-[11px] font-semibold tabular-nums">{serialGroups.length}</span>
            </TabsTrigger>
            <TabsTrigger value="warranty" className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
              <Shield className="h-3.5 w-3.5 opacity-70" /> Warranty
              <span className="ml-1 inline-flex min-w-5 justify-center rounded-full bg-foreground/5 border border-border px-1.5 py-0 text-[11px] font-semibold tabular-nums">{warrantyRows.length}</span>
            </TabsTrigger>
          </TabsList>
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
            {tab === "stock-summary" && <ViewToggle value={stockView} onChange={setStockView} />}
            {tab === "stock-ledger" && <ViewToggle value={ledgerView} onChange={setLedgerView} />}
            {tab === "serials" && <ViewToggle value={serialView} onChange={setSerialView} />}
            {tab === "warranty" && <ViewToggle value={warrantyView} onChange={setWarrantyView} />}
          </div>
        </div>

        {/* STOCK SUMMARY — compact grouped (Available-only 105) + detailed disclosure */}
        <TabsContent value="stock-summary" className="mt-4 space-y-4">
          {stockView === "compact" ? (
            <>
              <StockWarehouseKpis groups={stockGroups} />
              <div className="rounded-xl border border-border/60 bg-card shadow-sm p-3">
                <Suspense fallback={<DisclosureFallback />}>
                  <StockSummaryDisclosure filteredStock={filteredStock as any} />
                </Suspense>
                <p className="text-[11px] text-muted-foreground mt-2 text-center">
                  Compact shows <span className="font-semibold text-emerald-700">Available only (105)</span> — switch to Stock Ledger → Detailed for full 126 (All statuses)
                </p>
              </div>
              <Card className="overflow-hidden rounded-xl border-border/60 bg-card shadow-sm">
                <StockWarehouseHeader count={stockGroups.length}>
                  <ExportButtons name="Stock_Summary" title="Stock Summary (Available)" rows={stockGroups} columns={[
                    { header: "Warehouse", get: (r) => r.warehouse },
                    { header: "OEM", get: (r) => r.oem },
                    { header: "Product", get: (r) => r.product },
                    { header: "Good", get: (r) => r.good },
                    { header: "Defective", get: (r) => r.defective },
                    { header: "Total", get: (r) => r.qty },
                  ]} />
                </StockWarehouseHeader>
                <CardContent className="p-0">
                  <StockWarehouseTable groups={stockGroups} />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="overflow-hidden rounded-xl border-border/60 bg-card shadow-sm">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm flex items-center gap-2">
                  Stock Summary — Detailed
                  <span className="text-xs font-normal text-muted-foreground">Available breakdown by status</span>
                </CardTitle>
                <Suspense fallback={<DisclosureFallback />}>
                  <StockSummaryDisclosure filteredStock={filteredStock as any} />
                </Suspense>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/80">
                        <TableHead className="text-[11px] tracking-widest uppercase">Status</TableHead>
                        <TableHead className="text-right text-[11px] tracking-widest uppercase">Good</TableHead>
                        <TableHead className="text-right text-[11px] tracking-widest uppercase">Defective</TableHead>
                        <TableHead className="text-right text-[11px] tracking-widest uppercase">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell><Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-700">Available</Badge></TableCell>
                        <TableCell className="text-right">{stockAllStats.availableGood}</TableCell>
                        <TableCell className="text-right">{stockGroups.reduce((s,g)=>s+g.defective,0)}</TableCell>
                        <TableCell className="text-right font-semibold">{stockGroups.reduce((s,g)=>s+g.qty,0)}</TableCell>
                      </TableRow>
                      <TableRow className="bg-muted/20">
                        <TableCell><Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-700">Reserved / In transit / Issued</Badge></TableCell>
                        <TableCell className="text-right">{stockAllStats.reserved + stockAllStats.inTransit + stockAllStats.issued}</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right">{stockAllStats.reserved + stockAllStats.inTransit + stockAllStats.issued}</TableCell>
                      </TableRow>
                      <TableRow className="font-semibold bg-muted/30 border-t-2">
                        <TableCell>Total (All statuses)</TableCell>
                        <TableCell className="text-right">{stockAllStats.goodAll}</TableCell>
                        <TableCell className="text-right">{stockAllStats.defectiveAll}</TableCell>
                        <TableCell className="text-right text-primary">{stockAllStats.totalAll} (126)</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground p-3 border-t">
                  Detailed here still grouped — for line-item rows switch to <span className="font-semibold text-primary">Stock Ledger → Detailed</span>
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* STOCK LEDGER — Sales Stock matrix (compact) + line-item ledger (detailed, All 126) */}
        <TabsContent value="stock-ledger" className="mt-4 space-y-4">
          <div className="flex sm:hidden justify-end">
            <ViewToggle value={ledgerView} onChange={setLedgerView} />
          </div>
          {ledgerView === "compact" ? (
            <Card className="overflow-hidden rounded-xl border-border/60 bg-card shadow-sm">
              <CardHeader className="pb-3 border-b flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  Stock Ledger — Compact (By Warehouse Type)
                  <span className="hidden sm:inline text-xs font-normal text-muted-foreground">Godown (NIT-3) vs Service (Picasso) • Good/Scrap matrix</span>
                </CardTitle>
                <ExportButtons name="Stock_Ledger_Compact" title="Stock Ledger Compact" rows={filteredStock} columns={[
                  { header: "Item", get: (r) => r.part_model_no || r.part_name || "" },
                  { header: "Warehouse", get: (r) => plainWhName(r.warehouse_id) },
                  { header: "Type", get: (r) => r.stock_type },
                  { header: "Status", get: (r) => r.stock_status },
                  { header: "Qty", get: (r) => r.qty },
                ]} />
              </CardHeader>
              <CardContent className="p-0">
                <Suspense fallback={<LedgerFallback />}>
                  <StockLedgerCompact items={filteredStock as any} warehouses={warehouses as any} products={products as any} />
                </Suspense>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden rounded-xl border-border/60 bg-card shadow-sm">
              <CardHeader className="pb-3 border-b">
                <CardTitle className="text-sm flex items-center gap-2">
                  Stock Ledger — Detailed (All statuses • {stockAllStats.totalAll} units)
                  <Badge variant="outline" className="bg-primary text-primary-foreground border-primary">Full 126</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">Shows every stock row (Available + Reserved + In transit + Issued…) — use filters to reach the Summary’s 105 Available</p>
              </CardHeader>
              <CardContent className="p-0">
                <Suspense fallback={<LedgerFallback />}>
                  <StockLedgerDetailed items={filteredStock as any} warehouses={warehouses as any} />
                </Suspense>
              </CardContent>
            </Card>
          )}
          <p className="text-[11px] text-center text-muted-foreground">
            Writes stay in <span className="font-semibold">Inventory → Stock</span> only (read-only here) — matches your rule.
          </p>
        </TabsContent>

        <TabsContent value="serials" className="mt-4">
          <div className="sm:hidden flex justify-end mb-2"><ViewToggle value={serialView} onChange={setSerialView} /></div>
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="space-y-2">
                <CardTitle className="text-base">Serial Number Tracking ({serialGroups.length}) {serialView === "detailed" && <Badge variant="outline" className="ml-2 text-xs">Detailed</Badge>}</CardTitle>
                {serialGroups.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                      <CircleCheck className="h-3.5 w-3.5" /> Good · {totalGoodSerials}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 font-medium text-rose-700">
                      <TriangleAlert className="h-3.5 w-3.5" /> Defective · {totalDefectiveSerials}
                    </span>
                    <span className="text-muted-foreground ml-1">
                      {totalGoodSerials + totalDefectiveSerials} total serials · {serialView === "compact" ? "grouped" : "per-serial timeline"}
                    </span>
                  </div>
                )}
              </div>
              <ExportButtons name="Serial_Tracking" title="Serial Number Tracking" rows={serialGroups} columns={[
                { header: "Model No", get: (r) => r.model },
                { header: "Warehouse", get: (r) => r.warehouse },
                { header: "Good", get: (r) => r.good },
                { header: "Defective", get: (r) => r.defective },
                { header: "Total Qty", get: (r) => r.qty },
                { header: "Serials (Good=BAD tagged)", get: (r) => r.serials.map((s) => `${s.sn} [${s.type}]`).join(", ") },
              ]} />
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {serialView === "compact" ? (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Model No</TableHead><TableHead>Warehouse</TableHead>
                    <TableHead className="text-center">Good</TableHead>
                    <TableHead className="text-center">Defective</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {serialGroups.map((g) => {
                      const open = !!openSerialGroups[g.key];
                      return (
                        <Fragment key={g.key}>
                          <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setOpenSerialGroups((s) => ({ ...s, [g.key]: !s[g.key] }))}>
                            <TableCell className="w-8 text-muted-foreground">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</TableCell>
                            <TableCell className="font-medium">{g.model}</TableCell>
                            <TableCell>{g.warehouse}</TableCell>
                            <TableCell className="text-center">{g.good > 0 ? <span className="inline-flex items-center justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 min-w-6">{g.good}</span> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                            <TableCell className="text-center">{g.defective > 0 ? <span className="inline-flex items-center justify-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 min-w-6">{g.defective}</span> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                            <TableCell className="text-right font-medium">{g.qty}</TableCell>
                          </TableRow>
                          {open && (
                            <TableRow className="bg-muted/20 hover:bg-muted/20">
                              <TableCell />
                              <TableCell colSpan={5} className="py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                                  <div className="flex items-center gap-3 text-xs">
                                    <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Good ({g.good})</span>
                                    <span className="inline-flex items-center gap-1.5 font-medium text-rose-700"><span className="h-2 w-2 rounded-full bg-rose-500" /> Defective ({g.defective})</span>
                                  </div>
                                  <span className="text-xs text-muted-foreground">Serial numbers ({g.serials.length})</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {g.serials.map(({ sn, type }) => {
                                    const isBad = type === "defective";
                                    return (
                                      <Badge key={sn} variant="outline" className={`inline-flex items-center gap-1.5 font-mono text-[11px] py-1 pl-2 pr-1.5 border shadow-sm ${isBad ? "bg-rose-50 border-rose-300 text-rose-800" : "bg-emerald-50 border-emerald-300 text-emerald-800"}`}>
                                        <span className={`h-1.5 w-1.5 rounded-full ${isBad ? "bg-rose-500" : "bg-emerald-500"}`} />{sn}
                                        <span className={`ml-1 rounded px-1 py-0.5 text-[9px] font-bold ${isBad ? "bg-rose-500 text-white" : "bg-emerald-600 text-white"}`}>{isBad ? "BAD" : "GOOD"}</span>
                                      </Badge>
                                    );
                                  })}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                    {serialGroups.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No serialised stock matches these filters.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              ) : (
                <div className="space-y-3">
                  {serialGroups.slice(0, 8).map((g) => (
                    <Card key={g.key} className="border-border/60">
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <Hash className="h-3.5 w-3.5 text-muted-foreground" /> {g.model} · {g.warehouse} · {g.qty} serials
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {g.serials.slice(0, 12).map(({ sn, type }) => (
                            <Badge key={sn} variant="outline" className={`font-mono text-[11px] ${type === "defective" ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>{sn}</Badge>
                          ))}
                          {g.serials.length > 12 && <span className="text-xs text-muted-foreground">+{g.serials.length - 12} more</span>}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  <p className="text-xs text-muted-foreground text-center">Detailed shows per-serial cards (up to 8 groups) — for full timeline use /ims/serial-track search</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warranty" className="mt-4">
          <div className="sm:hidden flex justify-end mb-2"><ViewToggle value={warrantyView} onChange={setWarrantyView} /></div>
          {warrantyView === "compact" ? (
            <Card className="rounded-xl border-border/60 bg-card shadow-sm">
              <CardContent className="p-4 grid sm:grid-cols-3 gap-3">
                {[
                  { label: "Active", n: warrantyRows.filter((r) => warrantyState(r.warranty_end_date!).label === "Active").length, cls: "bg-emerald-500", bar: "from-emerald-500/20" },
                  { label: "Expiring Soon", n: warrantyRows.filter((r) => warrantyState(r.warranty_end_date!).label === "Expiring Soon").length, cls: "bg-amber-500", bar: "from-amber-500/20" },
                  { label: "Expired", n: warrantyRows.filter((r) => warrantyState(r.warranty_end_date!).label === "Expired").length, cls: "bg-red-500", bar: "from-red-500/20" },
                ].map((c) => (
                  <div key={c.label} className={`relative overflow-hidden rounded-xl border border-border/60 bg-card p-4 shadow-sm bg-gradient-to-br ${c.bar} to-transparent`}>
                    <div className={`absolute left-0 top-0 h-full w-[3px] ${c.cls}`} />
                    <div className="text-[11px] tracking-widest uppercase font-semibold text-muted-foreground">{c.label}</div>
                    <div className="text-2xl font-bold tabular-nums mt-1">{c.n}</div>
                    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden"><div className={`h-full ${c.cls}`} style={{ width: `${warrantyRows.length ? (c.n / warrantyRows.length) * 100 : 0}%` }} /></div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <ReportsWarrantyShell
              count={warrantyRows.length}
              actions={(
                <ExportButtons name="Warranty_Status" title="Warranty Status" rows={warrantyRows} columns={[
                  { header: "Serial", get: (r) => r.serial_number },
                  { header: "Product", get: (r) => r.product },
                  { header: "Customer", get: (r) => r.customer },
                  { header: "Start", get: (r) => r.warranty_start_date || "" },
                  { header: "End", get: (r) => r.warranty_end_date || "" },
                  { header: "Status", get: (r) => warrantyState(r.warranty_end_date!).label },
                ]} />
              )}
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Serial</TableHead><TableHead>Product</TableHead><TableHead>Customer</TableHead>
                    <TableHead>Start</TableHead><TableHead>End</TableHead><TableHead>State</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {warrantyRows.map((r) => {
                      const st = warrantyState(r.warranty_end_date!);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">{r.serial_number}</TableCell>
                          <TableCell className="text-xs">{r.product}</TableCell>
                          <TableCell className="text-xs">{r.customer}</TableCell>
                          <TableCell className="text-xs">{r.warranty_start_date || "—"}</TableCell>
                          <TableCell className="text-xs">{r.warranty_end_date}</TableCell>
                          <TableCell><span className={`inline-flex rounded px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span></TableCell>
                        </TableRow>
                      );
                    })}
                    {warrantyRows.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No warranty records.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </div>
            </ReportsWarrantyShell>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
