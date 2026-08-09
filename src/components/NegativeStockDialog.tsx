import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle } from "lucide-react";
import type { Shortfall } from "@/lib/negativeStock";

/**
 * Admin-only warn-and-confirm for posting a document that takes stock negative.
 * Never proceeds on a default/implicit action — Proceed must be clicked.
 */
export function NegativeStockDialog({
  open,
  onOpenChange,
  shortfalls,
  onProceed,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shortfalls: Shortfall[];
  onProceed: (reason: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!busy) { onOpenChange(o); if (!o) setReason(""); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Stock shortfall — override required
          </AlertDialogTitle>
          <AlertDialogDescription>
            Proceeding will take available stock negative. This action is logged against your account.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          {shortfalls.map((s, i) => (
            <div key={i} className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              Only <span className="font-semibold">{s.available}</span> unit(s) of{" "}
              <span className="font-semibold">{s.label || s.model}</span> available
              {s.warehouseName ? <> at <span className="font-semibold">{s.warehouseName}</span></> : <> across all warehouses</>}.
              Proceeding will take stock to{" "}
              <span className="font-semibold text-destructive">-{s.shortfall}</span>.
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="neg-reason">Reason (optional)</Label>
          <Textarea id="neg-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being overridden?" />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={async (e) => {
              e.preventDefault();
              setBusy(true);
              try { await onProceed(reason.trim()); } finally { setBusy(false); }
            }}
          >
            {busy ? "Posting…" : "Proceed"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
