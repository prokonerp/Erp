import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Boxes,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Hash,
  Inbox,
  Package,
  Printer,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Warehouse as WarehouseIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StockStatusBadge } from "@/components/StockStatusBadge";
import { exportCSV } from "@/lib/exports";
import {
  STOCK_STATUS_LABEL,
  TXN_TYPE_LABEL,
  fetchTransactionsPage,
  type StockItem,
  type Transaction,
  type TxnType,
} from "@/lib/ims";

// ── Types ────────────────────────────────────────────────────────────────

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

/**
 * BETA page product row — mirrors ProductRow from stock-management but
 * exported for reuse on the BETA sheet. The `key` is derived from
 * lower(trim(part_model_no)) || lower(trim(part_name)).
 */
export type BetaProductRow = {
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

export type StockBetaDetailProps = {
  product: BetaProductRow | null;
  isOpen: boolean;
  onClose: () => void;
  whName: (id: string | null) => string;
};

// ── Warehouse breakdown (beta copy) ─────────────────────────────────────

type WhBreakdown = {
  id: string;
  name: string;
  total: number;
  available: number;
  reserved: number;
  issued: number;
  good: number;
  defective: number;
  scrap: number;
};

function warehouseBreakdownBeta(
  items: StockItem[],
  whName: (id: string | null) => string,
): WhBreakdown[] {
  const map = new Map<string, WhBreakdown>();
  for (const s of items) {
    const id = s.warehouse_id || "—";
    let r = map.get(id);
    if (!r) {
      r = {
        id,
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
  return Array.from(map.values());
}

// ── KPI tones ───────────────────────────────────────────────────────────

type KpiTone = "blue" | "emerald" | "amber" | "violet" | "rose" | "slate" | "sky";

const KPI_TONES: Record<KpiTone, { bg: string; fg: string; ring: string; bar: string }> = {
  blue: { bg: "bg-blue-50", fg: "text-blue-700", ring: "ring-blue-100", bar: "bg-blue-500" },
  emerald: { bg: "bg-emerald-50", fg: "text-emerald-700", ring: "ring-emerald-100", bar: "bg-emerald-500" },
  amber: { bg: "bg-amber-50", fg: "text-amber-700", ring: "ring-amber-100", bar: "bg-amber-500" },
  violet: { bg: "bg-violet-50", fg: "text-violet-700", ring: "ring-violet-100", bar: "bg-violet-500" },
  rose: { bg: "bg-rose-50", fg: "text-rose-700", ring: "ring-rose-100", bar: "bg-rose-500" },
  slate: { bg: "bg-slate-50", fg: "text-slate-700", ring: "ring-slate-100", bar: "bg-slate-500" },
  sky: { bg: "bg-sky-50", fg: "text-sky-700", ring: "ring-sky-100", bar: "bg-sky-500" },
};

// ── Ledger direction sets ───────────────────────────────────────────────

const IN_TYPES: TxnType[] = ["good_in", "defective_in", "transfer_in", "oem_replacement_receipt"];
const OUT_TYPES: TxnType[] = [
  "good_out",
  "defective_out",
  "transfer_out",
  "oem_return",
  "scrap_adjustment",
];

function txnDir(t: TxnType): 1 | -1 | 0 {
  if ((IN_TYPES as string[]).includes(t)) return 1;
  if ((OUT_TYPES as string[]).includes(t)) return -1;
  return 0;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between border rounded px-1.5 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function MiniKpi({
  icon: Icon,
  label,
  value,
  pct,
  tone,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  pct?: number;
  tone: KpiTone;
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

// ── Main component ──────────────────────────────────────────────────────

export function StockBetaDetail({ product, isOpen, onClose, whName }: StockBetaDetailProps) {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loadingTxns, setLoadingTxns] = useState(false);
  const [serialQ, setSerialQ] = useState("");
  const [serialWh, setSerialWh] = useState<string>("all");
  const [serialCond, setSerialCond] = useState<string>("all");
  const [serialStatus, setSerialStatus] = useState<string>("all");

  useEffect(() => {
    if (!product) {
      setTxns([]);
      return;
    }
    setSerialQ("");
    setSerialWh("all");
    setSerialCond("all");
    setSerialStatus("all");
    setLoadingTxns(true);
    fetchTransactionsPage({ page: 0, pageSize: 500 })
      .then((res) => {
        const all = res.data;
        const modelKey = (product.part_model_no || "").trim().toLowerCase();
        const nameKey = product.part_name.trim().toLowerCase();
        const filtered = all.filter((t) => {
          const tModel = (t.part_model_no || "").trim().toLowerCase();
          const tName = (t.part_name || "").trim().toLowerCase();
          if (modelKey) return tModel === modelKey || tName === nameKey;
          return tName === nameKey;
        });
        setTxns(filtered);
      })
      .finally(() => setLoadingTxns(false));
  }, [product]);

  const wh = useMemo(() => {
    if (!product) return [] as WhBreakdown[];
    return warehouseBreakdownBeta(product.items, whName);
  }, [product, whName]);

  // Derived values — guard for null product
  const total = product?.total || 0;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const scrap = product?.scrapped || 0;

  const conditionData = useMemo(() => {
    if (!product) return [] as { name: string; value: number; color: string }[];
    return [
      { name: "Good", value: product.good, color: "#10b981" },
      {
        name: "Defective",
        value: product.defective - scrap > 0 ? product.defective - scrap : 0,
        color: "#f43f5e",
      },
      { name: "Scrap", value: scrap, color: "#64748b" },
    ].filter((d) => d.value > 0);
  }, [product, scrap]);

  const whChart = useMemo(() => {
    return wh.map((w) => ({
      name: w.name,
      Good: w.good - (w.scrap > w.defective ? w.defective : w.scrap),
      Defective: Math.max(w.defective - w.scrap, 0),
      Scrap: w.scrap,
    }));
  }, [wh]);

  // Keep derived values referenced to avoid unused warnings when product null guards skip UI
  void conditionData;
  void whChart;

  const alerts: { tone: "rose" | "amber" | "sky"; msg: string }[] = [];
  if (product) {
    const goodPct = pct(product.good);
    const defectivePct = pct(product.defective);
    const scrapPct = pct(scrap);
    const availPct = pct(product.available);
    const issuedPct = pct(product.issued);
    if (defectivePct > 20) alerts.push({ tone: "rose", msg: `High defective share: ${defectivePct}% of total inventory` });
    if (scrapPct > 10) alerts.push({ tone: "rose", msg: `Scrap exceeds 10%: ${scrapPct}%` });
    if (total > 0 && availPct < 15) alerts.push({ tone: "amber", msg: `Low available stock: only ${availPct}% available` });
    if (issuedPct > 60) alerts.push({ tone: "sky", msg: `High issued share: ${issuedPct}% issued to customers` });
    void goodPct;
  }

  // Timeline: ledger-like dir 1/-1/0 sorted asc then running balance reverse
  const timeline = useMemo(() => {
    const allMoves: Array<{
      id: string;
      when: string;
      type: string;
      qty: number;
      dir: 1 | -1 | 0;
      wh: string;
      ref: string;
    }> = [];
    const seen = new Set<string>();
    for (const t of txns) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const dir = txnDir(t.txn_type);
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
    return allMoves
      .map((m) => {
        bal += m.dir * m.qty;
        return { ...m, balance: bal };
      })
      .reverse();
  }, [txns, whName]);

  const serialFiltered = useMemo(() => {
    if (!product) return [] as StockItem[];
    return product.items.filter((s) => {
      if (serialWh !== "all" && (s.warehouse_id || "") !== serialWh) return false;
      if (serialCond !== "all" && s.stock_type !== serialCond) return false;
      if (serialStatus !== "all" && s.stock_status !== serialStatus) return false;
      if (!serialQ) return true;
      const q = serialQ.toLowerCase();
      return [s.part_serial_no, s.part_model_no, s.transaction_ref, s.customer_name]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [product, serialWh, serialCond, serialStatus, serialQ]);

  function exportSerials() {
    if (!product) return;
    exportCSV(
      `${product.part_name}-serials`,
      [
        { header: "Serial", get: (s: StockItem) => s.part_serial_no || "" },
        { header: "Model", get: (s: StockItem) => s.part_model_no || "" },
        { header: "Warehouse", get: (s: StockItem) => whName(s.warehouse_id) },
        { header: "Condition", get: (s: StockItem) => s.stock_type },
        { header: "Status", get: (s: StockItem) => s.stock_status },
        { header: "Ref", get: (s: StockItem) => s.transaction_ref || "" },
        { header: "Received", get: (s: StockItem) => new Date(s.created_at).toLocaleDateString() },
        { header: "Last Move", get: (s: StockItem) => new Date(s.updated_at).toLocaleDateString() },
      ],
      serialFiltered,
    );
  }

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent className="w-full sm:max-w-5xl overflow-y-auto">
        {!product ? (
          <div className="py-12 text-center space-y-2">
            <Package className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {loadingTxns ? "Loading…" : "No product selected."}
            </p>
          </div>
        ) : (
          <>
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
                    <Link to="/ims/ledger">
                      <FileText className="h-3.5 w-3.5 mr-1" />
                      Ledger
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/grn">
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      GRNs
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/challan">
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      DCs
                    </Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => window.print()}>
                    <Printer className="h-3.5 w-3.5 mr-1" />
                    Print
                  </Button>
                </div>
              </div>
            </SheetHeader>

            <div className="mt-4 space-y-5">
              {/* KPI grid — 10 items */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                <MiniKpi icon={Boxes} label="Total Qty" value={product.total} pct={100} tone="blue" />
                <MiniKpi icon={CheckCircle2} label="Available" value={product.available} pct={pct(product.available)} tone="emerald" />
                <MiniKpi icon={Clock} label="Reserved" value={product.reserved} pct={pct(product.reserved)} tone="amber" />
                <MiniKpi icon={Send} label="Issued" value={product.issued} pct={pct(product.issued)} tone="violet" />
                <MiniKpi icon={ShieldCheck} label="Good" value={product.good} pct={pct(product.good)} tone="emerald" />
                <MiniKpi
                  icon={AlertTriangle}
                  label="Defective"
                  value={product.defective}
                  pct={pct(product.defective)}
                  tone="rose"
                />
                <MiniKpi icon={Trash2} label="Scrap" value={scrap} pct={pct(scrap)} tone="slate" />
                <MiniKpi icon={WarehouseIcon} label="Warehouses" value={product.warehouses.size} tone="sky" />
                <MiniKpi icon={Hash} label="Serial Units" value={product.items.length} tone="sky" />
                <MiniKpi icon={Inbox} label="Received (GRN)" value={product.received.total} tone="sky" />
              </div>

              {/* Health alerts */}
              {alerts.length > 0 && (
                <div className="space-y-1.5">
                  {alerts.map((a, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 text-xs rounded-lg border px-3 py-2 ${
                        a.tone === "rose"
                          ? "bg-rose-50 border-rose-200 text-rose-800"
                          : a.tone === "amber"
                            ? "bg-amber-50 border-amber-200 text-amber-800"
                            : "bg-sky-50 border-sky-200 text-sky-800"
                      }`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>{a.msg}</span>
                    </div>
                  ))}
                </div>
              )}

              {loadingTxns && (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin" />
                  Loading transactions…
                </div>
              )}

              <Tabs defaultValue="warehouses">
                <TabsList>
                  <TabsTrigger value="warehouses">Warehouses ({wh.length})</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline ({timeline.length})</TabsTrigger>
                  <TabsTrigger value="received">Received ({product.received.txns.length})</TabsTrigger>
                  <TabsTrigger value="serials">Serials ({product.items.length})</TabsTrigger>
                  <TabsTrigger value="txns">Transactions ({txns.length})</TabsTrigger>
                </TabsList>

                {/* ── Warehouses ─────────────────────────────────────── */}
                <TabsContent value="warehouses">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
                    {wh.map((w) => (
                      <div key={w.id} className="rounded-xl border p-3 bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-sm flex items-center gap-1.5">
                            <WarehouseIcon className="h-4 w-4 text-muted-foreground" /> {w.name}
                          </div>
                          <Badge variant="outline" className="tabular-nums">
                            {w.total}
                          </Badge>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden mb-2 flex">
                          {w.good > 0 && (
                            <div style={{ width: `${(w.good / (w.total || 1)) * 100}%` }} className="bg-emerald-500" />
                          )}
                          {w.defective - w.scrap > 0 && (
                            <div
                              style={{ width: `${((w.defective - w.scrap) / (w.total || 1)) * 100}%` }}
                              className="bg-rose-500"
                            />
                          )}
                          {w.scrap > 0 && (
                            <div style={{ width: `${(w.scrap / (w.total || 1)) * 100}%` }} className="bg-slate-500" />
                          )}
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

                {/* ── Timeline ───────────────────────────────────────── */}
                <TabsContent value="timeline">
                  <div className="rounded-xl border">
                    {timeline.length === 0 ? (
                      <div className="p-4 text-xs text-muted-foreground text-center">
                        {loadingTxns ? "Loading movements…" : "No stock movements recorded yet."}
                      </div>
                    ) : (
                      <ul className="divide-y">
                        {timeline.map((m) => (
                          <li key={m.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30">
                            <div
                              className={`h-8 w-8 rounded-full grid place-items-center shrink-0 ${
                                m.dir > 0
                                  ? "bg-emerald-50 text-emerald-700"
                                  : m.dir < 0
                                    ? "bg-rose-50 text-rose-700"
                                    : "bg-slate-50 text-slate-700"
                              }`}
                            >
                              {m.dir > 0 ? (
                                <ArrowDownCircle className="h-4 w-4" />
                              ) : m.dir < 0 ? (
                                <ArrowUpCircle className="h-4 w-4" />
                              ) : (
                                <Activity className="h-4 w-4" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate">{m.type}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {new Date(m.when).toLocaleString()} · {m.wh} ·{" "}
                                <span className="font-mono">{m.ref}</span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div
                                className={`text-sm font-semibold tabular-nums ${m.dir > 0 ? "text-emerald-700" : m.dir < 0 ? "text-rose-700" : ""}`}
                              >
                                {m.dir > 0 ? "+" : m.dir < 0 ? "−" : ""}
                                {m.qty}
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

                {/* ── Received ───────────────────────────────────────── */}
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
                          <tr>
                            <td colSpan={8} className="p-3 text-muted-foreground">
                              No GRN receipts for this product yet.
                            </td>
                          </tr>
                        ) : (
                          [...product.received.txns]
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
                                    <Badge
                                      variant="outline"
                                      className={
                                        src === "oem"
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                          : src === "customer"
                                            ? "bg-blue-50 text-blue-700 border-blue-200"
                                            : src === "general"
                                              ? "bg-amber-50 text-amber-700 border-amber-200"
                                              : ""
                                      }
                                    >
                                      {src === "oem"
                                        ? "From OEM"
                                        : src === "customer"
                                          ? "From Customer"
                                          : src === "general"
                                            ? "General"
                                            : "Other"}
                                    </Badge>
                                  </td>
                                  <td className="p-2">{t.from_party || "—"}</td>
                                  <td className="p-2 font-mono">{t.part_serial_no || "—"}</td>
                                  <td className="p-2">{whName(t.to_warehouse_id)}</td>
                                  <td className="p-2">
                                    <Badge
                                      variant="outline"
                                      className={
                                        cond === "Good"
                                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                          : "bg-rose-50 text-rose-700 border-rose-200"
                                      }
                                    >
                                      {cond}
                                    </Badge>
                                  </td>
                                  <td className="p-2 text-right font-medium">{t.qty}</td>
                                </tr>
                              );
                            })
                        )}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                {/* ── Serials ────────────────────────────────────────── */}
                <TabsContent value="serials">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <div className="relative flex-1 min-w-[180px]">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        className="h-8 pl-7 text-xs"
                        placeholder="Search serial, model, doc…"
                        value={serialQ}
                        onChange={(e) => setSerialQ(e.target.value)}
                      />
                    </div>
                    <Select value={serialWh} onValueChange={setSerialWh}>
                      <SelectTrigger className="h-8 w-[160px] text-xs">
                        <SelectValue placeholder="Warehouse" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Warehouses</SelectItem>
                        {wh.map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={serialCond} onValueChange={setSerialCond}>
                      <SelectTrigger className="h-8 w-[130px] text-xs">
                        <SelectValue placeholder="Condition" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Conditions</SelectItem>
                        <SelectItem value="good">Good</SelectItem>
                        <SelectItem value="defective">Defective</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={serialStatus} onValueChange={setSerialStatus}>
                      <SelectTrigger className="h-8 w-[140px] text-xs">
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
                    <Button size="sm" variant="outline" onClick={exportSerials} disabled={serialFiltered.length === 0}>
                      <FileText className="h-3.5 w-3.5 mr-1" /> Export CSV
                    </Button>
                  </div>
                  <div className="overflow-x-auto border rounded-xl">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr className="text-left">
                          <th className="p-2">Serial No</th>
                          <th className="p-2">Model</th>
                          <th className="p-2">Warehouse</th>
                          <th className="p-2">Condition</th>
                          <th className="p-2">Status</th>
                          <th className="p-2">Ref Doc</th>
                          <th className="p-2">Received</th>
                          <th className="p-2">Last Move</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serialFiltered.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="p-3 text-muted-foreground text-center">
                              No serials match these filters.
                            </td>
                          </tr>
                        ) : (
                          serialFiltered.map((s) => (
                            <tr key={s.id} className="border-t">
                              <td className="p-2 font-mono">{s.part_serial_no || "—"}</td>
                              <td className="p-2 font-mono text-[11px]">{s.part_model_no || "—"}</td>
                              <td className="p-2">{whName(s.warehouse_id)}</td>
                              <td className="p-2">
                                <Badge
                                  variant="outline"
                                  className={
                                    s.stock_type === "good"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : "bg-rose-50 text-rose-700 border-rose-200"
                                  }
                                >
                                  {s.stock_type === "good" ? "Good" : "Defective"}
                                </Badge>
                              </td>
                              <td className="p-2">
                                <StockStatusBadge status={s.stock_status} type={s.stock_type} />
                              </td>
                              <td className="p-2 font-mono">{s.transaction_ref || "—"}</td>
                              <td className="p-2">{new Date(s.created_at).toLocaleDateString()}</td>
                              <td className="p-2">{new Date(s.updated_at).toLocaleDateString()}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>

                {/* ── Transactions ───────────────────────────────────── */}
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
                          <tr>
                            <td colSpan={8} className="p-3 text-muted-foreground">
                              Loading…
                            </td>
                          </tr>
                        ) : txns.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="p-3 text-muted-foreground">
                              No transactions.
                            </td>
                          </tr>
                        ) : (
                          txns.map((t) => (
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
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default StockBetaDetail;
