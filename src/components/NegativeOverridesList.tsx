import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useIsAdmin } from "@/lib/useRole";
import { listNegativeOverrides, type NegativeOverrideRow } from "@/lib/negativeStock";
import type { WarehouseLite } from "@/lib/ims";

/** Admin-only review list of every approved oversell. */
export function NegativeOverridesList({ warehouses }: { warehouses: WarehouseLite[] }) {
  const { isAdmin, loading: roleLoading } = useIsAdmin();
  const [rows, setRows] = useState<NegativeOverrideRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    listNegativeOverrides()
      .then(setRows)
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (roleLoading || !isAdmin) return null;

  const whName = (id: string | null) => warehouses.find((w) => w.id === id)?.name || "—";

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Negative Stock Overrides (Admin)</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">When</th>
                <th className="p-2">Document</th>
                <th className="p-2">Product</th>
                <th className="p-2">Warehouse</th>
                <th className="p-2 text-right">Requested</th>
                <th className="p-2 text-right">Available</th>
                <th className="p-2 text-right">Resulting</th>
                <th className="p-2">By</th>
                <th className="p-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={9}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={9}>No overrides recorded.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{new Date(r.overridden_at).toLocaleString()}</td>
                  <td className="p-2 uppercase text-xs">{r.document_type}{r.document_no ? ` · ${r.document_no}` : ""}</td>
                  <td className="p-2">{r.product_model}</td>
                  <td className="p-2">{whName(r.warehouse_id)}</td>
                  <td className="p-2 text-right">{r.requested_qty}</td>
                  <td className="p-2 text-right">{r.available_qty}</td>
                  <td className="p-2 text-right font-semibold text-destructive">{r.resulting_negative_qty}</td>
                  <td className="p-2">{r.overridden_by_name || "—"}</td>
                  <td className="p-2 text-muted-foreground">{r.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
