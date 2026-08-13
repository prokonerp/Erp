import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus } from "lucide-react";
import { listGeneralDcs, gdcTotal, type GeneralDcRow } from "@/lib/generalDc";
import { inr } from "@/lib/sales";

export const Route = createFileRoute("/_app/sales/general-dc/")({
  component: GeneralDcList,
  head: () => ({
    meta: [
      { title: "General Delivery Challans — Prokon ERP" },
      { name: "description", content: "Standalone dispatch challans with stock posting and invoice conversion." },
      { property: "og:title", content: "General Delivery Challans — Prokon ERP" },
      { property: "og:description", content: "Standalone dispatch challans with stock posting and invoice conversion." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

const tone: Record<string, string> = {
  Draft: "bg-slate-200 text-slate-800",
  Issued: "bg-blue-100 text-blue-800",
  Converted: "bg-emerald-100 text-emerald-800",
};

function GeneralDcList() {
  const [rows, setRows] = useState<GeneralDcRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listGeneralDcs()
      .then(setRows)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">General Delivery Challans</h1>
        <Button size="sm" asChild>
          <Link to="/sales/general-dc/new"><Plus className="h-4 w-4 mr-1.5" />New General DC</Link>
        </Button>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-2 text-left">DC No</th>
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-left">Customer</th>
                <th className="p-2 text-left">Type</th>
                <th className="p-2 text-left">Purpose</th>
                <th className="p-2 text-right">Value</th>
                <th className="p-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No general delivery challans yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/50">
                  <td className="p-2 font-medium">
                    <Link to="/sales/general-dc/$id" params={{ id: r.id }} className="text-primary hover:underline">
                      {r.dc_no || "—"}
                    </Link>
                  </td>
                  <td className="p-2">{r.dc_date}</td>
                  <td className="p-2">{r.customer_name || "—"}</td>
                  <td className="p-2">{r.returnable ? "Returnable" : "Non-Returnable"}</td>
                  <td className="p-2 max-w-[240px] truncate">{r.purpose || "—"}</td>
                  <td className="p-2 text-right">{inr(gdcTotal(r.items || []))}</td>
                  <td className="p-2"><Badge className={tone[r.status] || ""} variant="secondary">{r.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}