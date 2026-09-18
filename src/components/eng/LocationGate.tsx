import { useEffect, useState, type ReactNode } from "react";
import { MapPinOff, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocationGate } from "@/hooks/useLocationGate";
import { useDutyTracker } from "@/hooks/useDutyTracker";
import { DUTY_CONSENT_VERSION } from "@/lib/field-location";
import { LOCATION_DENIED_EVENT } from "@/lib/location-denial";
import { LocationConsentDialog } from "@/components/eng/LocationConsentDialog";
import { CONSENT_REQUIRED } from "@/lib/field-location.functions";

/**
 * Location gate around the /eng outlet.
 *
 * Off duty the portal is READ-ONLY browsable (decision: tracking must stay
 * voluntary) — a slim banner offers Start duty, nothing is overlaid. The
 * blocking overlay is reserved for on-duty-but-broken location, plus writes
 * that just 403'd (raised centrally via LOCATION_DENIED_EVENT from the
 * gated write call sites). Auth/logout in the shell header stays reachable
 * in every state, so a blocked engineer is never locked out.
 */
export function LocationGate({ children }: { children: ReactNode }) {
  const { gate, headline, hint, retry, retrying } = useLocationGate();
  const { onDuty, start, lastError, queued, trackingEnabled } = useDutyTracker();
  const [consentOpen, setConsentOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [writeBlocked, setWriteBlocked] = useState(false);

  useEffect(() => {
    const onDenied = () => setWriteBlocked(true);
    window.addEventListener(LOCATION_DENIED_EVENT, onDenied);
    return () => window.removeEventListener(LOCATION_DENIED_EVENT, onDenied);
  }, []);

  // A fresh fix (or override) clears a write-triggered prompt.
  useEffect(() => {
    if (gate === "ok" || gate === "override") setWriteBlocked(false);
  }, [gate]);

  const startDuty = async () => {
    setStarting(true);
    setStartError(null);
    try {
      await start();
      setWriteBlocked(false);
    } catch (e) {
      if ((e as { code?: string } | null)?.code === CONSENT_REQUIRED) {
        setConsentOpen(true);
      } else {
        // Never swallow: an unlinked login or server error must say so.
        setStartError(e instanceof Error ? e.message : "Could not start duty");
      }
    } finally {
      setStarting(false);
    }
  };

  const consentDialog = (
    <LocationConsentDialog
      open={consentOpen}
      onOpenChange={setConsentOpen}
      version={DUTY_CONSENT_VERSION}
      onAccepted={() => void startDuty()}
    />
  );

  const startButton = (
    <Button onClick={startDuty} disabled={starting} className="mt-1 min-h-[44px] w-full">
      {starting ? "Starting…" : "Start duty"}
    </Button>
  );

  const hardBlocked = gate !== "ok" && gate !== "override" && gate !== "off_duty";

  if (!hardBlocked && !writeBlocked) {
    return (
      <div aria-live="polite">
        {!trackingEnabled && (
          <div
            role="status"
            className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
          >
            <MapPinOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="flex-1 text-xs text-muted-foreground">
              Location tracking is disabled by your admin — duty and reports work normally.
            </p>
          </div>
        )}
        {gate === "off_duty" && (
          <div
            role="status"
            className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
          >
            <MapPinOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="flex-1 text-xs text-muted-foreground">
              You&apos;re off duty — browsing only. Start duty to record visits and reports;
              location is tracked only while on duty.
            </p>
            <Button size="sm" onClick={startDuty} disabled={starting} className="min-h-[36px]">
              {starting ? "Starting…" : "Start duty"}
            </Button>
          </div>
        )}
        {children}
        {consentDialog}
        {startError && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {startError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div aria-live="polite">
      {/* inert (not just aria-hidden): keyboard focus must not enter gated content. */}
      <div inert className="pointer-events-none select-none opacity-40 saturate-50">
        {children}
      </div>
      <div className="fixed inset-0 z-40 grid place-items-center bg-background/80 p-4 backdrop-blur-sm">
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            {gate === "checking" ? (
              <>
                <RotateCw
                  className="h-8 w-8 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-sm font-semibold text-foreground">{headline}</p>
                <p className="text-sm text-muted-foreground">
                  Your browser hasn&apos;t answered the location prompt yet.
                </p>
                <Button
                  onClick={() => void retry()}
                  disabled={retrying}
                  className="mt-1 min-h-[44px] w-full"
                >
                  {retrying ? (
                    <>
                      <RotateCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      Retrying…
                    </>
                  ) : (
                    "Enable location"
                  )}
                </Button>
              </>
            ) : (
              <>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted">
                  <MapPinOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                </span>
                <p className="text-base font-semibold text-foreground">{headline}</p>
                {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
                {writeBlocked && (
                  <p className="text-sm text-muted-foreground">
                    That action couldn&apos;t be saved — fix location, then try it again.
                  </p>
                )}
                {gate === "off_duty" ? (
                  startButton
                ) : (
                  <Button
                    onClick={() => void retry()}
                    disabled={retrying}
                    className="mt-1 min-h-[44px] w-full"
                  >
                    {retrying ? (
                      <>
                        <RotateCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                        Retrying…
                      </>
                    ) : (
                      "Try again"
                    )}
                  </Button>
                )}
                {consentDialog}
                {startError && (
                  <p role="alert" className="text-xs text-red-600">
                    {startError}
                  </p>
                )}
                {lastError && gate !== "off_duty" && (
                  <p className="text-xs text-muted-foreground">{lastError}</p>
                )}
                {onDuty && queued > 0 && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {queued} fix{queued === 1 ? "" : "es"} queued — will sync on reconnect.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
