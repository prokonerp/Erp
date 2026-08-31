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

type GrnSlot = "exchange" | "received" | "customer_received" | "defective";

const SLOT_META: Record<GrnSlot, { code: string; label: string; shortLabel: string }> = {
  exchange: { code: "B", label: "Exchange (sent)", shortLabel: "B (Exchange)" },
  received: { code: "C", label: "Received from OEM", shortLabel: "C (Received from OEM)" },
  customer_received: { code: "D", label: "Received from Customer", shortLabel: "D (Received from Customer)" },
  defective: { code: "A", label: "Defective", shortLabel: "A (Defective)" },
};

export type CorrectGrnSerialDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  grnId: string;
  grnNo?: string | null;
  currentSerials: string[];
  onCorrected?: () => void;
  /** Oracle number this GRN line belongs to — enables slot-scoped correction (document scope). */
  oracle_no?: string | null;
  /** Slot being corrected: B=exchange, C=received, D=customer_received, A=defective */
  slot?: GrnSlot | null;
  /** Indent lifecycle status — when 'closed' the dialog becomes read-only. */
  indentStatus?: string | null;
  /** Optional extra context shown in the scoped banner (e.g. "document" / DC number). */
  scopeLabel?: string;
};

/**
 * Admin-only serial correction on a posted GRN — slot-scoped (document) mode.
 * Fixes the GRN line item and, when oracle_no is provided, the linked oracle
 * slot via correct_grn_serial(_oracle_no, _scope='document'). DB derives the
 * concrete slot (received vs customer_received) from grn.category; the UI hint
 * is informational only.
 * For catalog-wide renames use Serials Manager (global scope).
 */
export function CorrectGrnSerialDialog({
  open,
  onOpenChange,
  grnId,
  grnNo,
  currentSerials,
  onCorrected,
  oracle_no,
  slot,
  indentStatus,
  scopeLabel,
}: CorrectGrnSerialDialogProps) {
  const [oldSerial, setOldSerial] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const uniqueSerials = useMemo(
    () => Array.from(new Set(currentSerials.map((s) => (s || "").trim()).filter(Boolean))),
    [currentSerials],
  );

  const slotMeta = slot ? SLOT_META[slot as GrnSlot] : null;
  const isClosed = (indentStatus || "").trim().toLowerCase() === "closed";

  const title = useMemo(() => {
    if (oracle_no && slotMeta) return `Correct ${slotMeta.shortLabel} for Oracle ${oracle_no}`;
    if (oracle_no) return `Correct serial for Oracle ${oracle_no}`;
    return grnNo ? `Correct serial on GRN ${grnNo}` : "Correct serial on GRN";
  }, [oracle_no, slotMeta, grnNo]);

  const reset = () => {
    setOldSerial("");
    setNewSerial("");
    setReason("");
  };

  const submit = async () => {
    if (isClosed) {
      toast.error("Indent is Closed — all sections complete. Reopen Oracle to correct serial.");
      return;
    }
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
        _oracle_no: oracle_no || null,
        _scope: "document",
      } as never,
    );
    setBusy(false);
    if (error) return toast.error(error.message);

    toast.success("Serial corrected on GRN & linked oracle slot (scoped).");
    reset();
    onOpenChange(false);
    onCorrected?.();
  };

  const oldTrim = oldSerial.trim();
  const newTrim = newSerial.trim();
  const showPreview = Boolean(oldTrim && newTrim && oldTrim !== newTrim);

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
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            This correction is slot-scoped (document). It will change only the selected oracle slot and
            this GRN document, not other oracles or DCs. For catalog-wide renames use Serials Manager.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Closed guard */}
          {isClosed && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
              Indent is Closed — all sections complete. Reopen Oracle to correct serial.
            </div>
          )}

          {/* Scoped warning — only when we have oracle context and indent is not closed */}
          {!isClosed && oracle_no && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
              <span className="font-semibold">Scoped change:</span> This will only change{" "}
              <span className="font-mono font-semibold">{slotMeta ? slotMeta.shortLabel : "this slot"}</span>{" "}
              for <span className="font-mono font-semibold">{oracle_no}</span>. Other slots/oracles not
              touched.
              {scopeLabel ? (
                <>
                  {" "}
                  <span className="text-amber-700">{scopeLabel}</span>
                </>
              ) : (
                <> DC-CUST / other GRNs not touched.</>
              )}
            </div>
          )}

          {/* Preview diff */}
          {showPreview && (
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Preview</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-sm">
                <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 line-through decoration-red-400">
                  {oldTrim}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">{newTrim}</span>
              </div>
              {slotMeta && oracle_no && (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Will update GRN <span className="font-mono">{grnNo || grnId.slice(0, 8)}</span> + Oracle{" "}
                  {oracle_no} {slotMeta.shortLabel}
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="cs-old">Current serial number</Label>
            <Input
              id="cs-old"
              list="cs-exist"
              value={oldSerial}
              onChange={(e) => setOldSerial(e.target.value)}
              placeholder="e.g. the wrong serial captured"
              className="font-mono"
              disabled={isClosed}
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
                    onClick={() => !isClosed && setOldSerial(s)}
                    disabled={isClosed}
                    className="rounded border px-1.5 py-0.5 text-[11px] font-mono text-muted-foreground hover:bg-muted disabled:opacity-50"
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
              disabled={isClosed}
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
              disabled={isClosed}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy || isClosed || !oldSerial.trim() || !newSerial.trim() || !reason.trim()}
            title={isClosed ? "Indent is Closed — reopen Oracle to correct serial" : undefined}
          >
            {busy ? "Correcting…" : "Correct serial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
