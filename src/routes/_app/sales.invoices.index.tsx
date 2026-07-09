import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { inr, statusMeta, INVOICE_STATUSES, type InvoiceRow, type InvoiceStatus } from "@/lib/sales";
import { useDebounced, pageRange } from "@/lib/sales.hooks";
import { PaginationFooter } from "@/components/PaginationFooter";
import { PermButton } from "@/components/PermGate";

export const Route = createFileRoute("/_app/sales/invoices/")({
  component: InvoiceList,
  head: () => ({ meta: [{ title: "Invoices — Prokon" }] }),
});

function InvoiceList() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<InvoiceStatus | "all">("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const debouncedQ = useDebounced(q.trim(), 300);
  // Reset paging when filters change.
  useMemo(() => setPage(0), [debouncedQ, status]);

  const query = useQuery({
    queryKey: ["invoices", { status, q: debouncedQ, page, pageSize }],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async () => {
      const { from, to } = pageRange(page, pageSize);
      let sel = supabase.from("invoices").select("*", { count: "exact" })
        .order("invoice_date", { ascending: false }).range(from, to);
      if (status !== "all") sel = sel.eq("status", status);
      if (debouncedQ) {
        // Sanitize %/_ so search input can't broaden the LIKE pattern.
        const safe = debouncedQ.replace(/[%_]/g, "\\$&");
        sel = sel.or(`invoice_no.ilike.%${safe}%,buyer_name.ilike.%${safe}%,buyer_gstin.ilike.%${safe}%`);
      }
      const { data, count, error } = await sel;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as InvoiceRow[], count: count ?? 0 };
    },
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.count ?? null;

  const totals = useMemo(() => {
    const tot = rows.reduce((s, r) => s + Number(r.total || 0), 0);
    const paid = rows.reduce((s, r) => s + Number(r.total_paid || 0), 0);
    return { total: tot, paid, due: tot - paid };
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Invoices</h2>
        <PermButton module="sales" action="create" size="sm" asChild reason="You don't have permission to create invoices.">
          <Link to="/sales/invoices/new"><Plus className="h-4 w-4 mr-1" />New Invoice</Link>
        </PermButton>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search by number, customer, GSTIN…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 w-72 h-9" />
          </div>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="all">All statuses</option>
            {INVOICE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <div className="ml-auto text-xs text-muted-foreground">
            <span className="mr-3">Page total: <b>{inr(totals.total)}</b></span>
            <span className="mr-3">Paid: <b className="text-emerald-700">{inr(totals.paid)}</b></span>
            <span>Due: <b className="text-amber-700">{inr(totals.due)}</b></span>
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-md overflow-hidden">
        <div className="overflow-auto max-h-[65vh]">
        <table className="w-full text-sm">
          <thead className="bg-muted sticky top-0 z-10 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left p-2">Invoice #</th>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Customer</th>
              <th className="text-left p-2">GSTIN</th>
              <th className="text-right p-2">Total</th>
              <th className="text-right p-2">Paid</th>
              <th className="text-right p-2">Due</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">IRN</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No invoices.</td></tr>
            ) : rows.map((r) => {
              const s = statusMeta(r.status);
              const due = Math.max(0, Number(r.total) - Number(r.total_paid));
              return (
                <tr key={r.id} className="border-t hover:bg-muted/40">
                  <td className="p-2 font-mono text-xs">
                    <Link to="/sales/invoices/$id" params={{ id: r.id }} className="text-primary hover:underline">
                      {r.invoice_no || r.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="p-2">{r.invoice_date}</td>
                  <td className="p-2">{r.buyer_name || "—"}</td>
                  <td className="p-2 font-mono text-xs">{r.buyer_gstin || "—"}</td>
                  <td className="p-2 text-right font-medium">{inr(r.total)}</td>
                  <td className="p-2 text-right text-emerald-700">{inr(r.total_paid)}</td>
                  <td className="p-2 text-right text-amber-700">{inr(due)}</td>
                  <td className="p-2"><span className={"inline-block px-2 py-0.5 rounded-full text-xs " + s.tone}>{s.label}</span></td>
                  <td className="p-2 text-xs">{r.irn ? <span className="text-emerald-700">✓</span> : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        <PaginationFooter page={page} pageSize={pageSize} total={total} onPage={setPage} isFetching={query.isFetching && !query.isLoading} />
      </div>
    </div>
  );
}