import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  caseId?: string | null;
  /** Perform the actual close. Return true on success; false keeps the dialog open and remarks intact. */
  onConfirm: (remarks: string) => Promise<boolean>;
};

export function ClosingRemarksDialog({ open, onOpenChange, caseId, onConfirm }: Props) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setRemarks("");
      setBusy(false);
    }
  }, [open]);

  const submit = async () => {
    const trimmed = remarks.trim();
    if (!trimmed) return;
    setBusy(true);
    const ok = await onConfirm(trimmed);
    setBusy(false);
    if (ok) onOpenChange(false);
    // On failure keep dialog open so remarks are not lost.
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Closing Remarks{caseId ? ` — ${caseId}` : ""}</DialogTitle>
          <DialogDescription>
            Remarks are required to close this ticket. They will be added to the ticket's Notes with your name and timestamp.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="closing-remarks">Remarks *</Label>
          <Textarea
            id="closing-remarks"
            rows={5}
            autoFocus
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Describe resolution, root cause, action taken…"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !remarks.trim()}>
            {busy ? "Closing…" : "Save & Close Ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}