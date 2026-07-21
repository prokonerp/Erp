import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from "recharts";
import {
  listStock,
  listTransfers,
  listReservations,
  listWarehouses,
  listTransactions,
  formatWarehouse,
  type StockItem,
  type Transfer,
  type Reservation,
  type WarehouseLite,
  type Transaction,
} from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/")({
  component: Dashboard,
});

function Dashboard() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [resv, setResv] = useState<Reservation[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, t, r, w, x] = await Promise.all([
          listStock(), listTransfers(), listReservations(), listWarehouses(), listTransactions(),
        ]);
        setStock(s); setTransfers(t); setResv(r); setWarehouses(w); setTxns(x);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="text-muted-foreground">Loading…</div>;

  const good = stock.filter((s) => s.stock_type === "good");
  const defective = stock.filter((s) => s.stock_type === "defective");
  const pendingOemReturn = defective.filter((s) => s.stock_status !== "returned_to_oem" && s.stock_status !== "scrapped");

  const byWarehouse = (items: StockItem[]) => {
    const m = new Map<string, number>();
    items.forEach((i) => {
      const k = i.warehouse_id || "—";
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  };
  const byOem = (items: StockItem[]) => {
    const m = new Map<string, number>();
    items.forEach((i) => {
      const k = i.oem || "—";
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  };

  const stat = (label: string, value: number | string) => (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-lg font-semibold mb-2">Good Stock</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stat("Total Good", good.length)}
          {stat("Warehouses", byWarehouse(good).size)}
          {stat("OEMs", byOem(good).size)}
          {stat("Available", good.filter((s) => s.stock_status === "available").length)}
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-2">Defective Stock</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stat("Total Defective", defective.length)}
          {stat("Pending OEM Return", pendingOemReturn.length)}
          {stat("Warehouses", byWarehouse(defective).size)}
          {stat("Returned to OEM", defective.filter((s) => s.stock_status === "returned_to_oem").length)}
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-2">Transfers</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {stat("Pending Approval", transfers.filter((t) => t.status === "submitted").length)}
          {stat("Approved", transfers.filter((t) => t.status === "approved").length)}
          {stat("In Transit", transfers.filter((t) => t.status === "in_transit").length)}
          {stat("Completed", transfers.filter((t) => t.status === "completed").length)}
          {stat("Rejected", transfers.filter((t) => t.status === "rejected").length)}
        </div>
      </section>
      <section>
        <h2 className="text-lg font-semibold mb-2">Reservations</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {stat("Reserved", resv.filter((r) => r.status === "reserved").length)}
          {stat("Issued", resv.filter((r) => r.status === "issued").length)}
          {stat("Available Stock", good.filter((s) => s.stock_status === "available").length)}
        </div>
      </section>

      {(() => {
        // Good vs Defective pie
        const goodQty = good.reduce((a, s) => a + (Number(s.qty) || 1), 0);
        const defQty = defective.filter((s) => s.stock_status !== "scrapped").reduce((a, s) => a + (Number(s.qty) || 1), 0);
        const scrapQty = defective.filter((s) => s.stock_status === "scrapped").reduce((a, s) => a + (Number(s.qty) || 1), 0);
        const pieData = [
          { name: "Good", value: goodQty, fill: "hsl(142 76% 36%)" },
          { name: "Defective", value: defQty, fill: "hsl(38 92% 50%)" },
          { name: "Scrap", value: scrapQty, fill: "hsl(0 72% 51%)" },
        ].filter((d) => d.value > 0);

        // GRN source split
        const isGrn = (ref: string | null | undefined) => !!ref && ref.toUpperCase().startsWith("GRN ");
        let recvOem = 0, recvCust = 0, recvGen = 0;
        for (const t of txns) {
          if (!isGrn(t.reference)) continue;
          if (t.txn_type !== "good_in" && t.txn_type !== "defective_in") continue;
          const q = Number(t.qty) || 0;
          const r = (t.reference || "").toUpperCase();
          if (r.includes("GRN-OEM")) recvOem += q;
          else if (r.includes("GRN-CUST")) recvCust += q;
          else if (r.includes("GRN-GEN")) recvGen += q;
        }
        const grnData = [
          { name: "From OEM", value: recvOem, fill: "hsl(160 84% 39%)" },
          { name: "From Customer", value: recvCust, fill: "hsl(217 91% 60%)" },
          { name: "General", value: recvGen, fill: "hsl(38 92% 50%)" },
        ].filter((d) => d.value > 0);

        // 30-day movement trend
        const days: { key: string; label: string; in: number; out: number }[] = [];
        const today = new Date(); today.setHours(0, 0, 0, 0);
        for (let i = 29; i >= 0; i--) {
          const d = new Date(today); d.setDate(today.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          days.push({ key, label: `${d.getDate()}/${d.getMonth() + 1}`, in: 0, out: 0 });
        }
        const idx = new Map(days.map((d, i) => [d.key, i]));
        for (const t of txns) {
          const key = (t.txn_date || "").slice(0, 10);
          const i = idx.get(key);
          if (i === undefined) continue;
          const q = Number(t.qty) || 0;
          if (t.txn_type === "good_in" || t.txn_type === "defective_in") days[i].in += q;
          else if (t.txn_type === "good_out" || t.txn_type === "defective_out") days[i].out += q;
        }

        // Top 6 OEMs by qty
        const oemMap = new Map<string, number>();
        for (const s of stock) {
          if (s.stock_status === "issued" || s.stock_status === "returned_to_oem" || s.stock_status === "scrapped") continue;
          const k = s.oem || "—";
          oemMap.set(k, (oemMap.get(k) || 0) + (Number(s.qty) || 1));
        }
        const oemData = Array.from(oemMap.entries())
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 6);

        return (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Stock Composition</CardTitle></CardHeader>
              <CardContent style={{ height: 260 }}>
                {pieData.length === 0 ? <div className="text-sm text-muted-foreground">No stock yet.</div> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                        {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Received Stock by Source</CardTitle></CardHeader>
              <CardContent style={{ height: 260 }}>
                {grnData.length === 0 ? <div className="text-sm text-muted-foreground">No GRN receipts yet.</div> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={grnData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                        {grnData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">30-Day Stock Movement</CardTitle></CardHeader>
              <CardContent style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={days} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="in" name="Stock In" stroke="hsl(142 76% 36%)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="out" name="Stock Out" stroke="hsl(0 72% 51%)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Top OEMs by Available Stock</CardTitle></CardHeader>
              <CardContent style={{ height: 260 }}>
                {oemData.length === 0 ? <div className="text-sm text-muted-foreground">No stock yet.</div> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={oemData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" name="Qty" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </section>
        );
      })()}

      <Card>
        <CardHeader><CardTitle className="text-base">Warehouse Snapshot</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {(() => {
            const ids = Array.from(new Set(stock.map((s) => s.warehouse_id).filter(Boolean) as string[]));
            const allIds = Array.from(new Set([...ids, ...warehouses.map((w) => w.id)]));
            const isGrn = (ref: string | null | undefined) => !!ref && ref.toUpperCase().startsWith("GRN ");
            const grnSrc = (ref: string | null | undefined): "oem" | "customer" | "general" | "other" => {
              const r = (ref || "").toUpperCase();
              if (r.includes("GRN-OEM")) return "oem";
              if (r.includes("GRN-CUST")) return "customer";
              if (r.includes("GRN-GEN")) return "general";
              return "other";
            };
            const forWh = (wid: string) => {
              const stockHere = stock.filter((s) => s.warehouse_id === wid);
              const opening = stockHere.filter((s) => s.opening_stock).reduce((a, s) => a + (Number(s.qty) || 1), 0);
              const available = stockHere.filter((s) => s.stock_status === "available").reduce((a, s) => a + (Number(s.qty) || 1), 0);
              const defectiveQ = stockHere.filter((s) => s.stock_type === "defective" && s.stock_status !== "scrapped").reduce((a, s) => a + (Number(s.qty) || 1), 0);
              const scrap = stockHere.filter((s) => s.stock_status === "scrapped").reduce((a, s) => a + (Number(s.qty) || 1), 0);
              const balance = stockHere.filter((s) => s.stock_status !== "issued" && s.stock_status !== "returned_to_oem" && s.stock_status !== "scrapped").reduce((a, s) => a + (Number(s.qty) || 1), 0);
              let recvOem = 0, recvCust = 0, recvGen = 0, issued = 0;
              for (const t of txns) {
                const q = Number(t.qty) || 0;
                if ((t.txn_type === "good_in" || t.txn_type === "defective_in") && t.to_warehouse_id === wid && isGrn(t.reference)) {
                  const src = grnSrc(t.reference);
                  if (src === "oem") recvOem += q;
                  else if (src === "customer") recvCust += q;
                  else if (src === "general") recvGen += q;
                }
                if ((t.txn_type === "good_out" || t.txn_type === "defective_out") && t.from_warehouse_id === wid) {
                  issued += q;
                }
              }
              return { opening, recvOem, recvCust, recvGen, recvTotal: recvOem + recvCust + recvGen, issued, available, defectiveQ, scrap, balance };
            };
            if (allIds.length === 0) {
              return <div className="p-4 text-muted-foreground">No warehouses configured.</div>;
            }
            return (
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="p-2">Warehouse</th>
                    <th className="p-2">Type</th>
                    <th className="p-2 text-right">Opening</th>
                    <th className="p-2 text-right" title="Received (all GRNs)">Received</th>
                    <th className="p-2 text-right text-emerald-700">OEM</th>
                    <th className="p-2 text-right text-blue-700">Cust</th>
                    <th className="p-2 text-right text-amber-700">Gen</th>
                    <th className="p-2 text-right">Issued</th>
                    <th className="p-2 text-right">Available</th>
                    <th className="p-2 text-right">Defective</th>
                    <th className="p-2 text-right">Scrap</th>
                    <th className="p-2 text-right font-semibold">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {allIds.map((wid) => {
                    const wh = warehouses.find((w) => w.id === wid) || null;
                    const m = forWh(wid);
                    return (
                      <tr key={wid} className="border-t">
                        <td className="p-2">{wh ? wh.name : "Unassigned"}</td>
                        <td className="p-2 text-xs text-muted-foreground">{wh?.type || "—"}</td>
                        <td className="p-2 text-right">{m.opening}</td>
                        <td className="p-2 text-right font-medium">{m.recvTotal}</td>
                        <td className="p-2 text-right text-emerald-700">{m.recvOem}</td>
                        <td className="p-2 text-right text-blue-700">{m.recvCust}</td>
                        <td className="p-2 text-right text-amber-700">{m.recvGen}</td>
                        <td className="p-2 text-right text-rose-700">{m.issued}</td>
                        <td className="p-2 text-right">{m.available}</td>
                        <td className="p-2 text-right">{m.defectiveQ}</td>
                        <td className="p-2 text-right">{m.scrap}</td>
                        <td className="p-2 text-right font-semibold">{m.balance}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
          <p className="text-xs text-muted-foreground mt-2">Received / Issued totals derive from IMS Stock Ledger transactions ({txns.length} recorded). {formatWarehouse(warehouses[0]) && ""}</p>
        </CardContent>
      </Card>
    </div>
  );
}