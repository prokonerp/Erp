import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useRouteState } from "@/lib/routeState";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchSalesOrdersPage, soStatusMeta } from "@/lib/salesOrders";
import { inr } from "@/lib/sales";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useDebounced } from "@/lib/sales.hooks";
import { PaginationFooter } from "@/components/PaginationFooter";
import { Search } from "lucide-react";

export const Route = createFileRoute("/_app/sales/orders")({ component: SalesOrdersList });

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
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = soStatusMeta(r.status);
                    return (
                      <tr key={r.id} className="border-t hover:bg-muted/30">
                        <td className="p-2 font-mono">
                          <Link
                            to="/sales/orders/$id"
                            params={{ id: r.id }}
                            className="text-primary hover:underline"
                          >
                            {r.so_no || "—"}
                          </Link>
                        </td>
                        <td className="p-2">{r.so_date}</td>
                        <td className="p-2">{r.buyer_name || "—"}</td>
                        <td className="p-2 text-right font-medium">{inr(r.total)}</td>
                        <td className="p-2">
                          <StatusBadge tone={st.badgeTone}>{st.label}</StatusBadge>
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
