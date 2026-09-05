import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { TableSkeleton } from "@/components/shared/skeletons";
import { EmptyState } from "@/components/shared/EmptyState";
import { PaginationFooter } from "@/components/PaginationFooter";
import { Truck } from "lucide-react";

export const Route = createFileRoute("/_app/sales/eway/")({
  component: EwayList,
  head: () => ({ meta: [{ title: "e-Way Bills — Prokon" }] }),
});

const PAGE_SIZE = 50;

function EwayList() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        // Explicit cols + count + range — bounded, paginated (avoids unbounded * scan)
        const { data, error, count } = await supabase
          .from("eway_bills")
          .select("id,ewb_no,invoice_id,vehicle_no,transporter_name,valid_till,status,created_at, invoice:invoices(invoice_no,total,buyer_name)", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(from, to);
        if (error) throw error;
        if (!cancelled) {
          setRows(data ?? []);
          if (typeof count === "number") setTotal(count);
        }
      } catch (e: any) {
        if (!cancelled) toast.error(e.message || "Failed to load e-Way Bills");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [page]);

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-bold">e-Way Bills</h2>
      <p className="text-xs text-muted-foreground">Generate an e-Way Bill from an invoice's page. Bills above ₹50,000 require it.</p>
      <Card><CardContent className="p-0">
        <div className="overflow-x-auto">
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
              {loading ? (
                <tr><td colSpan={7} className="p-0"><TableSkeleton rows={6} colCount={7} /></td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="p-0"><EmptyState icon={Truck} title="No e-Way Bills yet" hint="Create one from an invoice's page." /></td></tr>
              ) : rows.map((r) => (
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
        </div>
        <PaginationFooter page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} isFetching={loading} />
      </CardContent></Card>
    </div>
  );
}
