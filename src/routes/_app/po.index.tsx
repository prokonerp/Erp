import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useRouteState } from "@/lib/routeState";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { inrPO, poStatusMeta, PO_STATUSES, type PORow, type POStatus } from "@/lib/purchaseOrder";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { TableSkeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/EmptyState";
import { PaginationFooter } from "@/components/PaginationFooter";

export const Route = createFileRoute("/_app/po/")({
  component: POList,
  head: () => ({ meta: [{ title: "Purchase Orders — Prokon" }] }),
});

const PAGE_SIZE = 50;

function POList() {
  const [rows, setRows] = useState<PORow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [q, setQ] = useRouteState("q", "");
  const [status, setStatus] = useRouteState<POStatus | "all">("status", "all");

  useEffect(() => {
    setPage(0);
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        let query: any = (supabase as any).from("purchase_orders")
          .select("id,po_no,po_date,vendor_name,vendor_gstin,customer_name,delivery_address_type,delivery_date,total,status", { count: "exact" })
          .order("po_date", { ascending: false })
          .range(from, to);
        if (status !== "all") query = query.eq("status", status);
        const { data, error, count } = await query;
        if (error) throw error;
        if (!cancelled) {
          setRows((data ?? []) as PORow[]);
          if (typeof count === "number") setTotal(count);
        }
      } catch (e: any) {
        if (!cancelled) toast.error(e.message || "Failed to load purchase orders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [status, page]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.po_no, r.vendor_name, r.vendor_gstin, r.customer_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, q]);

  const totalAmt = filtered.reduce((s, r) => s + Number(r.total || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">All Purchase Orders</h2>
        <Button asChild size="sm"><Link to="/po/new"><Plus className="h-4 w-4 mr-1" />New PO</Link></Button>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-[20rem] sm:w-auto sm:flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search PO no, vendor, customer…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 w-full h-9" />
          </div>
          <select className="h-9 rounded-md border bg-background px-2 text-sm w-full max-w-[12rem] sm:w-auto" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="all">All statuses</option>
            {PO_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <div className="ml-auto text-xs text-muted-foreground w-full sm:w-auto text-right">
            <span>{filtered.length} PO(s) · Total: <b>{inrPO(totalAmt)}</b></span>
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-md overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0 z-10 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left p-2">PO #</th>
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Vendor</th>
                <th className="text-left p-2">Delivery</th>
                <th className="text-right p-2">Total</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-0"><TableSkeleton rows={6} colCount={6} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-0"><EmptyState title="No purchase orders yet" hint={q ? "Try a different search." : "Create your first PO."} /></td></tr>
              ) : filtered.map((r) => {
                const sm = poStatusMeta(r.status);
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/40">
                    <td className="p-2 font-mono text-xs">
                      <Link to="/po/$id" params={{ id: r.id }} className="text-primary hover:underline">
                        {r.po_no || r.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="p-2">{r.po_date}</td>
                    <td className="p-2">{r.vendor_name || "—"}</td>
                    <td className="p-2 text-xs">
                      {r.delivery_address_type === "customer" ? `Customer: ${r.customer_name || "—"}`
                        : r.delivery_address_type === "custom" ? "Custom"
                        : "Organization"}
                      {r.delivery_date ? <span className="text-muted-foreground"> · {r.delivery_date}</span> : null}
                    </td>
                    <td className="p-2 text-right font-medium">{inrPO(r.total)}</td>
                    <td className="p-2"><StatusBadge tone={sm.badgeTone}>{sm.label}</StatusBadge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PaginationFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} isFetching={loading} />
      </div>
    </div>
  );
}
