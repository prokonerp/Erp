import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useDutyTracker } from "@/hooks/useDutyTracker";
import { DUTY_CONSENT_VERSION } from "@/lib/field-location";
import { LocationConsentDialog } from "@/components/eng/LocationConsentDialog";
import { CONSENT_REQUIRED } from "@/lib/field-location.functions";

/**
 * Header duty control (low-key by design: an "On duty" pill, no self-map,
 * no trail). Start requires consent — the dialog opens first when needed.
 * Stop uses two-tap confirm (same re-entry-lock spirit as the logout ref).
 */
export function DutyToggle() {
  const { onDuty, consented, loading, queued, start, stop } = useDutyTracker();
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
        toast.error(e instanceof Error ? e.message : "Could not start duty");
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
      toast.error(e instanceof Error ? e.message : "Could not end duty");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <span
        className="h-8 w-20 animate-pulse rounded-full bg-muted"
        aria-label="Loading duty state"
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
            On duty
            {queued > 0 && (
              <span className="tabular-nums text-muted-foreground">· {queued} queued</span>
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void doStop()}
            disabled={busy}
            className="min-h-[44px]"
            title={armStop ? "Tap again to confirm end of duty" : "End duty"}
          >
            {armStop ? "Confirm end?" : "End duty"}
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
            {busy ? "Starting…" : "Start duty"}
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
