import { useState, type ReactNode } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";

/**
 * Reason-gated confirm dialog. Optionally exposes a scope radio group.
 * `onConfirm` is called with the entered reason (and optional scope) —
 * throw or return `{ error }` to keep the dialog open.
 */
export function ControlledActionDialog({
  open,
  onOpenChange,
  title,
  description,
  warning,
  scopes,
  defaultScope,
  confirmLabel = "Continue",
  confirmClassName,
  reasonPlaceholder = "Enter reason…",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  warning?: ReactNode;
  scopes?: Array<{ value: string; label: string; hint?: string }>;
  defaultScope?: string;
  confirmLabel?: string;
  confirmClassName?: string;
  reasonPlaceholder?: string;
  onConfirm: (args: { reason: string; scope?: string }) => Promise<void | { error?: string } | undefined>;
}) {
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState<string>(defaultScope || scopes?.[0]?.value || "");
  const [busy, setBusy] = useState(false);

  const reset = () => { setReason(""); setScope(defaultScope || scopes?.[0]?.value || ""); };

  const submit = async () => {
    if (!reason.trim()) { toast.error("Please enter a reason."); return; }
    setBusy(true);
    try {
      const res = await onConfirm({ reason: reason.trim(), scope: scopes ? scope : undefined });
      if (res && "error" in res && res.error) { toast.error(res.error); return; }
      onOpenChange(false);
      reset();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {warning && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            {warning}
          </div>
        )}
        {scopes && scopes.length > 0 && (
          <div className="space-y-2">
            <Label>Scope <span className="text-destructive">*</span></Label>
            <RadioGroup value={scope} onValueChange={setScope} className="gap-2">
              {scopes.map((s) => (
                <label key={s.value} className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/40">
                  <RadioGroupItem value={s.value} id={`scope-${s.value}`} className="mt-0.5" />
                  <div className="text-sm">
                    <div className="font-medium">{s.label}</div>
                    {s.hint && <div className="text-xs text-muted-foreground">{s.hint}</div>}
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="ctrl-reason">Reason <span className="text-destructive">*</span></Label>
          <Textarea
            id="ctrl-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            rows={3}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy || !reason.trim() || (scopes ? !scope : false)}
            onClick={(e) => { e.preventDefault(); void submit(); }}
            className={confirmClassName}
          >
            {busy ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}