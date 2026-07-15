import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, ExternalLink, Trash2 } from "lucide-react";
import { listTransfers, deleteTransfer, TRANSFER_STATUS_LABEL, type Transfer } from "@/lib/ims";
import { useIsAdmin } from "@/lib/useRole";

export const Route = createFileRoute("/_app/ims/transfers/")({
  component: TransfersList,
});

function TransfersList() {
  const { isAdmin } = useIsAdmin();
  const [rows, setRows] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<Transfer | null>(null);

  async function load() {
    setLoading(true);
    try { setRows(await listTransfers()); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteTransfer(deleting.id);
      toast.success("Transfer deleted");
      setDeleting(null);
      load();
    } catch (e: any) { toast.error(e?.message || "Delete failed"); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>Stock Transfers</span>
            <Link to="/ims/transfers/new"><Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Transfer</Button></Link>
          </CardTitle>
        </CardHeader>
      </Card>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2">Transfer No</th>
                <th className="p-2">Date</th>
                <th className="p-2">Model / Part</th>
                <th className="p-2">Model / Part Serial No</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={7}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td className="p-4 text-muted-foreground" colSpan={7}>No transfers yet.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 font-mono">{r.transfer_no}</td>
                  <td className="p-2">{new Date(r.request_date).toLocaleDateString()}</td>
                  <td className="p-2">{r.part_name || "—"}</td>
                  <td className="p-2 font-mono">{r.part_serial_no || "—"}</td>
                  <td className="p-2">{r.qty}</td>
                  <td className="p-2"><Badge variant="outline">{TRANSFER_STATUS_LABEL[r.status]}</Badge></td>
                  <td className="p-2 text-right whitespace-nowrap">
                    <Link to="/ims/transfers/$id" params={{ id: r.id }}>
                      <Button variant="ghost" size="icon" title="Open"><ExternalLink className="h-4 w-4" /></Button>
                    </Link>
                    {isAdmin && (
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(r)} title="Delete"><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
            <AlertDialogTitle>Delete this transfer?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove transfer <span className="font-mono">{deleting?.transfer_no}</span>. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}