import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { listReservations, updateReservation, deleteReservation, type Reservation } from "@/lib/ims";
import { useIsAdmin } from "@/lib/useRole";

export const Route = createFileRoute("/_app/ims/reservations")({
  component: ReservationsList,
});

function ReservationsList() {
  const { isAdmin } = useIsAdmin();
  const [rows, setRows] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Reservation | null>(null);

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

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteReservation(deleting.id);
      toast.success("Reservation deleted");
      setDeleting(null);
      load();
    } catch (e: any) { toast.error(e?.message || "Delete failed"); }
  }

  return (
    <>
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
                  {isAdmin && (
                    <Button size="icon" variant="ghost" onClick={() => setDeleting(r)} title="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
    <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this reservation?</AlertDialogTitle>
          <AlertDialogDescription>This will permanently remove the reservation. This cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}