import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useRouteState } from "@/lib/routeState";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { fetchSalesOrdersPage, soStatusMeta, soDerivedStatus, type SoFulfillmentSummary } from "@/lib/salesOrders";
import { inr } from "@/lib/sales";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useDebounced } from "@/lib/sales.hooks";
import { PaginationFooter } from "@/components/PaginationFooter";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/sales/orders/")({
  component: SalesOrdersList,
});

type SummaryRow = {
  sales_order_id: string;
  ordered_qty: number;
  fulfilled_stock: number;
  balance: number;
};

function SalesOrdersList() {
  const [q, setQ] = useRouteState<string>("q", "");
  const [page, setPage] = useRouteState<number>("page", 0);
  const pageSize = 25;
  const debouncedQ = useDebounced(q.trim(), 250);

  // Reset paging when search changes (mirrors sales.invoices.index:33 + CustomerMaster)
  useEffect(() => {
    if (page !== 0) setPage(0);
  }, [debouncedQ]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useQuery({
    queryKey: ["sales_orders", { q: debouncedQ, page, pageSize }],
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    queryFn: () => fetchSalesOrdersPage({ page, pageSize, search: debouncedQ }),
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.count ?? 0;
  const loading = query.isLoading;

  const soIds = useMemo(() => rows.map((r) => r.id), [rows]);

  const summariesQuery = useQuery({
    queryKey: ["so-summaries", [...soIds].sort().join(",")],
    enabled: soIds.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("so_fulfillment_summary" as never)
        .select("*")
        .in("sales_order_id", soIds);
      if (error) {
        // view may not exist on older env — fail soft
        console.warn("[so-summaries] fetch failed", error.message);
        return [] as SummaryRow[];
      }
      return (data ?? []) as unknown as SummaryRow[];
    },
  });

  const summaryMap = useMemo(() => {
    const m = new Map<string, { ordered: number; fulfilled: number; balance: number }>();
    const raw = (summariesQuery.data ?? []) as SummaryRow[];
    for (const r of raw) {
      const key = r.sales_order_id;
      const cur = m.get(key) ?? { ordered: 0, fulfilled: 0, balance: 0 };
      cur.ordered += Number((r as any).ordered_qty) || 0;
      cur.fulfilled += Number((r as any).fulfilled_stock) || 0;
      cur.balance += Number((r as any).balance) || 0;
      m.set(key, cur);
    }
    // fallback: if view returns no rows but SO has items, derive ordered from items JSONB
    for (const r of rows) {
      if (!m.has(r.id)) {
        const itemsArr = Array.isArray((r as any).items) ? (r as any).items : [];
        const ordered = itemsArr.reduce((s: number, it: any) => s + (Number(it?.qty) || 0), 0);
        m.set(r.id, { ordered, fulfilled: 0, balance: ordered });
      } else {
        // if view returned 0 ordered due to missing items handling, patch
        const cur = m.get(r.id)!;
        if (cur.ordered === 0) {
          const itemsArr = Array.isArray((r as any).items) ? (r as any).items : [];
          const ordered = itemsArr.reduce((s: number, it: any) => s + (Number(it?.qty) || 0), 0);
          if (ordered > 0) {
            cur.ordered = ordered;
            cur.balance = Math.max(0, ordered - cur.fulfilled);
            m.set(r.id, cur);
          }
        }
      }
    }
    return m;
  }, [summariesQuery.data, rows]);

  // Per-SO derived status: group raw summary rows by SO and run soDerivedStatus; fallback to stored status
  const derivedMap = useMemo(() => {
    const raw = (summariesQuery.data ?? []) as unknown as SoFulfillmentSummary[];
    const bySo = new Map<string, SoFulfillmentSummary[]>();
    for (const r of raw) {
      const sid = (r as any).sales_order_id as string;
      if (!sid) continue;
      const arr = bySo.get(sid) ?? [];
      arr.push(r as SoFulfillmentSummary);
      bySo.set(sid, arr);
    }
    const out = new Map<string, ReturnType<typeof soDerivedStatus>>();
    for (const r of rows) {
      const stored = (r as any).status as string;
      if (String(stored).trim().toLowerCase() === "cancelled") {
        out.set(r.id, "cancelled");
        continue;
      }
      const grp = bySo.get(r.id);
      if (!grp || grp.length === 0) {
        out.set(r.id, stored as any);
        continue;
      }
      try {
        out.set(r.id, soDerivedStatus(grp, stored as any, null));
      } catch {
        out.set(r.id, stored as any);
      }
    }
    return out;
  }, [summariesQuery.data, rows]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Sales Orders</CardTitle>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search SO # or customer…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs h-8 pl-8"
          />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            {debouncedQ
              ? `No results for "${debouncedQ}"`
              : "No sales orders yet. Convert a Quotation from CRM → Quotations to create one."}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left p-2">SO No</th>
                    <th className="text-left p-2">Date</th>
                    <th className="text-left p-2">Customer</th>
                    <th className="text-right p-2">Total</th>
                    <th className="text-left p-2 min-w-[140px]">Fulfilled</th>
                    <th className="text-right p-2">Balance</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const derived = derivedMap.get(r.id) ?? (r.status as any);
                    const st = soStatusMeta(derived as any);
                    const isCancelledRow = String(derived).trim().toLowerCase() === "cancelled" || String(r.status).trim().toLowerCase() === "cancelled";
                    const s = summaryMap.get(r.id);
                    const ordered = s?.ordered ?? 0;
                    const fulfilled = s?.fulfilled ?? 0;
                    const balance = s?.balance ?? ordered;
                    const pctRaw = ordered > 0 ? (fulfilled / ordered) * 100 : 0;
                    const pct = Number.isFinite(pctRaw) ? Math.min(100, Math.round(pctRaw)) : 0;
                    const isZeroBalance = balance <= 0 && ordered > 0;
                    const balDisplay = Number.isFinite(Number(balance)) ? (isZeroBalance ? "—" : String(balance)) : "—";
                    return (
                      <tr key={r.id} className={`border-t hover:bg-muted/30 ${isCancelledRow ? "opacity-60 bg-muted/10" : ""}`}>
                        <td className={`p-2 font-mono text-xs ${isCancelledRow ? "line-through text-muted-foreground" : ""}`}>
                          <Link
                            to="/sales/orders/$id"
                            params={{ id: r.id }}
                            className="text-primary hover:underline"
                          >
                            {r.so_no || "—"}
                          </Link>
                        </td>
                        <td className="p-2 text-xs tabular-nums">{r.so_date || "—"}</td>
                        <td className="p-2 max-w-[180px] truncate">{r.buyer_name || "—"}</td>
                        <td className="p-2 text-right font-medium tabular-nums">{inr(Number(r.total) || 0)}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-2 min-w-[130px]">
                            <Progress value={Number.isFinite(pct) ? pct : 0} className="h-1.5 w-[60px] shrink-0" />
                            <span className="text-xs tabular-nums whitespace-nowrap">
                              {Number.isFinite(fulfilled) ? fulfilled : 0}/{Number.isFinite(ordered) ? ordered : 0}
                            </span>
                            <span className="text-[11px] text-muted-foreground tabular-nums">{Number.isFinite(pct) ? pct : 0}%</span>
                          </div>
                        </td>
                        <td className={`p-2 text-right tabular-nums text-xs font-medium ${isCancelledRow ? "text-muted-foreground line-through" : isZeroBalance ? "text-emerald-600" : balance > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                          {isCancelledRow ? "—" : balDisplay}
                        </td>
                        <td className="p-2">
                          <StatusBadge tone={st.badgeTone}>{st.label}</StatusBadge>
                          {derived !== r.status && !isCancelledRow && (
                            <span className="ml-1 text-[10px] text-muted-foreground">({soStatusMeta(r.status as any).label})</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationFooter
              page={page}
              pageSize={pageSize}
              total={total}
              onPage={setPage}
              isFetching={query.isFetching && !query.isLoading}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
