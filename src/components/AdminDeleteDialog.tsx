import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  kind: "challan" | "grn";
  id: string;
  label: string; // e.g., "Delivery Challan DC-CUST/2025/0001"
  onDeleted: () => void;
};

export function AdminDeleteDialog({ kind, id, label, onDeleted }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!reason.trim()) {
      toast.error("Please enter a reason for deletion.");
      return;
    }
    setBusy(true);
    const fn = kind === "challan" ? "admin_delete_challan" : "admin_delete_grn";
    const { error } = await supabase.rpc(fn as never, { _id: id, _reason: reason.trim() } as never);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${label} deleted. Inventory reversed.`);
    setOpen(false);
    onDeleted();
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReason(""); }}>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5 text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />Delete
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the document and reverses all related IMS
            stock ledger entries, reservations and transactions. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="del-reason">Reason for deletion <span className="text-destructive">*</span></Label>
          <Textarea
            id="del-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Created in error, duplicate entry, wrong customer…"
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !reason.trim()}
            onClick={(e) => { e.preventDefault(); void submit(); }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {busy ? "Deleting…" : "Permanently delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}