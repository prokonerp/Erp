import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import {
  getTransfer, updateTransfer, listWarehouses,
  TRANSFER_STATUS_LABEL, type Transfer, type WarehouseLite,
} from "@/lib/ims";
import { usePermissions } from "@/lib/usePermissions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_app/ims/transfers/$id")({
  component: TransferDetail,
});

function TransferDetail() {
  const { id } = useParams({ from: "/_app/ims/transfers/$id" });
  const [t, setT] = useState<Transfer | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [recvRemarks, setRecvRemarks] = useState("");
  const { isAdmin } = usePermissions();

  async function load() {
    setLoading(true);
    try {
      const [tr, w] = await Promise.all([getTransfer(id), listWarehouses()]);
      setT(tr); setWarehouses(w);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="text-muted-foreground">Loading…</div>;
  if (!t) return <div className="text-muted-foreground">Transfer not found.</div>;

  const whName = (wid: string | null) => {
    const w = warehouses.find((x) => x.id === wid);
    return w ? (w.type ? `${w.name} (${w.type})` : w.name) : "—";
  };

  async function action(patch: Partial<Transfer>, msg: string) {
    setBusy(true);
    try {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      const final: Partial<Transfer> = { ...patch };
      if (patch.status === "approved" || patch.status === "in_transit") {
        final.approved_by = uid || null;
        final.approved_at = new Date().toISOString();
      }
      if (patch.status === "received" || patch.status === "completed") {
        final.received_by = uid || null; final.received_at = new Date().toISOString();
      }
      // B-20: conditional on the status the user was looking at — a stale
      // tab or a double-click cannot re-apply an already-applied transition.
      await updateTransfer(t!.id, final, t!.status);
      toast.success(msg);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
      await load(); // refresh to whatever the current truth is
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link to="/ims/transfers"><Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button></Link>
        <Badge variant="outline">{TRANSFER_STATUS_LABEL[t.status]}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base font-mono">{t.transfer_no}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted-foreground">Date: </span>{new Date(t.request_date).toLocaleString()}</div>
          <div><span className="text-muted-foreground">Stock Type: </span>{t.stock_type}</div>
          <div><span className="text-muted-foreground">Source: </span>{whName(t.source_warehouse_id)}</div>
          <div><span className="text-muted-foreground">Destination: </span>{whName(t.destination_warehouse_id)}</div>
          <div><span className="text-muted-foreground">OEM: </span>{t.oem || "—"}</div>
          <div><span className="text-muted-foreground">Model / Part Name: </span>{t.part_name || "—"}</div>
          <div><span className="text-muted-foreground">Model / Part No: </span>{t.part_model_no || "—"}</div>
          <div><span className="text-muted-foreground">Model / Part Serial No: </span><span className="font-mono">{t.part_serial_no || "—"}</span></div>
          <div><span className="text-muted-foreground">Qty: </span>{t.qty}</div>
          <div className="md:col-span-2"><span className="text-muted-foreground">Reason: </span>{t.reason || "—"}</div>
          <div className="md:col-span-2"><span className="text-muted-foreground">Remarks: </span>{t.remarks || "—"}</div>
          {t.approved_at && <div><span className="text-muted-foreground">Approved: </span>{new Date(t.approved_at).toLocaleString()}</div>}
          {t.received_at && <div><span className="text-muted-foreground">Received: </span>{new Date(t.received_at).toLocaleString()}</div>}
          {t.rejected_reason && <div className="md:col-span-2"><span className="text-muted-foreground">Rejected: </span>{t.rejected_reason}</div>}
          {t.cancelled_reason && <div className="md:col-span-2"><span className="text-muted-foreground">Cancelled: </span>{t.cancelled_reason}</div>}
          {t.receipt_remarks && <div className="md:col-span-2"><span className="text-muted-foreground">Receipt notes: </span>{t.receipt_remarks}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Workflow</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {t.status === "draft" && (
            <Button size="sm" disabled={busy} onClick={() => action({ status: "submitted" }, "Submitted")}>Submit</Button>
          )}
          {t.status === "submitted" && isAdmin && (
            <>
              <Button size="sm" disabled={busy}
                onClick={() => action({ status: "in_transit" }, "Approved — stock dispatched (In Transit)")}>
                Approve &amp; Dispatch
              </Button>
              <div className="flex gap-2 items-center">
                <Input placeholder="Reject reason" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="w-60" />
                <Button size="sm" variant="destructive" disabled={busy || !rejectReason}
                  onClick={() => action({ status: "rejected", rejected_reason: rejectReason }, "Rejected")}>
                  Reject
                </Button>
              </div>
            </>
          )}
          {t.status === "approved" && (
            <Button size="sm" disabled={busy} onClick={() => action({ status: "in_transit" }, "Marked in transit — Transfer Out recorded")}>Mark In Transit</Button>
          )}
          {(t.status === "in_transit" || t.status === "approved") && (
            <div className="flex gap-2 items-center">
              <Label className="text-xs">Receipt remarks</Label>
              <Input value={recvRemarks} onChange={(e) => setRecvRemarks(e.target.value)} className="w-60" />
              <Button size="sm" disabled={busy}
                onClick={() => action({ status: "completed", receipt_remarks: recvRemarks || null }, "Receipt confirmed — Transfer In recorded, stock moved")}>
                Confirm Receipt
              </Button>
            </div>
          )}
          {t.status === "in_transit" && isAdmin && (
            <div className="flex gap-2 items-center">
              <Input placeholder="Cancellation reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-60" />
              <Button size="sm" variant="destructive" disabled={busy || !cancelReason}
                onClick={() => action({ status: "cancelled", cancelled_reason: cancelReason }, "Transfer cancelled — stock returned to source warehouse")}>
                Cancel Transfer
              </Button>
            </div>
          )}
          {(t.status === "completed" || t.status === "rejected" || t.status === "cancelled") && (
            <div className="text-sm text-muted-foreground">No further actions.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}