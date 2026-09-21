import { useEffect, useState, type ReactNode } from "react";
import { MapPinOff, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLocationGate } from "@/hooks/useLocationGate";
import { useDutyTracker } from "@/hooks/useDutyTracker";
import { DUTY_CONSENT_VERSION, canBrowseWithoutLocation } from "@/lib/field-location";
import { LOCATION_DENIED_EVENT } from "@/lib/location-denial";
import { LocationConsentDialog } from "@/components/eng/LocationConsentDialog";
import { CONSENT_REQUIRED } from "@/lib/field-location.functions";

/**
 * Location gate around the /eng outlet.
 *
 * The login-time permission ask (product decision) gates the portal BEFORE
 * duty starts, but a gate the engineer cannot leave is a lockout, not a
 * prompt: a denied/unsupported device, a rejected Permissions API query and a
 * gesture-less prompt the browser suppressed all end in the same overlay, and
 * only a manager override or a manual page reload used to clear it. So the
 * blocked screen carries an explicit escape for the OFF-DUTY case
 * ("Browse without location"): the engineer keeps the read-only portal, and
 * the gate still blocks the moment they mark attendance or a gated write 403s.
 *
 * Off duty with location working (or escaped from) the portal is READ-ONLY
 * browsable — a slim banner offers to mark attendance, nothing is overlaid. The
 * blocking overlay is reserved for on-duty-but-broken location, plus writes
 * that just 403'd (raised centrally via LOCATION_DENIED_EVENT from the gated
 * write call sites). Auth/logout in the shell header stays reachable in every
 * state, so a blocked engineer is never locked out.
 */
export function LocationGate({ children }: { children: ReactNode }) {
  const { gate, headline, hint, retry, retrying } = useLocationGate();
  const { start, lastError, trackingEnabled, permission } = useDutyTracker();
  const [consentOpen, setConsentOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [writeBlocked, setWriteBlocked] = useState(false);
  // Escape hatch: the engineer chose to browse read-only rather than grant
  // location now. Cleared the moment location resolves or duty starts, so the
  // gate always re-arms for the states that genuinely must block.
  const [browseAnyway, setBrowseAnyway] = useState(false);

  useEffect(() => {
    const onDenied = () => setWriteBlocked(true);
    window.addEventListener(LOCATION_DENIED_EVENT, onDenied);
    return () => window.removeEventListener(LOCATION_DENIED_EVENT, onDenied);
  }, []);

  // A fresh fix (or override) clears a write-triggered prompt. A disabled
  // kill switch also clears it — the server accepts writes, so a stale
  // denial must not pin the overlay (covers the disable-after-denial race).
  useEffect(() => {
    if (gate === "ok" || gate === "override" || trackingEnabled === false) {
      setWriteBlocked(false);
    }
  }, [gate, trackingEnabled]);

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
        setStartError(e instanceof Error ? e.message : "Could not mark attendance");
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

  const hardBlocked = gate !== "ok" && gate !== "override" && gate !== "off_duty";

  // Escape is offered for every blocked state — including ON duty. An earlier
  // revision hid it on duty on the theory that "nothing is safe to browse";
  // the field reality is the opposite. Observed end to end (2026-09-21): an
  // engineer left on duty with permission denied/unsupported gets the overlay,
  // and the overlay covers the bottom nav AND the header, so the end-day
  // control cannot be tapped either. That engineer is imprisoned on a dead
  // screen with no self-service exit, so the escape must be reachable in both
  // states. Safety is unchanged: it only reveals the read-only portal — every
  // location-gated write still 403s server-side (LOCATION_REQUIRED) until a
  // real fix lands.
  // The rule lives in canBrowseWithoutLocation() so it is unit-tested.
  const canEscapeToBrowse = canBrowseWithoutLocation(gate);

  const handleBrowseAnyway = () => {
    setBrowseAnyway(true);
    setStartError(null);
  };

  // Rendered in BOTH overlay branches. The blocked state is not always
  // "denied": an unanswered login ask leaves the gate on "checking", and the
  // browser may never answer a gesture-less prompt — that path is exactly
  // where the "Enable location" button cannot help, so the escape must be
  // reachable there too.
  const escapeButton = canEscapeToBrowse ? (
    <Button variant="outline" onClick={handleBrowseAnyway} className="min-h-[44px] w-full">
      Browse without location
    </Button>
  ) : null;

  // Re-arm the gate the moment location resolves or tracking is disabled.
  useEffect(() => {
    if (browseAnyway && !hardBlocked) setBrowseAnyway(false);
  }, [browseAnyway, hardBlocked]);

  if (!writeBlocked && (!hardBlocked || browseAnyway)) {
    return (
      <div aria-live="polite">
        {trackingEnabled && (gate === "off_duty" || browseAnyway) && (
          <div
            role="status"
            className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2"
          >
            <MapPinOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="flex-1 text-xs text-muted-foreground">
              {browseAnyway
                ? "Location is off — browsing read-only. Turn it on (or mark attendance) before you record a visit."
                : "Your attendance isn't marked yet. You can browse your calls; mark attendance to record visits and reports."}
            </p>
            {browseAnyway && permission !== "granted" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void retry()}
                disabled={retrying}
                className="min-h-[36px]"
              >
                {retrying ? "Retrying…" : "Enable location"}
              </Button>
            )}
            <Button size="sm" onClick={startDuty} disabled={starting} className="min-h-[36px]">
              {starting ? "Marking…" : "Mark attendance"}
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
                  {hint ?? "Your browser hasn't answered the location prompt yet."}
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
                {escapeButton}
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
                {escapeButton}
                {consentDialog}
                {startError && (
                  <p role="alert" className="text-xs text-red-600">
                    {startError}
                  </p>
                )}
                {lastError && gate !== "off_duty" && (
                  <p className="text-xs text-muted-foreground">{lastError}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
