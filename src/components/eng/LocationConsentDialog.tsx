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
 * First-use BYOD consent (DPDP 2023). Plain language, no dark patterns:
 * what is collected, when, how long it is kept. Written once to the
 * immutable engineer_consent_events log; duty stays blocked until accepted.
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
          <DialogTitle>Location consent</DialogTitle>
          <DialogDescription>
            This phone is yours. Here is exactly what duty tracking does — duty stays off until you
            accept.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            GPS is recorded <strong className="text-foreground">only while you are on duty</strong>.
          </li>
          <li>Going off duty stops tracking immediately.</li>
          <li>Raw locations are deleted after 30 days; only a daily summary is kept.</li>
          <li>Your live position is visible to admins while on duty — never off duty.</li>
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Not now
          </Button>
          <Button onClick={() => void accept()} disabled={busy} className="min-h-[44px]">
            {busy ? "Saving…" : "I consent — start duty"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
