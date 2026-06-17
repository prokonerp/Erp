import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { listStock, updateStock, createTransaction, STOCK_STATUS_LABEL, type StockItem } from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/oem-returns")({
  component: OemReturns,
});

function OemReturns() {
  const [rows, setRows] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const all = await listStock();
      setRows(all.filter((s) => s.stock_type === "defective"));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function markReturned(s: StockItem) {
    try {
      await updateStock(s.id, { stock_status: "returned_to_oem" });
      await createTransaction({
        txn_type: "oem_return", stock_item_id: s.id, part_name: s.part_name,
        part_model_no: s.part_model_no, part_serial_no: s.part_serial_no, oem: s.oem,
        from_warehouse_id: s.warehouse_id, to_party: s.oem || "OEM", qty: 1,
        notes: "Defective returned to OEM",
      });
      toast.success("Marked returned to OEM");
      load();
    } catch (e: any) { toast.error(e?.message || "Failed"); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">OEM Return Tracking</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">OEM</th>
              <th className="p-2">Model / Part Name</th>
              <th className="p-2">Model / Part Serial No</th>
              <th className="p-2">OEM Case</th>
              <th className="p-2">Status</th>
              <th className="p-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={6}>No defective stock.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">{r.oem || "—"}</td>
                <td className="p-2">{r.part_name}</td>
                <td className="p-2 font-mono">{r.part_serial_no || "—"}</td>
                <td className="p-2 font-mono text-xs">{r.oem_case_id || "—"}</td>
                <td className="p-2"><Badge variant="outline">{STOCK_STATUS_LABEL[r.stock_status]}</Badge></td>
                <td className="p-2 text-right">
                  {r.stock_status !== "returned_to_oem" && r.stock_status !== "scrapped" && (
                    <Button size="sm" variant="outline" onClick={() => markReturned(r)}>Mark Returned to OEM</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}