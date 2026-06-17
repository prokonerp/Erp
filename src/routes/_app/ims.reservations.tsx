import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { listReservations, updateReservation, type Reservation } from "@/lib/ims";

export const Route = createFileRoute("/_app/ims/reservations")({
  component: ReservationsList,
});

function ReservationsList() {
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try { setRows(await listReservations()); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function change(id: string, status: Reservation["status"]) {
    try {
      await updateReservation(id, { status, released_at: status === "released" ? new Date().toISOString() : null });
      toast.success("Reservation updated");
      load();
    } catch (e: any) { toast.error(e?.message || "Failed"); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Stock Reservations</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="p-2">Stock Item</th>
              <th className="p-2">Ticket</th>
              <th className="p-2">Indent</th>
              <th className="p-2">Status</th>
              <th className="p-2">Reserved At</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={6}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="p-4 text-muted-foreground" colSpan={6}>No reservations yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2 font-mono text-xs">{r.stock_item_id}</td>
                <td className="p-2 font-mono text-xs">{r.ticket_id || "—"}</td>
                <td className="p-2 font-mono text-xs">{r.indent_id || "—"}</td>
                <td className="p-2"><Badge variant="outline">{r.status}</Badge></td>
                <td className="p-2">{new Date(r.reserved_at).toLocaleString()}</td>
                <td className="p-2 text-right space-x-1">
                  {r.status === "reserved" && <>
                    <Button size="sm" variant="outline" onClick={() => change(r.id, "issued")}>Issue</Button>
                    <Button size="sm" variant="ghost" onClick={() => change(r.id, "released")}>Release</Button>
                  </>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}