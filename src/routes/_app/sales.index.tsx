import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Receipt,
  Wallet,
  Truck,
  FileText,
  IndianRupee,
  AlertCircle,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { inr, statusMeta, type InvoiceRow } from "@/lib/sales";

export const Route = createFileRoute("/_app/sales/")({
  component: HeadSalesDashboard,
  head: () => ({ meta: [{ title: "HEAD SALES — Prokon" }] }),
});

function Kpi({ icon: Icon, label, value, hint, tone = "" }: any) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className={"text-2xl font-bold mt-1 " + tone}>{value}</div>
            {hint ? <div className="text-xs text-muted-foreground mt-1">{hint}</div> : null}
          </div>
          <div className="rounded-md bg-muted p-2 shrink-0">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HeadSalesDashboard() {
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState(0);
  const [mtd, setMtd] = useState(0);
  const [outstanding, setOutstanding] = useState(0);
  const [invCount, setInvCount] = useState(0);
  const [pendingPay, setPendingPay] = useState(0);
  const [einvoicesCount, setEinvoicesCount] = useState(0);
  const [recent, setRecent] = useState<InvoiceRow[]>([]);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const iso = now.toISOString().slice(0, 10);
      const som = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

      const [tdy, mo, all, ei, rec] = await Promise.all([
        supabase.from("invoices").select("total").eq("invoice_date", iso).neq("status", "cancelled"),
        supabase.from("invoices").select("total,total_paid,status").gte("invoice_date", som).neq("status", "cancelled"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).neq("status", "cancelled"),
        supabase.from("invoices").select("id", { count: "exact", head: true }).not("irn", "is", null),
        supabase.from("invoices").select("*").order("created_at", { ascending: false }).limit(8),
      ]);

      setToday((tdy.data ?? []).reduce((s: number, r: any) => s + Number(r.total || 0), 0));
      const moRows = (mo.data ?? []) as any[];
      setMtd(moRows.reduce((s, r) => s + Number(r.total || 0), 0));
      const { data: outAll } = await supabase
        .from("invoices")
        .select("total,total_paid,status")
        .in("status", ["issued", "partial"]);
      setOutstanding(
        (outAll ?? []).reduce(
          (s: number, r: any) => s + Math.max(0, Number(r.total || 0) - Number(r.total_paid || 0)),
          0,
        ),
      );
      setPendingPay(
        (outAll ?? []).filter((r: any) => Number(r.total || 0) > Number(r.total_paid || 0)).length,
      );
      setInvCount(all.count ?? 0);
      setEinvoicesCount(ei.count ?? 0);
      setRecent(((rec.data ?? []) as unknown as InvoiceRow[]));
      setLoading(false);
    })().catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">HEAD SALES</h1>
          <p className="text-sm text-muted-foreground">Live view of invoicing, receivables and compliance.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild size="sm"><Link to="/sales/invoices/new"><Receipt className="h-4 w-4 mr-1.5" />New Invoice</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/sales/payments/new"><Wallet className="h-4 w-4 mr-1.5" />Record Payment</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/crm/quotations"><FileText className="h-4 w-4 mr-1.5" />New Quote</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/sales/eway"><Truck className="h-4 w-4 mr-1.5" />e-Way Bill</Link></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={IndianRupee} label="Sales Today" value={loading ? "…" : inr(today)} />
        <Kpi icon={IndianRupee} label="Sales MTD" value={loading ? "…" : inr(mtd)} />
        <Kpi icon={AlertCircle} label="Outstanding" value={loading ? "…" : inr(outstanding)} tone="text-amber-600" />
        <Kpi icon={Receipt} label="Total Invoices" value={loading ? "…" : invCount.toLocaleString("en-IN")} />
        <Kpi icon={Clock} label="Pending Payment" value={loading ? "…" : pendingPay.toLocaleString("en-IN")} />
        <Kpi icon={CheckCircle2} label="e-Invoices" value={loading ? "…" : einvoicesCount.toLocaleString("en-IN")} tone="text-emerald-600" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Recent Invoices</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left p-2">Invoice #</th>
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Customer</th>
                  <th className="text-right p-2">Total</th>
                  <th className="text-right p-2">Paid</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
                ) : recent.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">
                    No invoices yet. <Link to="/sales/invoices/new" className="text-primary underline">Create the first one</Link>.
                  </td></tr>
                ) : recent.map((r) => {
                  const s = statusMeta(r.status);
                  return (
                    <tr key={r.id} className="border-t hover:bg-muted/40">
                      <td className="p-2 font-mono text-xs">
                        <Link to="/sales/invoices/$id" params={{ id: r.id }} className="text-primary hover:underline">
                          {r.invoice_no || r.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="p-2">{r.invoice_date}</td>
                      <td className="p-2">{r.buyer_name || "—"}</td>
                      <td className="p-2 text-right font-medium">{inr(r.total)}</td>
                      <td className="p-2 text-right">{inr(r.total_paid)}</td>
                      <td className="p-2"><span className={"inline-block px-2 py-0.5 rounded-full text-xs " + s.tone}>{s.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}