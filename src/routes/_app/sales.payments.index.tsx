import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { inr, type PaymentRow } from "@/lib/sales";
import { useDebounced, pageRange } from "@/lib/sales.hooks";
import { PaginationFooter } from "@/components/PaginationFooter";
import { PermButton } from "@/components/PermGate";

export const Route = createFileRoute("/_app/sales/payments/")({
  component: PaymentList,
  head: () => ({ meta: [{ title: "Payments Received — Prokon" }] }),
});

type Row = PaymentRow & { customer?: { company: string } };

function PaymentList() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const debouncedQ = useDebounced(q.trim(), 300);
  useMemo(() => setPage(0), [debouncedQ]);

  const query = useQuery({
    queryKey: ["payments_received", { q: debouncedQ, page, pageSize }],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: async () => {
      const { from, to } = pageRange(page, pageSize);
      let sel = supabase
        .from("payments_received")
        .select("*, customer:customers(company)", { count: "exact" })
        .order("payment_date", { ascending: false })
        .range(from, to);
      if (debouncedQ) {
        const safe = debouncedQ.replace(/[%_]/g, "\\$&");
        sel = sel.or(`payment_no.ilike.%${safe}%,reference.ilike.%${safe}%`);
      }
      const { data, count, error } = await sel;
      if (error) throw error;
      return { rows: ((data ?? []) as unknown as Row[]), count: count ?? 0 };
    },
  });

  const rows = query.data?.rows ?? [];
  const total = query.data?.count ?? null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Payments Received</h2>
        <PermButton module="sales" action="create" size="sm" asChild reason="You don't have permission to record payments.">
          <Link to="/sales/payments/new"><Plus className="h-4 w-4 mr-1" />Record Payment</Link>
        </PermButton>
      </div>
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search receipt / reference…" className="pl-8 h-9" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[65vh]">
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
              {query.isLoading ? (
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
          </div>
          <PaginationFooter page={page} pageSize={pageSize} total={total} onPage={setPage} isFetching={query.isFetching && !query.isLoading} />
        </CardContent>
      </Card>
    </div>
  );
}