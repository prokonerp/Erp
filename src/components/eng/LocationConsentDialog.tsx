import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { recordLocationConsent } from "@/lib/field-location.functions";

/**
 * First-use consent (DPDP 2023), written once to the immutable
 * engineer_consent_events log. Attendance marking stays blocked until the
 * engineer accepts.
 *
 * COPY RULE (product decision 2026-09-21): the engineer is marking attendance.
 * They must never be shown surveillance framing — no "tracking", no
 * "monitoring", no "your position is visible to admins". State plainly what is
 * stored and when it stops, and nothing more.
 *
 * The underlying consent RECORD is unchanged: `recordLocationConsent` still
 * writes the same version to `engineer_consent_events`, so this is a copy
 * change only, not a change to what is logged or to what is collected.
 */
export function LocationConsentDialog({
  open,
  onOpenChange,
  version,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  version: string;
  onAccepted: () => void;
}) {
  const recordFn = useServerFn(recordLocationConsent);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      await recordFn({
        data: {
          version,
          user_agent:
            typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : undefined,
        },
      });
      onOpenChange(false);
      onAccepted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save consent");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark your attendance</DialogTitle>
          <DialogDescription>
            One-time setup. Your attendance is then marked for each working day.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            Location is used to confirm you are <strong className="text-foreground">on site</strong>{" "}
            for your visits.
          </li>
          <li>It is active only while you are marked present.</li>
          <li>You can end your day at any time, which stops it straight away.</li>
          <li>Records older than 30 days are removed.</li>
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={() => void accept()} disabled={busy} className="min-h-[44px]">
            {busy ? "Saving…" : "Agree and mark attendance"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
