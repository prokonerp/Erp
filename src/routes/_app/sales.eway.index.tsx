import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_app/sales/eway/")({
  component: EwayList,
  head: () => ({ meta: [{ title: "e-Way Bills — Prokon" }] }),
});

function EwayList() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from("eway_bills").select("*, invoice:invoices(invoice_no,total,buyer_name)").order("created_at", { ascending: false }).then(({ data }) => {
      setRows(data ?? []); setLoading(false);
    });
  }, []);
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold">e-Way Bills</h2>
      <p className="text-xs text-muted-foreground">Generate an e-Way Bill from an invoice's page. Bills above ₹50,000 require it.</p>
      <Card><CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs uppercase text-muted-foreground">
            <tr>
              <th className="p-2 text-left">EWB No.</th>
              <th className="p-2 text-left">Invoice</th>
              <th className="p-2 text-left">Customer</th>
              <th className="p-2 text-left">Vehicle</th>
              <th className="p-2 text-left">Transporter</th>
              <th className="p-2 text-left">Valid Till</th>
              <th className="p-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={7} className="p-4 text-center text-muted-foreground">No e-Way Bills yet.</td></tr>
            : rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 font-mono text-xs">{r.ewb_no}</td>
                <td className="p-2"><Link to="/sales/invoices/$id" params={{ id: r.invoice_id }} className="text-primary hover:underline font-mono text-xs">{r.invoice?.invoice_no}</Link></td>
                <td className="p-2">{r.invoice?.buyer_name}</td>
                <td className="p-2 font-mono text-xs">{r.vehicle_no}</td>
                <td className="p-2">{r.transporter_name || "—"}</td>
                <td className="p-2 text-xs">{r.valid_till ? new Date(r.valid_till).toLocaleString() : "—"}</td>
                <td className="p-2"><span className="text-xs uppercase">{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent></Card>
    </div>
  );
}