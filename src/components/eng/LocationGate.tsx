import { useState, type ReactNode } from "react";
import { MapPinOff, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocationGate } from "@/hooks/useLocationGate";
import { useDutyTracker } from "@/hooks/useDutyTracker";
import { DUTY_CONSENT_VERSION } from "@/lib/field-location";
import { LocationConsentDialog } from "@/components/eng/LocationConsentDialog";
import { CONSENT_REQUIRED } from "@/lib/field-location.functions";

/**
 * Non-dismissable location gate around the /eng outlet. No close button, no
 * backdrop click — but auth/logout in the shell header stays reachable (the
 * gate wraps only <Outlet/>), so a blocked engineer is never locked out.
 */
export function LocationGate({ children }: { children: ReactNode }) {
  const { gate, headline, hint, retry, retrying } = useLocationGate();
  const { onDuty, start, lastError, queued } = useDutyTracker();
  const [consentOpen, setConsentOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  if (gate === "ok" || gate === "override") return <>{children}</>;

  const startDuty = async () => {
    setStarting(true);
    try {
      await start();
    } catch (e) {
      if ((e as { code?: string } | null)?.code === CONSENT_REQUIRED) {
        setConsentOpen(true);
      }
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="relative" aria-live="polite">
      {/* Content stays mounted underneath but inert while blocked. */}
      <div aria-hidden="true" className="pointer-events-none select-none opacity-40 saturate-50">
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
              </>
            ) : (
              <>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted">
                  <MapPinOff className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                </span>
                <p className="text-base font-semibold text-foreground">{headline}</p>
                {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
                {gate === "off_duty" ? (
                  <>
                    <Button
                      onClick={startDuty}
                      disabled={starting}
                      className="mt-1 min-h-[44px] w-full"
                    >
                      {starting ? "Starting…" : "Start duty"}
                    </Button>
                    <LocationConsentDialog
                      open={consentOpen}
                      onOpenChange={setConsentOpen}
                      version={DUTY_CONSENT_VERSION}
                      onAccepted={() => void startDuty()}
                    />
                  </>
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
