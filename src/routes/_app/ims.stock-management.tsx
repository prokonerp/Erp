import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ChevronDown, ChevronRight, Package, Search, Warehouse as WarehouseIcon,
  Boxes, CheckCircle2, Clock, Send, ShieldCheck, AlertTriangle, Trash2, Inbox,
  X, RefreshCw, Layers, ArrowDownCircle, ArrowUpCircle, TrendingUp, Printer,
  FileText, ExternalLink, Activity, Hash,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { exportCSV } from "@/lib/exports";
import { supabase } from "@/integrations/supabase/client";
import {
  listStock, listTransactions, listWarehouses,
  STOCK_STATUS_LABEL, TXN_TYPE_LABEL,
  type StockItem, type Transaction, type WarehouseLite,
} from "@/lib/ims";
import { StockStatusBadge } from "@/components/StockStatusBadge";

// Lazy-load the recharts-backed chart sections (~400KB) so the stock table and
// filters render immediately, without waiting on recharts.
const StockDashboardCharts = lazy(
  () => import("@/components/StockManagementCharts").then((m) => ({ default: m.StockDashboardCharts })),
);
const ProductDetailCharts = lazy(
  () => import("@/components/StockManagementCharts").then((m) => ({ default: m.ProductDetailCharts })),
);

export const Route = createFileRoute("/_app/ims/stock-management")({
  component: StockManagement,
});

type GrnSource = "oem" | "customer" | "general" | "other";

function grnSourceOf(ref: string | null | undefined): GrnSource | null {
  if (!ref) return null;
  const r = ref.toUpperCase();
  if (!r.startsWith("GRN ")) return null;
  if (r.includes("GRN-OEM")) return "oem";
  if (r.includes("GRN-CUST")) return "customer";
  if (r.includes("GRN-GEN")) return "general";
  return "other";
}

type ReceivedAgg = {
  total: number;
  oem: number;
  customer: number;
  general: number;
  latestGrn: string | null;
  latestDate: string | null;
  txns: Transaction[];
};

const emptyReceived = (): ReceivedAgg => ({
  total: 0, oem: 0, customer: 0, general: 0,
  latestGrn: null, latestDate: null, txns: [],
});

function accumulateReceived(agg: ReceivedAgg, t: Transaction) {
  const src = grnSourceOf(t.reference);
  if (!src) return;
  if (t.txn_type !== "good_in" && t.txn_type !== "defective_in") return;
  const q = Number(t.qty) || 0;
  agg.total += q;
  if (src === "oem") agg.oem += q;
  else if (src === "customer") agg.customer += q;
  else if (src === "general") agg.general += q;
  agg.txns.push(t);
  const d = t.txn_date;
  if (!agg.latestDate || d > agg.latestDate) {
    agg.latestDate = d;
    agg.latestGrn = (t.reference || "").replace(/^GRN\s+/i, "") || null;
  }
}

type ProductRow = {
  key: string;
  part_name: string;
  part_model_no: string | null;
  oem: string | null;
  category: string | null;
  total: number;
  available: number;
  reserved: number;
  issued: number;
  good: number;
  defective: number;
  scrapped: number;
  warehouses: Set<string>;
  items: StockItem[];
  received: ReceivedAgg;
};

function keyOf(s: StockItem) {
  return `${(s.part_model_no || "").toLowerCase()}|${s.part_name.toLowerCase()}`;
}

function txnKey(t: Transaction) {
  return `${(t.part_model_no || "").toLowerCase()}|${(t.part_name || "").toLowerCase()}`;
}

function aggregate(items: StockItem[], txns: Transaction[]): ProductRow[] {
  const map = new Map<string, ProductRow>();
  for (const s of items) {
    const k = keyOf(s);
    let r = map.get(k);
    if (!r) {
      r = {
        key: k, part_name: s.part_name, part_model_no: s.part_model_no,
        oem: s.oem, category: s.category,
        total: 0, available: 0, reserved: 0, issued: 0, good: 0, defective: 0, scrapped: 0,
        warehouses: new Set(), items: [], received: emptyReceived(),
      };
      map.set(k, r);
    }
    const q = s.qty ?? 1;
    r.total += q;
    if (s.stock_status === "available") r.available += q;
    if (s.stock_status === "reserved") r.reserved += q;
    if (s.stock_status === "issued") r.issued += q;
    if (s.stock_status === "scrapped") r.scrapped += q;
    if (s.stock_type === "good") r.good += q;
    if (s.stock_type === "defective") r.defective += q;
    if (s.warehouse_id) r.warehouses.add(s.warehouse_id);
    r.items.push(s);
  }
  for (const t of txns) {
    const k = txnKey(t);
    const r = map.get(k);
    if (!r) continue;
    accumulateReceived(r.received, t);
  }
  return Array.from(map.values()).sort((a, b) => a.part_name.localeCompare(b.part_name));
}

function warehouseBreakdown(items: StockItem[], whName: (id: string | null) => string) {
  const map = new Map<string, { name: string; total: number; available: number; reserved: number; issued: number; good: number; defective: number; scrap: number }>();
  for (const s of items) {
    const id = s.warehouse_id || "—";
    let r = map.get(id);
    if (!r) { r = { name: whName(s.warehouse_id), total: 0, available: 0, reserved: 0, issued: 0, good: 0, defective: 0, scrap: 0 }; map.set(id, r); }
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

function StockManagement() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [oemFilter, setOemFilter] = useState("all");
  const [whFilter, setWhFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [s, t, w] = await Promise.all([listStock(), listTransactions(), listWarehouses()]);
      setItems(s);
      setTxns(t);
      setWarehouses(w);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // Realtime: refresh on any stock item change
  useEffect(() => {
    const ch = supabase
      .channel("stock-management-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "ims_stock_items" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "ims_transactions" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const whName = (id: string | null) => warehouses.find((w) => w.id === id)?.name || "—";

  const filteredItems = useMemo(() => {
    const s = q.toLowerCase().trim();
    return items.filter((r) => {
      if (oemFilter !== "all" && (r.oem || "") !== oemFilter) return false;
      if (whFilter !== "all" && r.warehouse_id !== whFilter) return false;
      if (statusFilter !== "all" && r.stock_status !== statusFilter) return false;
      if (!s) return true;
      return [r.part_name, r.part_model_no, r.part_serial_no, r.oem, r.category, r.customer_name]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [items, q, oemFilter, whFilter, statusFilter]);

  const products = useMemo(() => aggregate(filteredItems, txns), [filteredItems, txns]);

  const oems = useMemo(() => Array.from(new Set(items.map((i) => i.oem).filter(Boolean))).sort() as string[], [items]);

  const summary = useMemo(() => {
    let total = 0, available = 0, reserved = 0, issued = 0, good = 0, defective = 0, scrap = 0;
    let recvTotal = 0, recvOem = 0, recvCust = 0, recvGen = 0;
    for (const s of filteredItems) {
      const qv = s.qty ?? 1;
      total += qv;
      if (s.stock_status === "available") available += qv;
      if (s.stock_status === "reserved") reserved += qv;
      if (s.stock_status === "issued") issued += qv;
      if (s.stock_status === "scrapped") scrap += qv;
      if (s.stock_type === "good") good += qv;
      if (s.stock_type === "defective") defective += qv;
    }
    for (const p of products) {
      recvTotal += p.received.total;
      recvOem += p.received.oem;
      recvCust += p.received.customer;
      recvGen += p.received.general;
    }
    return { total, available, reserved, issued, good, defective, scrap,
      products: products.length, recvTotal, recvOem, recvCust, recvGen };
  }, [filteredItems, products]);

  const compositionData = useMemo(() => ([
    { name: "Good", value: summary.good, color: "#10b981" },
    { name: "Defective", value: summary.defective, color: "#f43f5e" },
    { name: "Scrap", value: summary.scrap, color: "#64748b" },
  ].filter((d) => d.value > 0)), [summary]);

  const warehouseChart = useMemo(() => {
    const map = new Map<string, { name: string; Available: number; Reserved: number; Issued: number; Defective: number }>();
    for (const s of filteredItems) {
      const name = whName(s.warehouse_id);
      let r = map.get(name);
      if (!r) { r = { name, Available: 0, Reserved: 0, Issued: 0, Defective: 0 }; map.set(name, r); }
      const q = s.qty ?? 1;
      if (s.stock_status === "available") r.Available += q;
      if (s.stock_status === "reserved") r.Reserved += q;
      if (s.stock_status === "issued") r.Issued += q;
      if (s.stock_type === "defective" && s.stock_status !== "issued") r.Defective += q;
    }
    return Array.from(map.values())
      .sort((a, b) => (b.Available + b.Reserved + b.Issued + b.Defective) - (a.Available + a.Reserved + a.Issued + a.Defective))
      .slice(0, 8);
  }, [filteredItems, warehouses]);

  function toggleExpand(k: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" /> Stock Management
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Real-time inventory across warehouses, OEMs and product lines.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* KPI cards */}
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
              <SelectTrigger className="h-9"><SelectValue placeholder="OEM" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All OEMs</SelectItem>
                {oems.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={whFilter} onValueChange={setWhFilter}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Warehouse" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STOCK_STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Filter chips */}
          {(q || oemFilter !== "all" || whFilter !== "all" || statusFilter !== "all") && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t">
              <span className="text-xs text-muted-foreground mr-1">Active filters:</span>
              {q && <Chip onClear={() => setQ("")}>Search: “{q}”</Chip>}
              {oemFilter !== "all" && <Chip onClear={() => setOemFilter("all")}>OEM: {oemFilter}</Chip>}
              {whFilter !== "all" && <Chip onClear={() => setWhFilter("all")}>Warehouse: {whName(whFilter)}</Chip>}
              {statusFilter !== "all" && <Chip onClear={() => setStatusFilter("all")}>Status: {STOCK_STATUS_LABEL[statusFilter as keyof typeof STOCK_STATUS_LABEL] || statusFilter}</Chip>}
              <Button
                variant="ghost" size="sm" className="h-6 px-2 text-xs"
                onClick={() => { setQ(""); setOemFilter("all"); setWhFilter("all"); setStatusFilter("all"); }}
              >Clear all</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Product Grid */}
      <Card className="rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/30">
          <div className="text-sm font-medium flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            Products <span className="text-muted-foreground font-normal">({products.length})</span>
          </div>
          <div className="text-xs text-muted-foreground">Click a row to open details</div>
        </div>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0 z-10 border-b">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="p-2.5 w-8"></th>
                  <th className="p-2.5">Product</th>
                  <th className="p-2.5">Model / Code</th>
                  <th className="p-2.5">OEM</th>
                  <th className="p-2.5 text-right">Total</th>
                  <th className="p-2.5 text-right">Available</th>
                  <th className="p-2.5 text-right">Reserved</th>
                  <th className="p-2.5 text-right">Issued</th>
                  <th className="p-2.5 text-right">Good</th>
                  <th className="p-2.5 text-right">Defective</th>
                  <th className="p-2.5 text-right" title="Received via GRN — total">Received</th>
                  <th className="p-2.5">Latest GRN</th>
                  <th className="p-2.5 text-right">WH</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={13} className="p-6 text-center text-muted-foreground">Loading inventory…</td></tr>
                ) : products.length === 0 ? (
                  <tr><td colSpan={13} className="p-6 text-center text-muted-foreground">No stock matches your filters.</td></tr>
                ) : products.map((p, idx) => {
                  const isOpen = expanded.has(p.key);
                  const wh = warehouseBreakdown(p.items, whName);
                  const zebra = idx % 2 === 1 ? "bg-muted/10" : "";
                  return (
                    <>
                      <tr
                        key={p.key}
                        className={`border-t transition-colors hover:bg-primary/5 cursor-pointer ${zebra}`}
                        onClick={() => setSelectedProduct(p)}
                      >
                        <td className="p-2.5" onClick={(e) => { e.stopPropagation(); toggleExpand(p.key); }}>
                          <button className="p-0.5 rounded hover:bg-muted" title={isOpen ? "Collapse" : "Expand"}>
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="p-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="h-8 w-8 rounded-md bg-primary/10 text-primary grid place-items-center shrink-0">
                              <Package className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{p.part_name}</div>
                              <div className="text-[11px] text-muted-foreground truncate">{p.category || "—"}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-2.5 font-mono text-xs">{p.part_model_no || "—"}</td>
                        <td className="p-2.5">{p.oem || "—"}</td>
                        <td className="p-2.5 text-right font-semibold tabular-nums">{p.total}</td>
                        <td className="p-2.5 text-right"><NumPill value={p.available} tone="emerald" /></td>
                        <td className="p-2.5 text-right"><NumPill value={p.reserved} tone="amber" /></td>
                        <td className="p-2.5 text-right"><NumPill value={p.issued} tone="violet" /></td>
                        <td className="p-2.5 text-right tabular-nums text-emerald-700">{p.good || "—"}</td>
                        <td className="p-2.5 text-right tabular-nums text-rose-700">{p.defective || "—"}</td>
                        <td className="p-2.5 text-right font-medium tabular-nums">{p.received.total || "—"}</td>
                        <td className="p-2.5 text-xs">
                          {p.received.latestGrn ? (
                            <>
                              <div className="font-mono">{p.received.latestGrn}</div>
                              {p.received.latestDate && <div className="text-muted-foreground">{new Date(p.received.latestDate).toLocaleDateString()}</div>}
                            </>
                          ) : "—"}
                        </td>
                        <td className="p-2.5 text-right tabular-nums">{p.warehouses.size}</td>
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
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <ProductDetailSheet
        product={selectedProduct}
        onClose={() => setSelectedProduct(null)}
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

function StatTile({ label, value, tone }: { label: string; value: number; tone?: "emerald" | "amber" | "blue" | "rose" }) {
  const cls =
    tone === "emerald" ? "text-emerald-700" :
    tone === "amber" ? "text-amber-700" :
    tone === "blue" ? "text-blue-700" :
    tone === "rose" ? "text-rose-700" : "";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-bold ${cls}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

type KpiTone = "blue" | "emerald" | "amber" | "violet" | "rose" | "slate" | "sky";
const KPI_TONES: Record<KpiTone, { bg: string; fg: string; ring: string; bar: string }> = {
  blue:    { bg: "bg-blue-50",    fg: "text-blue-700",    ring: "ring-blue-100",    bar: "bg-blue-500" },
  emerald: { bg: "bg-emerald-50", fg: "text-emerald-700", ring: "ring-emerald-100", bar: "bg-emerald-500" },
  amber:   { bg: "bg-amber-50",   fg: "text-amber-700",   ring: "ring-amber-100",   bar: "bg-amber-500" },
  violet:  { bg: "bg-violet-50",  fg: "text-violet-700",  ring: "ring-violet-100",  bar: "bg-violet-500" },
  rose:    { bg: "bg-rose-50",    fg: "text-rose-700",    ring: "ring-rose-100",    bar: "bg-rose-500" },
  slate:   { bg: "bg-slate-50",   fg: "text-slate-700",   ring: "ring-slate-100",   bar: "bg-slate-500" },
  sky:     { bg: "bg-sky-50",     fg: "text-sky-700",     ring: "ring-sky-100",     bar: "bg-sky-500" },
};

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: KpiTone }) {
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

function NumPill({ value, tone }: { value: number; tone: "emerald" | "amber" | "violet" | "rose" }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const cls =
    tone === "emerald" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
    tone === "amber"   ? "bg-amber-50 text-amber-700 border-amber-200" :
    tone === "violet"  ? "bg-violet-50 text-violet-700 border-violet-200" :
                         "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <span className={`inline-flex items-center justify-center min-w-[28px] px-1.5 py-0.5 rounded-md border text-xs font-medium tabular-nums ${cls}`}>
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
        aria-label="Remove filter"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function ProductDetailSheet({ product, onClose, whName }: {
  product: ProductRow | null;
  onClose: () => void;
  whName: (id: string | null) => string;
}) {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [serialQ, setSerialQ] = useState("");
  const [serialWh, setSerialWh] = useState<string>("all");
  const [serialCond, setSerialCond] = useState<string>("all");
  const [serialStatus, setSerialStatus] = useState<string>("all");

  useEffect(() => {
    if (!product) { setTxns([]); return; }
    setSerialQ(""); setSerialWh("all"); setSerialCond("all"); setSerialStatus("all");
    setLoadingTxns(true);
    listTransactions().then((all) => {
      const modelKey = (product.part_model_no || "").toLowerCase();
      const nameKey = product.part_name.toLowerCase();
      const filtered = all.filter((t) =>
        (t.part_model_no || "").toLowerCase() === modelKey ||
        (t.part_name || "").toLowerCase() === nameKey,
      );
      setTxns(filtered);
    }).finally(() => setLoadingTxns(false));
  }, [product]);

  if (!product) return null;
  const wh = warehouseBreakdown(product.items, whName);

  const total = product.total || 0;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const scrap = product.scrapped || 0;
  const conditionData = [
    { name: "Good", value: product.good, color: "#10b981" },
    { name: "Defective", value: product.defective - scrap > 0 ? product.defective - scrap : 0, color: "#f43f5e" },
    { name: "Scrap", value: scrap, color: "#64748b" },
  ].filter((d) => d.value > 0);

  const whChart = wh.map((w) => ({
    name: w.name,
    Good: w.good - (w.scrap > w.defective ? w.defective : w.scrap),
    Defective: Math.max(w.defective - w.scrap, 0),
    Scrap: w.scrap,
  }));

  // Health flags
  const goodPct = pct(product.good);
  const defectivePct = pct(product.defective);
  const scrapPct = pct(scrap);
  const availPct = pct(product.available);
  const issuedPct = pct(product.issued);
  const alerts: { tone: "rose" | "amber" | "sky"; msg: string }[] = [];
  if (defectivePct > 20) alerts.push({ tone: "rose", msg: `High defective share: ${defectivePct}% of total inventory` });
  if (scrapPct > 10) alerts.push({ tone: "rose", msg: `Scrap exceeds 10%: ${scrapPct}%` });
  if (total > 0 && availPct < 15) alerts.push({ tone: "amber", msg: `Low available stock: only ${availPct}% available` });
  if (issuedPct > 60) alerts.push({ tone: "sky", msg: `High issued share: ${issuedPct}% issued to customers` });

  // Merge txns + GRN receipts for a unified movement timeline w/ running balance
  const allMoves: Array<{ id: string; when: string; type: string; qty: number; dir: 1 | -1 | 0; wh: string; ref: string }> = [];
  const seen = new Set<string>();
  for (const t of txns) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const dir: 1 | -1 | 0 =
      t.txn_type === "good_in" || t.txn_type === "defective_in" || t.txn_type === "transfer_in" || t.txn_type === "oem_replacement_receipt"
        ? 1
        : t.txn_type === "good_out" || t.txn_type === "defective_out" || t.txn_type === "transfer_out" || t.txn_type === "oem_return" || t.txn_type === "scrap_adjustment"
          ? -1
          : 0;
    allMoves.push({
      id: t.id,
      when: t.txn_date,
      type: TXN_TYPE_LABEL[t.txn_type] || t.txn_type,
      qty: Number(t.qty) || 0,
      dir,
      wh: dir >= 0 ? whName(t.to_warehouse_id) : whName(t.from_warehouse_id),
      ref: t.reference || t.txn_no || "—",
    });
  }
  allMoves.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  let bal = 0;
  const timeline = allMoves.map((m) => {
    bal += m.dir * m.qty;
    return { ...m, balance: bal };
  }).reverse();

  const serialFiltered = product.items.filter((s) => {
    if (serialWh !== "all" && (s.warehouse_id || "") !== serialWh) return false;
    if (serialCond !== "all" && s.stock_type !== serialCond) return false;
    if (serialStatus !== "all" && s.stock_status !== serialStatus) return false;
    if (!serialQ) return true;
    const q = serialQ.toLowerCase();
    return [s.part_serial_no, s.part_model_no, s.transaction_ref, s.customer_name]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  });

  function exportSerials() {
    exportCSV(`${product!.part_name}-serials`, [
      { header: "Serial", get: (s: StockItem) => s.part_serial_no || "" },
      { header: "Model", get: (s: StockItem) => s.part_model_no || "" },
      { header: "Warehouse", get: (s: StockItem) => whName(s.warehouse_id) },
      { header: "Condition", get: (s: StockItem) => s.stock_type },
      { header: "Status", get: (s: StockItem) => s.stock_status },
      { header: "Ref", get: (s: StockItem) => s.transaction_ref || "" },
      { header: "Received", get: (s: StockItem) => new Date(s.created_at).toLocaleDateString() },
      { header: "Last Move", get: (s: StockItem) => new Date(s.updated_at).toLocaleDateString() },
    ], serialFiltered);
  }

  return (
    <Sheet open={!!product} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-5xl overflow-y-auto">
        <SheetHeader className="pb-3 border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
                <Package className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <SheetTitle className="truncate">{product.part_name}</SheetTitle>
                <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  <span className="font-mono">{product.part_model_no || "—"}</span>
                  <span>· OEM: {product.oem || "—"}</span>
                  <span>· {product.category || "Uncategorised"}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <Button asChild size="sm" variant="outline">
                <Link to="/ims/ledger"><FileText className="h-3.5 w-3.5 mr-1" />Ledger</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/grn"><ExternalLink className="h-3.5 w-3.5 mr-1" />GRNs</Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link to="/challan"><ExternalLink className="h-3.5 w-3.5 mr-1" />DCs</Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5 mr-1" />Print
              </Button>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-5">
          {/* KPI grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            <MiniKpi icon={Boxes}         label="Total Qty"    value={product.total}       pct={100}         tone="blue" />
            <MiniKpi icon={CheckCircle2}  label="Available"    value={product.available}   pct={pct(product.available)}  tone="emerald" />
            <MiniKpi icon={Clock}         label="Reserved"     value={product.reserved}    pct={pct(product.reserved)}   tone="amber" />
            <MiniKpi icon={Send}          label="Issued"       value={product.issued}      pct={pct(product.issued)}     tone="violet" />
            <MiniKpi icon={ShieldCheck}   label="Good"         value={product.good}        pct={goodPct}                 tone="emerald" />
            <MiniKpi icon={AlertTriangle} label="Defective"    value={product.defective}   pct={defectivePct}            tone="rose" />
            <MiniKpi icon={Trash2}        label="Scrap"        value={scrap}               pct={scrapPct}                tone="slate" />
            <MiniKpi icon={WarehouseIcon} label="Warehouses"   value={product.warehouses.size} tone="sky" />
            <MiniKpi icon={Hash}          label="Serial Units" value={product.items.length}    tone="sky" />
            <MiniKpi icon={Inbox}         label="Received (GRN)" value={product.received.total} tone="sky" />
          </div>

          {/* Health alerts */}
          {alerts.length > 0 && (
            <div className="space-y-1.5">
              {alerts.map((a, i) => (
                <div key={i} className={`flex items-center gap-2 text-xs rounded-lg border px-3 py-2 ${
                  a.tone === "rose" ? "bg-rose-50 border-rose-200 text-rose-800" :
                  a.tone === "amber" ? "bg-amber-50 border-amber-200 text-amber-800" :
                  "bg-sky-50 border-sky-200 text-sky-800"
                }`}>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{a.msg}</span>
                </div>
              ))}
            </div>
          )}

          {/* Charts */}
          <Suspense fallback={<div className="h-56 animate-pulse bg-muted rounded-xl" />}>
            <ProductDetailCharts conditionData={conditionData} whChart={whChart} pct={pct} />
          </Suspense>

          <Tabs defaultValue="warehouses">
            <TabsList>
              <TabsTrigger value="warehouses">Warehouses ({wh.length})</TabsTrigger>
              <TabsTrigger value="timeline">Timeline ({timeline.length})</TabsTrigger>
              <TabsTrigger value="received">Received ({product.received.txns.length})</TabsTrigger>
              <TabsTrigger value="serials">Serials ({product.items.length})</TabsTrigger>
              <TabsTrigger value="txns">Transactions ({txns.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="warehouses">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                {wh.map((w) => (
                  <div key={w.id} className="rounded-xl border p-3 bg-card">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-medium text-sm flex items-center gap-1.5">
                        <WarehouseIcon className="h-4 w-4 text-muted-foreground" /> {w.name}
                      </div>
                      <Badge variant="outline" className="tabular-nums">{w.total}</Badge>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-2 flex">
                      {w.good > 0 && <div style={{ width: `${(w.good / (w.total || 1)) * 100}%` }} className="bg-emerald-500" />}
                      {w.defective - w.scrap > 0 && <div style={{ width: `${((w.defective - w.scrap) / (w.total || 1)) * 100}%` }} className="bg-rose-500" />}
                      {w.scrap > 0 && <div style={{ width: `${(w.scrap / (w.total || 1)) * 100}%` }} className="bg-slate-500" />}
                    </div>
                    <div className="grid grid-cols-3 gap-1 text-xs">
                      <Stat label="Available" value={w.available} />
                      <Stat label="Reserved" value={w.reserved} />
                      <Stat label="Issued" value={w.issued} />
                      <Stat label="Good" value={w.good} />
                      <Stat label="Defective" value={w.defective} />
                      <Stat label="Scrap" value={w.scrap} />
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="timeline">
              <div className="rounded-xl border">
                {timeline.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">No stock movements recorded yet.</div>
                ) : (
                  <ul className="divide-y">
                    {timeline.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30">
                        <div className={`h-8 w-8 rounded-full grid place-items-center shrink-0 ${
                          m.dir > 0 ? "bg-emerald-50 text-emerald-700" :
                          m.dir < 0 ? "bg-rose-50 text-rose-700" :
                          "bg-slate-50 text-slate-700"
                        }`}>
                          {m.dir > 0 ? <ArrowDownCircle className="h-4 w-4" /> : m.dir < 0 ? <ArrowUpCircle className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{m.type}</div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {new Date(m.when).toLocaleString()} · {m.wh} · <span className="font-mono">{m.ref}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-semibold tabular-nums ${m.dir > 0 ? "text-emerald-700" : m.dir < 0 ? "text-rose-700" : ""}`}>
                            {m.dir > 0 ? "+" : m.dir < 0 ? "−" : ""}{m.qty}
                          </div>
                          <div className="text-[11px] text-muted-foreground tabular-nums flex items-center gap-0.5 justify-end">
                            <TrendingUp className="h-3 w-3" /> {m.balance}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </TabsContent>

            <TabsContent value="received">
              <div className="overflow-x-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="p-2">Date</th>
                      <th className="p-2">GRN No</th>
                      <th className="p-2">Source</th>
                      <th className="p-2">From</th>
                      <th className="p-2">Serial</th>
                      <th className="p-2">Warehouse</th>
                      <th className="p-2">Condition</th>
                      <th className="p-2 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.received.txns.length === 0 ? (
                      <tr><td colSpan={8} className="p-3 text-muted-foreground">No GRN receipts for this product yet.</td></tr>
                    ) : [...product.received.txns]
                        .sort((a, b) => new Date(b.txn_date).getTime() - new Date(a.txn_date).getTime())
                        .map((t) => {
                          const src = grnSourceOf(t.reference);
                          const grnNo = (t.reference || "").replace(/^GRN\s+/i, "");
                          const cond = t.txn_type === "good_in" ? "Good" : "Defective";
                          return (
                            <tr key={t.id} className="border-t">
                              <td className="p-2">{new Date(t.txn_date).toLocaleDateString()}</td>
                              <td className="p-2 font-mono">{grnNo || "—"}</td>
                              <td className="p-2">
                                <Badge variant="outline" className={
                                  src === "oem" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                  src === "customer" ? "bg-blue-50 text-blue-700 border-blue-200" :
                                  src === "general" ? "bg-amber-50 text-amber-700 border-amber-200" : ""
                                }>
                                  {src === "oem" ? "From OEM" : src === "customer" ? "From Customer" : src === "general" ? "General" : "Other"}
                                </Badge>
                              </td>
                              <td className="p-2">{t.from_party || "—"}</td>
                              <td className="p-2 font-mono">{t.part_serial_no || "—"}</td>
                              <td className="p-2">{whName(t.to_warehouse_id)}</td>
                              <td className="p-2">
                                <Badge variant="outline" className={cond === "Good" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}>
                                  {cond}
                                </Badge>
                              </td>
                              <td className="p-2 text-right font-medium">{t.qty}</td>
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="serials">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input className="h-8 pl-7 text-xs" placeholder="Search serial, model, doc…" value={serialQ} onChange={(e) => setSerialQ(e.target.value)} />
                </div>
                <Select value={serialWh} onValueChange={setSerialWh}>
                  <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue placeholder="Warehouse" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Warehouses</SelectItem>
                    {wh.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={serialCond} onValueChange={setSerialCond}>
                  <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Condition" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Conditions</SelectItem>
                    <SelectItem value="good">Good</SelectItem>
                    <SelectItem value="defective">Defective</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={serialStatus} onValueChange={setSerialStatus}>
                  <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(STOCK_STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={exportSerials} disabled={serialFiltered.length === 0}>
                  <FileText className="h-3.5 w-3.5 mr-1" /> Export CSV
                </Button>
              </div>
              <div className="overflow-x-auto border rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="p-2">Serial No</th>
                      <th className="p-2">Warehouse</th>
                      <th className="p-2">Condition</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Ref Doc</th>
                      <th className="p-2">Owner</th>
                      <th className="p-2">Received</th>
                      <th className="p-2">Last Move</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serialFiltered.length === 0 ? (
                      <tr><td colSpan={8} className="p-3 text-muted-foreground text-center">No serials match these filters.</td></tr>
                    ) : serialFiltered.map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="p-2 font-mono">{s.part_serial_no || "—"}</td>
                        <td className="p-2">{whName(s.warehouse_id)}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={s.stock_type === "good" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-rose-50 text-rose-700 border-rose-200"}>
                            {s.stock_type === "good" ? "Good" : "Defective"}
                          </Badge>
                        </td>
                        <td className="p-2"><StockStatusBadge status={s.stock_status} type={s.stock_type} /></td>
                        <td className="p-2 font-mono">{s.transaction_ref || "—"}</td>
                        <td className="p-2">{s.customer_name || (s.stock_status === "returned_to_oem" ? "OEM" : whName(s.warehouse_id))}</td>
                        <td className="p-2">{new Date(s.created_at).toLocaleDateString()}</td>
                        <td className="p-2">{new Date(s.updated_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="txns">
              <div className="overflow-x-auto border rounded">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="p-2">Date</th>
                      <th className="p-2">Txn #</th>
                      <th className="p-2">Type</th>
                      <th className="p-2">Serial</th>
                      <th className="p-2">From</th>
                      <th className="p-2">To</th>
                      <th className="p-2 text-right">Qty</th>
                      <th className="p-2">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingTxns ? (
                      <tr><td colSpan={8} className="p-3 text-muted-foreground">Loading…</td></tr>
                    ) : txns.length === 0 ? (
                      <tr><td colSpan={8} className="p-3 text-muted-foreground">No transactions.</td></tr>
                    ) : txns.map((t) => (
                      <tr key={t.id} className="border-t">
                        <td className="p-2">{new Date(t.txn_date).toLocaleString()}</td>
                        <td className="p-2 font-mono">{t.txn_no || "—"}</td>
                        <td className="p-2">{TXN_TYPE_LABEL[t.txn_type] || t.txn_type}</td>
                        <td className="p-2 font-mono">{t.part_serial_no || "—"}</td>
                        <td className="p-2">{t.from_party || whName(t.from_warehouse_id)}</td>
                        <td className="p-2">{t.to_party || whName(t.to_warehouse_id)}</td>
                        <td className="p-2 text-right">{t.qty}</td>
                        <td className="p-2 font-mono">{t.reference || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MiniKpi({ icon: Icon, label, value, pct, tone }: {
  icon: any; label: string; value: number; pct?: number; tone: KpiTone;
}) {
  const t = KPI_TONES[tone];
  return (
    <div className="rounded-xl border bg-card p-2.5 relative overflow-hidden">
      <div className={`absolute left-0 top-0 h-full w-1 ${t.bar}`} />
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
        <div className={`h-6 w-6 grid place-items-center rounded-md ${t.bg} ${t.fg}`}>
          <Icon className="h-3 w-3" />
        </div>
      </div>
      <div className={`mt-1 text-xl font-bold leading-none tabular-nums ${t.fg}`}>{value}</div>
      {typeof pct === "number" && (
        <div className="mt-1.5">
          <div className="h-1 rounded-full bg-muted overflow-hidden">
            <div className={`h-full ${t.bar}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">{pct}% of total</div>
        </div>
      )}
    </div>
  );
}