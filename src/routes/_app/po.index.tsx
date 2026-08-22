import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search } from "lucide-react";
import { inrPO, poStatusMeta, PO_STATUSES, type PORow, type POStatus } from "@/lib/purchaseOrder";
import { StatusBadge } from "@/components/shared/StatusBadge";

export const Route = createFileRoute("/_app/po/")({
  component: POList,
  head: () => ({ meta: [{ title: "Purchase Orders — Prokon" }] }),
});

function POList() {
  const [rows, setRows] = useState<PORow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<POStatus | "all">("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      let query: any = (supabase as any).from("purchase_orders").select("*").order("po_date", { ascending: false }).limit(500);
      if (status !== "all") query = query.eq("status", status);
      const { data } = await query;
      setRows((data ?? []) as PORow[]);
      setLoading(false);
    })();
  }, [status]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.po_no, r.vendor_name, r.vendor_gstin, r.customer_name].filter(Boolean).some((v) => String(v).toLowerCase().includes(s)),
    );
  }, [rows, q]);

  const total = filtered.reduce((s, r) => s + Number(r.total || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">All Purchase Orders</h2>
        <Button asChild size="sm"><Link to="/po/new"><Plus className="h-4 w-4 mr-1" />New PO</Link></Button>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search PO no, vendor, customer…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8 w-72 h-9" />
          </div>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="all">All statuses</option>
            {PO_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <div className="ml-auto text-xs text-muted-foreground">
            <span>{filtered.length} PO(s) · Total: <b>{inrPO(total)}</b></span>
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-md overflow-auto max-h-[70vh]">
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
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No purchase orders yet.</td></tr>
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
    </div>
  );
}