import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, Package, Search, Warehouse as WarehouseIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listStock, listTransactions, listWarehouses,
  STOCK_STATUS_LABEL, TXN_TYPE_LABEL,
  type StockItem, type Transaction, type WarehouseLite,
} from "@/lib/ims";
import { StockStatusBadge } from "@/components/StockStatusBadge";

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
  const map = new Map<string, { name: string; total: number; available: number; reserved: number; issued: number; good: number; defective: number }>();
  for (const s of items) {
    const id = s.warehouse_id || "—";
    let r = map.get(id);
    if (!r) { r = { name: whName(s.warehouse_id), total: 0, available: 0, reserved: 0, issued: 0, good: 0, defective: 0 }; map.set(id, r); }
    const q = s.qty ?? 1;
    r.total += q;
    if (s.stock_status === "available") r.available += q;
    if (s.stock_status === "reserved") r.reserved += q;
    if (s.stock_status === "issued") r.issued += q;
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
    let total = 0, available = 0, reserved = 0, issued = 0, good = 0, defective = 0;
    let recvTotal = 0, recvOem = 0, recvCust = 0, recvGen = 0;
    for (const s of filteredItems) {
      const qv = s.qty ?? 1;
      total += qv;
      if (s.stock_status === "available") available += qv;
      if (s.stock_status === "reserved") reserved += qv;
      if (s.stock_status === "issued") issued += qv;
      if (s.stock_type === "good") good += qv;
      if (s.stock_type === "defective") defective += qv;
    }
    for (const p of products) {
      recvTotal += p.received.total;
      recvOem += p.received.oem;
      recvCust += p.received.customer;
      recvGen += p.received.general;
    }
    return { total, available, reserved, issued, good, defective,
      products: products.length, recvTotal, recvOem, recvCust, recvGen };
  }, [filteredItems, products]);

  function toggleExpand(k: string) {
    setExpanded((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        <StatTile label="Products" value={summary.products} />
        <StatTile label="Total Stock" value={summary.total} />
        <StatTile label="Available" value={summary.available} tone="emerald" />
        <StatTile label="Reserved" value={summary.reserved} tone="amber" />
        <StatTile label="Issued" value={summary.issued} tone="blue" />
        <StatTile label="Good" value={summary.good} tone="emerald" />
        <StatTile label="Defective" value={summary.defective} tone="rose" />
        <StatTile label="Received (GRN)" value={summary.recvTotal} tone="blue" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md border bg-card px-3 py-1.5 flex justify-between">
          <span className="text-muted-foreground">Received from OEM</span>
          <span className="font-semibold text-emerald-700">{summary.recvOem}</span>
        </div>
        <div className="rounded-md border bg-card px-3 py-1.5 flex justify-between">
          <span className="text-muted-foreground">Received from Customer</span>
          <span className="font-semibold text-blue-700">{summary.recvCust}</span>
        </div>
        <div className="rounded-md border bg-card px-3 py-1.5 flex justify-between">
          <span className="text-muted-foreground">General GRN Received</span>
          <span className="font-semibold text-amber-700">{summary.recvGen}</span>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" /> Stock Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search product, model, serial, OEM, customer…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={oemFilter} onValueChange={setOemFilter}>
              <SelectTrigger><SelectValue placeholder="OEM" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All OEMs</SelectItem>
                {oems.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={whFilter} onValueChange={setWhFilter}>
              <SelectTrigger><SelectValue placeholder="Warehouse" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STOCK_STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Grid */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0">
              <tr className="text-left">
                <th className="p-2 w-8"></th>
                <th className="p-2">Product</th>
                <th className="p-2">Model / Code</th>
                <th className="p-2">OEM</th>
                <th className="p-2 text-right">Total</th>
                <th className="p-2 text-right">Available</th>
                <th className="p-2 text-right">Reserved</th>
                <th className="p-2 text-right">Issued</th>
                <th className="p-2 text-right">Good</th>
                <th className="p-2 text-right">Defective</th>
                <th className="p-2 text-right" title="Received via GRN — total">Recv</th>
                <th className="p-2 text-right" title="Received from OEM">OEM</th>
                <th className="p-2 text-right" title="Received from Customer">Cust</th>
                <th className="p-2 text-right" title="General GRN">Gen</th>
                <th className="p-2">Latest GRN</th>
                <th className="p-2 text-right">Warehouses</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={16} className="p-4 text-muted-foreground">Loading…</td></tr>
              ) : products.length === 0 ? (
                <tr><td colSpan={16} className="p-4 text-muted-foreground">No stock matches your filters.</td></tr>
              ) : products.map((p) => {
                const isOpen = expanded.has(p.key);
                const wh = warehouseBreakdown(p.items, whName);
                return (
                  <>
                    <tr key={p.key} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setSelectedProduct(p)}>
                      <td className="p-2" onClick={(e) => { e.stopPropagation(); toggleExpand(p.key); }}>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="p-2 font-medium">{p.part_name}</td>
                      <td className="p-2 font-mono text-xs">{p.part_model_no || "—"}</td>
                      <td className="p-2">{p.oem || "—"}</td>
                      <td className="p-2 text-right font-medium">{p.total}</td>
                      <td className="p-2 text-right"><Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">{p.available}</Badge></td>
                      <td className="p-2 text-right"><Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">{p.reserved}</Badge></td>
                      <td className="p-2 text-right"><Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">{p.issued}</Badge></td>
                      <td className="p-2 text-right">{p.good}</td>
                      <td className="p-2 text-right">{p.defective}</td>
                      <td className="p-2 text-right font-medium">{p.received.total || "—"}</td>
                      <td className="p-2 text-right text-emerald-700">{p.received.oem || "—"}</td>
                      <td className="p-2 text-right text-blue-700">{p.received.customer || "—"}</td>
                      <td className="p-2 text-right text-amber-700">{p.received.general || "—"}</td>
                      <td className="p-2 text-xs">
                        {p.received.latestGrn ? (
                          <>
                            <div className="font-mono">{p.received.latestGrn}</div>
                            {p.received.latestDate && <div className="text-muted-foreground">{new Date(p.received.latestDate).toLocaleDateString()}</div>}
                          </>
                        ) : "—"}
                      </td>
                      <td className="p-2 text-right">{p.warehouses.size}</td>
                    </tr>
                    {isOpen && (
                      <tr key={p.key + "-exp"} className="bg-muted/20">
                        <td colSpan={16} className="p-3">
                          <div className="text-xs font-semibold mb-2 text-muted-foreground flex items-center gap-1"><WarehouseIcon className="h-3.5 w-3.5" /> Warehouse Breakdown</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                            {wh.map((w) => (
                              <div key={w.id} className="rounded border bg-background p-2">
                                <div className="font-medium text-sm mb-1">{w.name}</div>
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

function ProductDetailSheet({ product, onClose, whName }: {
  product: ProductRow | null;
  onClose: () => void;
  whName: (id: string | null) => string;
}) {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);

  useEffect(() => {
    if (!product) { setTxns([]); return; }
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

  return (
    <Sheet open={!!product} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Package className="h-5 w-5" /> {product.part_name}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div><div className="text-xs text-muted-foreground">Model / Code</div><div className="font-mono">{product.part_model_no || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">OEM</div><div>{product.oem || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Category</div><div>{product.category || "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Warehouses</div><div>{product.warehouses.size}</div></div>
          </div>

          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            <StatTile label="Total" value={product.total} />
            <StatTile label="Available" value={product.available} tone="emerald" />
            <StatTile label="Reserved" value={product.reserved} tone="amber" />
            <StatTile label="Issued" value={product.issued} tone="blue" />
            <StatTile label="Good" value={product.good} tone="emerald" />
            <StatTile label="Defective" value={product.defective} tone="rose" />
          </div>

          <Tabs defaultValue="warehouses">
            <TabsList>
              <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
              <TabsTrigger value="serials">Serials ({product.items.length})</TabsTrigger>
              <TabsTrigger value="txns">Transactions ({txns.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="warehouses">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {wh.map((w) => (
                  <div key={w.id} className="border rounded p-3">
                    <div className="font-medium mb-2 flex items-center gap-1"><WarehouseIcon className="h-4 w-4" /> {w.name}</div>
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
            </TabsContent>

            <TabsContent value="serials">
              <div className="overflow-x-auto border rounded">
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
                    {product.items.map((s) => (
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