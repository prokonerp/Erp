import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDownCircle, ArrowUpCircle, History, RefreshCw } from "lucide-react";
import {
  listStock, listTransactions, listWarehouses,
  TXN_TYPE_LABEL, STOCK_STATUS_LABEL,
  type StockItem, type Transaction, type WarehouseLite, type TxnType,
} from "@/lib/ims";
import { StockStatusBadge } from "@/components/StockStatusBadge";

export const Route = createFileRoute("/_app/ims/ledger")({
  component: Ledger,
  head: () => ({ meta: [{ title: "Warehouse Ledger — Prokon IMS" }] }),
});

type Direction = "in" | "out" | "adj";

type LedgerRow = Transaction & {
  warehouse_id: string | null;
  direction: Direction;
  stock_in: number;
  stock_out: number;
  running: number;
};

const IN_TYPES: TxnType[] = ["good_in", "defective_in", "transfer_in", "oem_replacement_receipt"];
const OUT_TYPES: TxnType[] = ["good_out", "defective_out", "transfer_out", "oem_return"];

/** Stock type a transaction moves — from the linked stock item, else inferred from txn type. */
function txnStockType(t: Transaction, item?: StockItem | null): "good" | "defective" | null {
  if (item) return item.stock_type;
  if (t.txn_type === "defective_in" || t.txn_type === "defective_out" || t.txn_type === "oem_return") return "defective";
  if (t.txn_type === "good_in" || t.txn_type === "good_out" || t.txn_type === "oem_replacement_receipt") return "good";
  return null;
}

function classifyTxn(t: Transaction): { wh: string | null; dir: Direction } {
  if (IN_TYPES.includes(t.txn_type)) return { wh: t.to_warehouse_id, dir: "in" };
  if (OUT_TYPES.includes(t.txn_type)) return { wh: t.from_warehouse_id, dir: "out" };
  // adjustments / scrap — pick whichever warehouse is set
  const wh = t.to_warehouse_id || t.from_warehouse_id;
  const dir: Direction = t.to_warehouse_id ? "in" : t.from_warehouse_id ? "out" : "adj";
  return { wh, dir };
}

function Ledger() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [loading, setLoading] = useState(true);

  const [warehouseId, setWarehouseId] = useState<string>("all");
  const [txnType, setTxnType] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [stockType, setStockType] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [q, setQ] = useState("");
  const [drill, setDrill] = useState<{ serial: string | null; item: StockItem | null } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [s, t, w] = await Promise.all([listStock(), listTransactions(), listWarehouses()]);
      setStock(s); setTxns(t); setWarehouses(w);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const stockById = useMemo(() => new Map(stock.map((s) => [s.id, s])), [stock]);

  const whName = useMemo(() => {
    const m = new Map(warehouses.map((w) => [w.id, w]));
    return (id: string | null) => {
      if (!id) return "—";
      const w = m.get(id);
      return w ? (w.type ? `${w.name} (${w.type})` : w.name) : "—";
    };
  }, [warehouses]);

  // Compute ledger with per-warehouse running balances (ascending), then display desc
  const ledger = useMemo<LedgerRow[]>(() => {
    const asc = [...txns].sort((a, b) => new Date(a.txn_date).getTime() - new Date(b.txn_date).getTime());
    const bal = new Map<string, number>();
    const built: LedgerRow[] = [];
    for (const t of asc) {
      const { wh, dir } = classifyTxn(t);
      const key = wh || "__none__";
      const cur = bal.get(key) || 0;
      const qty = Number(t.qty) || 0;
      let stock_in = 0, stock_out = 0, next = cur;
      if (dir === "in") { stock_in = qty; next = cur + qty; }
      else if (dir === "out") { stock_out = qty; next = cur - qty; }
      bal.set(key, next);
      built.push({ ...t, warehouse_id: wh, direction: dir, stock_in, stock_out, running: next });
    }
    return built.reverse();
  }, [txns]);

  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    const fromTs = from ? new Date(from + "T00:00:00").getTime() : -Infinity;
    const toTs = to ? new Date(to + "T23:59:59").getTime() : Infinity;
    return ledger.filter((r) => {
      if (warehouseId !== "all" && r.warehouse_id !== warehouseId) return false;
      if (txnType !== "all" && r.txn_type !== txnType) return false;
      const item = r.stock_item_id ? stockById.get(r.stock_item_id) : null;
      if (stockType !== "all" && txnStockType(r, item) !== stockType) return false;
      if (status !== "all" && item?.stock_status !== status) return false;
      const ts = new Date(r.txn_date).getTime();
      if (ts < fromTs || ts > toTs) return false;
      if (!s) return true;
      return [r.txn_no, r.part_name, r.part_model_no, r.part_serial_no, r.oem,
        r.reference, r.notes, r.indent_id, r.oem_case_id, r.from_party, r.to_party]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [ledger, warehouseId, txnType, stockType, status, stockById, from, to, q]);

  // Stock scoped by the same warehouse / type / status filters as the ledger rows,
  // so the summary always matches the IMS Stock page for the same selection.
  const scopedStock = useMemo(() => stock.filter((s) => {
    if (warehouseId !== "all" && s.warehouse_id !== warehouseId) return false;
    if (stockType !== "all" && s.stock_type !== stockType) return false;
    if (status !== "all" && s.stock_status !== status) return false;
    return true;
  }), [stock, warehouseId, stockType, status]);

  const scopedTxns = useMemo(() => txns.filter((t) => {
    if (warehouseId !== "all" && t.from_warehouse_id !== warehouseId && t.to_warehouse_id !== warehouseId) return false;
    const item = t.stock_item_id ? stockById.get(t.stock_item_id) : null;
    if (stockType !== "all" && txnStockType(t, item) !== stockType) return false;
    if (status !== "all" && item?.stock_status !== status) return false;
    return true;
  }), [txns, warehouseId, stockType, status, stockById]);

  const summary = useMemo(() => {
    const count = (fn: (s: StockItem) => boolean) => scopedStock.filter(fn).reduce((a, s) => a + (Number(s.qty) || 1), 0);
    let inSum = 0, outSum = 0;
    for (const t of scopedTxns) {
      const { wh, dir } = classifyTxn(t);
      const q = Number(t.qty) || 0;
      if (warehouseId !== "all" && wh !== warehouseId) continue;
      if (dir === "in") inSum += q;
      else if (dir === "out") outSum += q;
    }
    return {
      total: count(() => true),
      available: count((s) => s.stock_status === "available"),
      reserved: count((s) => s.stock_status === "reserved"),
      issued: count((s) => s.stock_status === "issued"),
      good: count((s) => s.stock_type === "good"),
      defective: count((s) => s.stock_type === "defective"),
      returned: count((s) => s.stock_status === "returned_to_oem"),
      scrapped: count((s) => s.stock_status === "scrapped"),
      inSum, outSum,
    };
  }, [scopedStock, scopedTxns, warehouseId]);

  const Stat = ({ label, value, cls }: { label: string; value: number | string; cls?: string }) => (
    <div className={`rounded-md border bg-card px-3 py-2 ${cls || ""}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2"><History className="h-4 w-4" /> Warehouse Ledger — {warehouseId === "all" ? "All Warehouses" : whName(warehouseId)}</span>
            <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh</Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-9 gap-2">
            <Stat label="Total Stock" value={summary.total} />
            <Stat label="Available" value={summary.available} cls="border-emerald-200" />
            <Stat label="Reserved" value={summary.reserved} cls="border-amber-200" />
            <Stat label="Issued" value={summary.issued} cls="border-blue-200" />
            <Stat label="Good" value={summary.good} />
            <Stat label="Defective" value={summary.defective} cls="border-rose-200" />
            <Stat label="Returned OEM" value={summary.returned} cls="border-purple-200" />
            <Stat label="Stock In" value={summary.inSum} />
            <Stat label="Stock Out" value={summary.outSum} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3 py-3">
          <div>
            <Label className="text-xs">Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {warehouses.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}{w.type ? ` (${w.type})` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Transaction Type</Label>
            <Select value={txnType} onValueChange={setTxnType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {Object.entries(TXN_TYPE_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Current Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {Object.entries(STOCK_STATUS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Search</Label>
            <Input placeholder="Txn / Product / Serial / OEM / Indent / DC / GRN…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr className="text-left">
                <th className="p-2">Date / Time</th>
                <th className="p-2">Txn No</th>
                <th className="p-2">Type</th>
                <th className="p-2">Product · Serial</th>
                <th className="p-2">OEM</th>
                <th className="p-2">Warehouse</th>
                <th className="p-2">Party / Counter-WH</th>
                <th className="p-2 text-right text-emerald-700">Stock In</th>
                <th className="p-2 text-right text-rose-700">Stock Out</th>
                <th className="p-2 text-right">Running Balance</th>
                <th className="p-2">Ref / Indent</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={12}>Loading ledger…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={12}>No transactions match the current filters.</td></tr>
              ) : filtered.map((r) => {
                const item = r.stock_item_id ? stock.find((s) => s.id === r.stock_item_id) : null;
                if (status !== "all" && item?.stock_status !== status) return null;
                const counter = r.direction === "in"
                  ? (r.from_party || whName(r.from_warehouse_id))
                  : (r.to_party || whName(r.to_warehouse_id));
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="p-2 whitespace-nowrap text-xs">{new Date(r.txn_date).toLocaleString()}</td>
                    <td className="p-2 font-mono text-xs">{r.txn_no || "—"}</td>
                    <td className="p-2">
                      <Badge variant="outline" className={
                        r.direction === "in" ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                          : r.direction === "out" ? "bg-rose-50 text-rose-800 border-rose-200"
                          : "bg-muted"
                      }>
                        {r.direction === "in" ? <ArrowDownCircle className="h-3 w-3 inline mr-1" /> :
                         r.direction === "out" ? <ArrowUpCircle className="h-3 w-3 inline mr-1" /> : null}
                        {TXN_TYPE_LABEL[r.txn_type]}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <div className="font-medium">{r.part_name || "—"}</div>
                      {r.part_model_no ? <div className="text-xs text-muted-foreground">{r.part_model_no}</div> : null}
                      {r.part_serial_no ? (
                        <button
                          className="text-xs font-mono text-primary hover:underline"
                          onClick={() => setDrill({ serial: r.part_serial_no, item: item || null })}
                          title="View full lifecycle"
                        >
                          {r.part_serial_no}
                        </button>
                      ) : null}
                    </td>
                    <td className="p-2 text-xs">{r.oem || "—"}</td>
                    <td className="p-2 text-xs">{whName(r.warehouse_id)}</td>
                    <td className="p-2 text-xs">{counter || "—"}</td>
                    <td className="p-2 text-right font-mono text-emerald-700">{r.stock_in || ""}</td>
                    <td className="p-2 text-right font-mono text-rose-700">{r.stock_out || ""}</td>
                    <td className="p-2 text-right font-mono font-semibold">{r.running}</td>
                    <td className="p-2 text-xs">
                      {r.reference ? <div>{r.reference}</div> : null}
                      {r.indent_id ? <div className="font-mono text-muted-foreground">IND: {r.indent_id.slice(0, 8)}…</div> : null}
                      {r.oem_case_id ? <div className="font-mono text-muted-foreground">Case: {r.oem_case_id}</div> : null}
                    </td>
                    <td className="p-2">
                      {item ? <StockStatusBadge status={item.stock_status} type={item.stock_type} /> : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!drill} onOpenChange={(v) => { if (!v) setDrill(null); }}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Lifecycle — {drill?.item?.part_name || "—"}
              {drill?.serial ? <span className="font-mono text-sm text-muted-foreground ml-2">SN: {drill.serial}</span> : null}
            </DialogTitle>
          </DialogHeader>
          {drill && (
            <SerialLifecycle
              serial={drill.serial}
              item={drill.item}
              allTxns={txns}
              whName={whName}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SerialLifecycle({
  serial, item, allTxns, whName,
}: {
  serial: string | null;
  item: StockItem | null;
  allTxns: Transaction[];
  whName: (id: string | null) => string;
}) {
  const rows = useMemo(() => {
    const list = allTxns.filter((t) =>
      (item && t.stock_item_id === item.id) ||
      (serial && t.part_serial_no === serial)
    );
    return list.sort((a, b) => new Date(a.txn_date).getTime() - new Date(b.txn_date).getTime());
  }, [allTxns, item, serial]);

  return (
    <div className="space-y-3">
      {item && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs bg-muted/30 rounded-md p-3">
          <div><span className="text-muted-foreground">OEM:</span> {item.oem || "—"}</div>
          <div><span className="text-muted-foreground">Model:</span> {item.part_model_no || "—"}</div>
          <div><span className="text-muted-foreground">Current WH:</span> {whName(item.warehouse_id)}</div>
          <div><span className="text-muted-foreground">Status:</span> <StockStatusBadge status={item.stock_status} type={item.stock_type} /></div>
        </div>
      )}
      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Date</th>
              <th className="p-2">Txn No</th>
              <th className="p-2">Type</th>
              <th className="p-2">From</th>
              <th className="p-2">To</th>
              <th className="p-2 text-right">Qty</th>
              <th className="p-2">Reference</th>
              <th className="p-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td className="p-3 text-muted-foreground" colSpan={8}>No transactions recorded for this item.</td></tr>
            ) : rows.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="p-2 whitespace-nowrap text-xs">{new Date(t.txn_date).toLocaleString()}</td>
                <td className="p-2 font-mono text-xs">{t.txn_no || "—"}</td>
                <td className="p-2"><Badge variant="outline">{TXN_TYPE_LABEL[t.txn_type]}</Badge></td>
                <td className="p-2 text-xs">{t.from_party || whName(t.from_warehouse_id)}</td>
                <td className="p-2 text-xs">{t.to_party || whName(t.to_warehouse_id)}</td>
                <td className="p-2 text-right font-mono">{t.qty}</td>
                <td className="p-2 text-xs">{t.reference || "—"}</td>
                <td className="p-2 text-xs">{t.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}