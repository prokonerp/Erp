import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  listStock,
  listTransfers,
  listReservations,
  listWarehouses,
  formatWarehouse,
  type StockItem,
  type Transfer,
  type Reservation,
  type WarehouseLite,
} from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/")({
  component: Dashboard,
});

function Dashboard() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [resv, setResv] = useState<Reservation[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, t, r, w] = await Promise.all([
          listStock(), listTransfers(), listReservations(), listWarehouses(),
        ]);
        setStock(s); setTransfers(t); setResv(r); setWarehouses(w);
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

      <Card>
        <CardHeader><CardTitle className="text-base">Warehouse Snapshot</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr className="text-left"><th className="p-2">Warehouse</th><th className="p-2">Type</th><th className="p-2">Good</th><th className="p-2">Defective</th><th className="p-2">In Transit</th></tr></thead>
            <tbody>
              {(() => {
                const ids = Array.from(new Set(stock.map((s) => s.warehouse_id).filter(Boolean) as string[]));
                // Include warehouses with zero stock too, for full visibility
                const allIds = Array.from(new Set([...ids, ...warehouses.map((w) => w.id)]));
                if (allIds.length === 0) {
                  return (<tr><td className="p-4 text-muted-foreground" colSpan={5}>No warehouses configured.</td></tr>);
                }
                return allIds.map((wid) => {
                  const wh = warehouses.find((w) => w.id === wid) || null;
                  return (
                    <tr key={wid} className="border-t">
                      <td className="p-2">{wh ? wh.name : "Unassigned"}</td>
                      <td className="p-2 text-xs text-muted-foreground">{wh?.type || "—"}</td>
                      <td className="p-2">{good.filter((s) => s.warehouse_id === wid && s.stock_status !== "in_transit").length}</td>
                      <td className="p-2">{defective.filter((s) => s.warehouse_id === wid && s.stock_status !== "in_transit").length}</td>
                      <td className="p-2">{stock.filter((s) => s.warehouse_id === wid && s.stock_status === "in_transit").length}</td>
                    </tr>
                  );
                });
              })()}
              {stock.some((s) => !s.warehouse_id) && (
                <tr className="border-t">
                  <td className="p-2 italic text-muted-foreground">Unassigned</td>
                  <td className="p-2">—</td>
                  <td className="p-2">{good.filter((s) => !s.warehouse_id).length}</td>
                  <td className="p-2">{defective.filter((s) => !s.warehouse_id).length}</td>
                  <td className="p-2">0</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground mt-2">Showing warehouse names (type) from Warehouse Master. {formatWarehouse(warehouses[0]) && ""}</p>
        </CardContent>
      </Card>
    </div>
  );
}