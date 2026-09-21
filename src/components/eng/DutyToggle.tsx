import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDutyTracker } from "@/hooks/useDutyTracker";
import { DUTY_CONSENT_VERSION } from "@/lib/field-location";
import { LocationConsentDialog } from "@/components/eng/LocationConsentDialog";
import { CONSENT_REQUIRED } from "@/lib/field-location.functions";

/**
 * Header attendance control. This is the engineer's ONLY duty affordance and it
 * is deliberately framed as attendance, not as a tracking switch.
 *
 * COPY RULE (product decision 2026-09-21): an engineer must never be shown the
 * words "duty", "tracking" or "monitoring" — they are marking attendance for
 * the day. LOGIC IS UNCHANGED: `start()` still opens the duty session and
 * writes the attendance row, `stop()` still closes it, the kill switch and
 * consent gate still behave exactly as before. Only the labels changed.
 *
 * Start requires the one-time consent — the dialog opens first when needed.
 * Stop uses two-tap confirm (same re-entry-lock spirit as the logout ref).
 */
export function DutyToggle() {
  const { onDuty, consented, loading, start, stop, trackingEnabled } = useDutyTracker();
  const [consentOpen, setConsentOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [armStop, setArmStop] = useState(false);

  useEffect(() => {
    if (!armStop) return;
    const id = window.setTimeout(() => setArmStop(false), 3000);
    return () => window.clearTimeout(id);
  }, [armStop]);

  const doStart = async () => {
    setBusy(true);
    try {
      await start();
    } catch (e) {
      if ((e as { code?: string } | null)?.code === CONSENT_REQUIRED) {
        setConsentOpen(true);
      } else {
        toast.error(e instanceof Error ? e.message : "Could not mark attendance");
      }
    } finally {
      setBusy(false);
    }
  };

  const doStop = async () => {
    if (!armStop) {
      setArmStop(true);
      return;
    }
    setArmStop(false);
    setBusy(true);
    try {
      await stop();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not end your day");
    } finally {
      setBusy(false);
    }
  };

  // No attendance concept when the admin kill switch is off — render nothing so
  // the control never surfaces an affordance the server would refuse.
  if (!trackingEnabled) return null;

  if (loading) {
    return (
      <span
        className="h-8 w-20 animate-pulse rounded-full bg-muted"
        aria-label="Loading attendance state"
      />
    );
  }

  return (
    <span className="flex items-center gap-2">
      {onDuty ? (
        <>
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-2.5 py-1 text-xs font-semibold text-green-700 dark:text-green-400"
            role="status"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
            Present
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void doStop()}
            disabled={busy}
            className="min-h-[44px]"
            title={armStop ? "Tap again to confirm" : "End day"}
          >
            {armStop ? "Confirm?" : "End day"}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!consented) setConsentOpen(true);
              else void doStart();
            }}
            disabled={busy}
            className="min-h-[44px]"
          >
            {busy ? "Marking…" : "Mark attendance"}
          </Button>
          <LocationConsentDialog
            open={consentOpen}
            onOpenChange={setConsentOpen}
            version={DUTY_CONSENT_VERSION}
            onAccepted={() => void doStart()}
          />
        </>
      )}
    </span>
  );
}
