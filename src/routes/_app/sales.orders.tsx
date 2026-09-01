import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchSalesOrders, soStatusMeta, type SalesOrder } from "@/lib/salesOrders";
import { inr } from "@/lib/sales";
import { StatusBadge } from "@/components/shared/StatusBadge";

export const Route = createFileRoute("/_app/sales/orders")({ component: SalesOrdersList });

function SalesOrdersList() {
  const [rows, setRows] = useState<SalesOrder[]>([]);
  const [q, setQ] = useRouteState<string>("q", "");
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetchSalesOrders().then(setRows).finally(() => setLoading(false)); }, []);
  const filtered = rows.filter((r) =>
    !q ||
    (r.so_no || "").toLowerCase().includes(q.toLowerCase()) ||
    (r.buyer_name || "").toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Sales Orders</CardTitle>
        <Input placeholder="Search SO # or customer…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs h-8" />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No sales orders yet. Convert a Quotation from CRM → Quotations to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left p-2">SO No</th>
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Customer</th>
                  <th className="text-right p-2">Total</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const st = soStatusMeta(r.status);
                  return (
                    <tr key={r.id} className="border-t hover:bg-muted/30">
                      <td className="p-2 font-mono">
                        <Link to="/sales/orders/$id" params={{ id: r.id }} className="text-primary hover:underline">
                          {r.so_no || "—"}
                        </Link>
                      </td>
                      <td className="p-2">{r.so_date}</td>
                      <td className="p-2">{r.buyer_name || "—"}</td>
                      <td className="p-2 text-right font-medium">{inr(r.total)}</td>
                      <td className="p-2"><StatusBadge tone={st.badgeTone}>{st.label}</StatusBadge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}