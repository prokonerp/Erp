import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Admin-only serial correction on a posted GRN.
 * Calls the `correct_grn_serial` RPC which fixes the GRN line item and the
 * stock record; the DB trigger / propagate_serial_correction() then ripples
 * the correction to every other table (tickets, indents/Oracle, invoices,
 * challans, gatepasses, defective tags, installed equipment, IMS ledger, and
 * the serials catalog) automatically.
 */
export function CorrectGrnSerialDialog({
  open,
  onOpenChange,
  grnId,
  grnNo,
  currentSerials,
  onCorrected,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grnId: string;
  grnNo?: string | null;
  currentSerials: string[];
  onCorrected?: () => void;
}) {
  const [oldSerial, setOldSerial] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const uniqueSerials = useMemo(
    () => Array.from(new Set(currentSerials.map((s) => (s || "").trim()).filter(Boolean))),
    [currentSerials],
  );

  const reset = () => {
    setOldSerial("");
    setNewSerial("");
    setReason("");
  };

  const submit = async () => {
    const oldS = (oldSerial || "").trim();
    const newS = (newSerial || "").trim();
    if (!oldS) return toast.error("Enter the current (wrong) serial number.");
    if (!newS) return toast.error("Enter the corrected serial number.");
    if (oldS === newS) return toast.error("Old and new serial must be different.");
    if (!reason.trim()) return toast.error("Please enter a reason.");

    setBusy(true);
    const { error } = await supabase.rpc(
      "correct_grn_serial" as never,
      {
        _grn_id: grnId,
        _old_serial: oldS,
        _new_serial: newS,
        _reason: reason.trim(),
      } as never,
    );
    setBusy(false);
    if (error) return toast.error(error.message);

    toast.success("Serial corrected everywhere.");
    reset();
    onOpenChange(false);
    onCorrected?.();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Correct serial on {grnNo ? `GRN ${grnNo}` : "GRN"}</DialogTitle>
          <DialogDescription>
            The correction will be applied automatically across stock, tickets, Oracle/indent,
            invoices, challans, gatepasses, defective tags, installed equipment and the serials
            catalog.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cs-old">Current serial number</Label>
            <Input
              id="cs-old"
              list="cs-exist"
              value={oldSerial}
              onChange={(e) => setOldSerial(e.target.value)}
              placeholder="e.g. the wrong serial captured"
              className="font-mono"
            />
            {uniqueSerials.length > 0 && (
              <datalist id="cs-exist">
                {uniqueSerials.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
            {uniqueSerials.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {uniqueSerials.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setOldSerial(s)}
                    className="rounded border px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground hover:bg-muted"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs-new">Corrected serial number</Label>
            <Input
              id="cs-new"
              value={newSerial}
              onChange={(e) => setNewSerial(e.target.value)}
              placeholder="e.g. the correct serial"
              className="font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cs-reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              id="cs-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. serial captured incorrectly at GRN"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || !oldSerial.trim() || !newSerial.trim() || !reason.trim()}
          >
            {busy ? "Correcting…" : "Correct serial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
