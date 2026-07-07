import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { inr, type PaymentRow } from "@/lib/sales";

export const Route = createFileRoute("/_app/sales/payments/")({
  component: PaymentList,
  head: () => ({ meta: [{ title: "Payments Received — Prokon" }] }),
});

type Row = PaymentRow & { customer?: { company: string } };

function PaymentList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("payments_received")
        .select("*, customer:customers(company)")
        .order("payment_date", { ascending: false })
        .limit(500);
      setRows(((data ?? []) as unknown as Row[]));
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Payments Received</h2>
        <Button asChild size="sm"><Link to="/sales/payments/new"><Plus className="h-4 w-4 mr-1" />Record Payment</Link></Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2 text-left">Receipt #</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Customer</th>
                <th className="p-2 text-left">Mode</th>
                <th className="p-2 text-left">Reference</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2 text-right">Unallocated</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No payments recorded yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="p-2 font-mono text-xs">{r.payment_no}</td>
                  <td className="p-2">{r.payment_date}</td>
                  <td className="p-2">{r.customer?.company || "—"}</td>
                  <td className="p-2 uppercase text-xs">{r.mode}</td>
                  <td className="p-2 text-xs">{r.reference || "—"}</td>
                  <td className="p-2 text-right font-medium">{inr(r.amount)}</td>
                  <td className={"p-2 text-right " + (Number(r.unallocated) > 0 ? "text-amber-700" : "text-muted-foreground")}>{inr(r.unallocated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}