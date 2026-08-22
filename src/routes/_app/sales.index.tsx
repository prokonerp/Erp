import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Receipt, Wallet, Truck, FileText, IndianRupee, AlertCircle, CheckCircle2, Clock,
  TrendingUp, ShoppingCart, ArrowRightLeft, Activity, RotateCcw, PackageCheck,
} from "lucide-react";
import { inr, statusMeta, fetchBranches, type InvoiceRow, type BranchRow } from "@/lib/sales";
import { StatusBadge } from "@/components/shared/StatusBadge";

// Lazy-load the recharts-backed charts section (~400KB) so the sales dashboard
// KPI cards and tables render immediately, without waiting on recharts.
const SalesDashboardCharts = lazy(() => import("@/components/SalesDashboardCharts"));

export const Route = createFileRoute("/_app/sales/")({
  component: HeadSalesDashboard,
  head: () => ({ meta: [{ title: "HEAD SALES — Prokon" }] }),
});

type QuoteRow = { id: string; status: string; salesperson: string | null; branch_id: string | null; total: number | null; quote_date: string | null; customer_id: string | null };
type SoRow = { id: string; status: string; salesperson: string | null; branch_id: string | null; total: number | null; so_date: string | null; customer_id: string | null; linked_quote_id: string | null };
type InvSlim = { id: string; status: string; total: number | null; total_paid: number | null; invoice_date: string | null; branch_id: string | null; buyer_name: string | null; buyer_state: string | null; customer_id: string | null; sales_order_id: string | null };
type ItemSlim = { description: string | null; qty: number | null; line_total: number | null; invoice_id: string };

const todayIso = () => new Date().toISOString().slice(0, 10);
const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const fmtMonth = (d: string) => d.slice(0, 7);
const monthLabel = (ym: string) => { const [y, m] = ym.split("-"); return new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-IN", { month: "short", year: "2-digit" }); };

function Kpi({ icon: Icon, label, value, hint, tone = "" }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string | number; hint?: string; tone?: string }) {
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
  const [branches, setBranches] = useState<BranchRow[]>([]);

  // Filters — 90-day window by default.
  const [from, setFrom] = useState<string>(daysAgoIso(90));
  const [to, setTo] = useState<string>(todayIso());
  const [branchId, setBranchId] = useState<string>("all");
  const [salesperson, setSalesperson] = useState<string>("all");
  const [region, setRegion] = useState<string>("all");

  // Raw datasets — one bounded fetch per source, filtered in JS to avoid N+1.
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [orders, setOrders] = useState<SoRow[]>([]);
  const [invoices, setInvoices] = useState<InvSlim[]>([]);
  const [items, setItems] = useState<ItemSlim[]>([]);
  const [outstandingAll, setOutstandingAll] = useState(0);
  const [outstandingCount, setOutstandingCount] = useState(0);
  const [monthly, setMonthly] = useState<{ ym: string; total: number }[]>([]);
  const [recent, setRecent] = useState<InvoiceRow[]>([]);

  useEffect(() => { fetchBranches().then(setBranches).catch(() => {}); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const trendFrom = daysAgoIso(365);
      const [qRes, sRes, iRes, outRes, trendRes, recRes] = await Promise.all([
        supabase.from("quotations").select("id,status,salesperson,branch_id,total,quote_date,customer_id").gte("quote_date", from).lte("quote_date", to).limit(2000),
        supabase.from("sales_orders" as never).select("id,status,salesperson,branch_id,total,so_date,customer_id,linked_quote_id").gte("so_date", from).lte("so_date", to).limit(2000),
        supabase.from("invoices").select("id,status,total,total_paid,invoice_date,branch_id,buyer_name,buyer_state,customer_id,sales_order_id").gte("invoice_date", from).lte("invoice_date", to).neq("status", "cancelled").limit(2000),
        supabase.from("invoices").select("total,total_paid").in("status", ["issued", "partial"]).limit(5000),
        supabase.from("invoices").select("invoice_date,total").gte("invoice_date", trendFrom).neq("status", "cancelled").limit(5000),
        supabase.from("invoices").select("*").order("created_at", { ascending: false }).limit(8),
      ]);
      if (cancelled) return;

      const qs = (qRes.data ?? []) as QuoteRow[];
      const so = (sRes.data ?? []) as unknown as SoRow[];
      const inv = (iRes.data ?? []) as InvSlim[];

      // Batch item fetch — single query keyed on filtered invoice ids.
      let it: ItemSlim[] = [];
      if (inv.length) {
        const { data } = await supabase.from("invoice_items")
          .select("description,qty,line_total,invoice_id")
          .in("invoice_id", inv.map((i) => i.id));
        if (cancelled) return;
        it = (data ?? []) as ItemSlim[];
      }

      const trendRows = (trendRes.data ?? []) as { invoice_date: string; total: number | null }[];
      const grouped = new Map<string, number>();
      for (let i = 11; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
        grouped.set(d.toISOString().slice(0, 7), 0);
      }
      for (const r of trendRows) {
        if (!r.invoice_date) continue;
        const ym = fmtMonth(r.invoice_date);
        if (!grouped.has(ym)) continue;
        grouped.set(ym, (grouped.get(ym) || 0) + Number(r.total || 0));
      }

      const out = (outRes.data ?? []) as { total: number | null; total_paid: number | null }[];
      const outstandingTotal = out.reduce((s, r) => s + Math.max(0, Number(r.total || 0) - Number(r.total_paid || 0)), 0);

      setQuotes(qs);
      setOrders(so);
      setInvoices(inv);
      setItems(it);
      setOutstandingAll(outstandingTotal);
      setOutstandingCount(out.filter((r) => Number(r.total || 0) > Number(r.total_paid || 0)).length);
      setMonthly(Array.from(grouped, ([ym, total]) => ({ ym, total })));
      setRecent((recRes.data ?? []) as unknown as InvoiceRow[]);
      setLoading(false);
    })().catch((e) => { console.error(e); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [from, to]);

  const salespersons = useMemo(() => {
    const set = new Set<string>();
    quotes.forEach((q) => q.salesperson && set.add(q.salesperson));
    orders.forEach((o) => o.salesperson && set.add(o.salesperson));
    return Array.from(set).sort();
  }, [quotes, orders]);

  const regions = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach((i) => i.buyer_state && set.add(i.buyer_state));
    return Array.from(set).sort();
  }, [invoices]);

  const fq = useMemo(() => quotes.filter((r) =>
    (branchId === "all" || r.branch_id === branchId) &&
    (salesperson === "all" || r.salesperson === salesperson),
  ), [quotes, branchId, salesperson]);
  const fso = useMemo(() => orders.filter((r) =>
    (branchId === "all" || r.branch_id === branchId) &&
    (salesperson === "all" || r.salesperson === salesperson),
  ), [orders, branchId, salesperson]);
  const fi = useMemo(() => invoices.filter((r) =>
    (branchId === "all" || r.branch_id === branchId) &&
    (region === "all" || r.buyer_state === region),
  ), [invoices, branchId, region]);

  const pipeline = useMemo(() => {
    const pending = fq.filter((q) => q.status === "draft" || q.status === "sent").length;
    const won = fq.filter((q) => q.status === "accepted" || q.status === "invoiced").length;
    const lost = fq.filter((q) => q.status === "declined" || q.status === "expired").length;
    return { total: fq.length, pending, won, lost };
  }, [fq]);

  const conv = useMemo(() => {
    const qToSo = fq.length ? (fso.length / fq.length) * 100 : 0;
    const soIds = new Set(fso.map((s) => s.id));
    const invFromSo = fi.filter((i) => i.sales_order_id && soIds.has(i.sales_order_id)).length;
    const soToInv = fso.length ? (invFromSo / fso.length) * 100 : 0;
    return { qToSo, soToInv, invFromSo };
  }, [fq, fso, fi]);

  const revenue = useMemo(() => {
    const total = fi.reduce((s, r) => s + Number(r.total || 0), 0);
    const deals = fi.length;
    return { total, avg: deals ? total / deals : 0, count: deals };
  }, [fi]);

  const topCustomers = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of fi) {
      const k = r.buyer_name || "—";
      map.set(k, (map.get(k) || 0) + Number(r.total || 0));
    }
    return Array.from(map, ([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [fi]);

  const topProducts = useMemo(() => {
    const visible = new Set(fi.map((i) => i.id));
    const map = new Map<string, { qty: number; value: number }>();
    for (const it of items) {
      if (!visible.has(it.invoice_id)) continue;
      const key = (it.description || "—").split("\n")[0].slice(0, 60);
      const cur = map.get(key) || { qty: 0, value: 0 };
      cur.qty += Number(it.qty || 0);
      cur.value += Number(it.line_total || 0);
      map.set(key, cur);
    }
    return Array.from(map, ([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [items, fi]);

  const monthlySeries = useMemo(() => monthly.map((m) => ({ month: monthLabel(m.ym), total: m.total })), [monthly]);

  const resetFilters = () => { setFrom(daysAgoIso(90)); setTo(todayIso()); setBranchId("all"); setSalesperson("all"); setRegion("all"); };
  const winRate = pipeline.total ? (pipeline.won / pipeline.total) * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">HEAD SALES</h1>
          <p className="text-sm text-muted-foreground">Pipeline, conversion and revenue at a glance.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button asChild size="sm"><Link to="/sales/invoices/new"><Receipt className="h-4 w-4 mr-1.5" />New Invoice</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/sales/payments/new"><Wallet className="h-4 w-4 mr-1.5" />Record Payment</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/crm/quotations"><FileText className="h-4 w-4 mr-1.5" />New Quote</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/sales/general-dc/new"><PackageCheck className="h-4 w-4 mr-1.5" />New General DC</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to="/sales/eway"><Truck className="h-4 w-4 mr-1.5" />e-Way Bill</Link></Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8" /></div>
          <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8" /></div>
          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All branches</SelectItem>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Salesperson</Label>
            <Select value={salesperson} onValueChange={setSalesperson}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{salespersons.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Region</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">All regions</SelectItem>{regions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8"><RotateCcw className="h-3.5 w-3.5 mr-1" />Reset</Button>
        </CardContent>
      </Card>

      <div className="space-y-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Pipeline</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi icon={FileText} label="Total Quotations" value={loading ? "…" : pipeline.total.toLocaleString("en-IN")} hint={`Win rate ${winRate.toFixed(0)}%`} />
          <Kpi icon={Clock} label="Pending" value={loading ? "…" : pipeline.pending.toLocaleString("en-IN")} tone="text-amber-600" hint="Draft + Sent" />
          <Kpi icon={CheckCircle2} label="Won" value={loading ? "…" : pipeline.won.toLocaleString("en-IN")} tone="text-emerald-600" hint="Accepted + Invoiced" />
          <Kpi icon={AlertCircle} label="Lost" value={loading ? "…" : pipeline.lost.toLocaleString("en-IN")} tone="text-rose-600" hint="Declined + Expired" />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><ArrowRightLeft className="h-4 w-4" />Conversion</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted-foreground">Quote → Sales Order</div>
              <div className="text-2xl font-bold mt-1">{loading ? "…" : `${conv.qToSo.toFixed(0)}%`}</div>
              <div className="text-xs text-muted-foreground">{fso.length} of {fq.length}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Sales Order → Invoice</div>
              <div className="text-2xl font-bold mt-1">{loading ? "…" : `${conv.soToInv.toFixed(0)}%`}</div>
              <div className="text-xs text-muted-foreground">{conv.invFromSo} of {fso.length}</div>
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Kpi icon={IndianRupee} label="Revenue" value={loading ? "…" : inr(revenue.total)} hint={`${revenue.count} invoices`} />
          <Kpi icon={TrendingUp} label="Avg Deal" value={loading ? "…" : inr(revenue.avg)} />
          <Kpi icon={AlertCircle} label="Outstanding" value={loading ? "…" : inr(outstandingAll)} tone="text-amber-600" hint={`${outstandingCount} inv`} />
          <Kpi icon={ShoppingCart} label="Sales Orders" value={loading ? "…" : fso.length.toLocaleString("en-IN")} />
        </div>
      </div>

      <Suspense fallback={<div className="h-64 animate-pulse bg-muted rounded-lg" />}>
        <SalesDashboardCharts loading={loading} monthlySeries={monthlySeries} topCustomers={topCustomers} topProducts={topProducts} />
      </Suspense>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" />Recent Activity</CardTitle></CardHeader>
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
                      <td className="p-2"><StatusBadge tone={s.badgeTone}>{s.label}</StatusBadge></td>
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