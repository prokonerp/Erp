import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, LogOut, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatISTTime } from "@/lib/time";
import { reportDbError } from "@/lib/format-error";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type VisitRow = {
  arrival_at: string | null;
  departure_at: string | null;
};

const OFFLINE_REASON = "No internet connection. Reconnect and retry — visit time was not recorded.";

function formatClock(iso: string | null): string {
  return formatISTTime(iso);
}

function formatElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m on site`;
  return `${h}h ${m}m on site`;
}

/**
 * VisitTimesBar — engineer arrival / departure capture for a ticket.
 *
 * Append-only visits pattern: the visit row in `ticket_visits` (one row per
 * ticket, UNIQUE ticket_id) is upserted, while every arrival / departure is
 * also appended to `ticket_activities` (insert-only, never updated).
 */
export function VisitTimesBar({
  ticketId,
  onVisitRecorded,
}: {
  ticketId: string;
  onVisitRecorded?: () => void;
}) {
  const [visit, setVisit] = useState<VisitRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [arriveBusy, setArriveBusy] = useState(false);
  const [departBusy, setDepartBusy] = useState(false);
  // Ref-based re-entry locks: busy state commits on re-render, so two taps in
  // the same tick would both fire (duplicate arrival/departure activities).
  // Refs flip synchronously — the second call bails.
  const arriveRef = useRef(false);
  const departRef = useRef(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table pending generated types (migration 20260917000003)
      const { data } = await (supabase as any)
        .from("ticket_visits")
        .select("arrival_at,departure_at")
        .eq("ticket_id", ticketId)
        .maybeSingle();
      if (!active) return;
      const row = data as unknown as VisitRow | null;
      setVisit(row ? { arrival_at: row.arrival_at, departure_at: row.departure_at } : null);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [ticketId]);

  // Live elapsed ticker — only while on site (arrived, not yet departed).
  const onSite = !!visit?.arrival_at && !visit?.departure_at;
  useEffect(() => {
    if (!onSite) return;
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, [onSite]);

  const handleArrive = async () => {
    if (!navigator.onLine) {
      toast.error(OFFLINE_REASON);
      return;
    }
    if (arriveRef.current) return;
    arriveRef.current = true;
    setArriveBusy(true);
    try {
      const at = new Date().toISOString();
      // Conditional on arrival_at IS NULL (mirrors the depart pattern below):
      // a second "Arrive" from another device must NOT overwrite the first
      // arrival time. 0 rows = already arrived elsewhere, or no visit row yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table pending generated types (migration 20260917000003)
      const { data: arriveRows, error } = await (supabase as any)
        .from("ticket_visits")
        .update({ arrival_at: at } as never)
        .eq("ticket_id", ticketId)
        .is("arrival_at", null)
        .select("ticket_id");
      if (error) {
        toast.error(reportDbError("visit arrive", error));
        return;
      }
      let effectiveArrival: string;
      if (arriveRows && arriveRows.length > 0) {
        effectiveArrival = at;
        setVisit((v) => ({ arrival_at: at, departure_at: v?.departure_at ?? null }));
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table pending generated types (migration 20260917000003)
        const { data: fresh } = await (supabase as any)
          .from("ticket_visits")
          .select("arrival_at,departure_at")
          .eq("ticket_id", ticketId)
          .maybeSingle();
        const row = fresh as unknown as VisitRow | null;
        if (row?.arrival_at) {
          // Lost the race: another device arrived first. Show canonical time.
          setVisit({ arrival_at: row.arrival_at, departure_at: row.departure_at });
          toast.info("Arrival already recorded — showing the existing time");
          return;
        }
        // No visit row yet: create it. A concurrent arrive wins via the
        // ticket_id unique constraint (23505) — then fall through to re-read.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table pending generated types (migration 20260917000003)
        const { error: insErr } = await (supabase as any)
          .from("ticket_visits")
          .insert({ ticket_id: ticketId, arrival_at: at } as never);
        if (insErr && (insErr as { code?: string }).code !== "23505") {
          toast.error(reportDbError("visit arrive", insErr));
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table pending generated types (migration 20260917000003)
        const { data: fresh2 } = await (supabase as any)
          .from("ticket_visits")
          .select("arrival_at,departure_at")
          .eq("ticket_id", ticketId)
          .maybeSingle();
        const row2 = fresh2 as unknown as VisitRow | null;
        effectiveArrival = row2?.arrival_at ?? at;
        setVisit({ arrival_at: effectiveArrival, departure_at: row2?.departure_at ?? null });
      }
      try {
        const { data: u } = await supabase.auth.getUser();
        await supabase.from("ticket_activities").insert({
          ticket_id: ticketId,
          kind: "arrival",
          notes: `Arrived at site at ${effectiveArrival}`,
          actor: u.user?.id ?? null,
        } as never);
      } catch (actErr) {
        console.warn("Activity insert failed:", actErr);
      }
      toast.success("Arrival recorded");
      onVisitRecorded?.();
    } finally {
      arriveRef.current = false;
      setArriveBusy(false);
    }
  };

  const handleDepart = async () => {
    if (!visit?.arrival_at) return;
    if (!navigator.onLine) {
      toast.error(OFFLINE_REASON);
      return;
    }
    if (departRef.current) return;
    departRef.current = true;
    setDepartBusy(true);
    try {
      const at = new Date().toISOString();
      // Conditional on departure_at IS NULL with a row-count check: the FSR
      // auto-depart (or another device) may have departed already, and an
      // admin reset may have removed the row. A 0-row match must NOT insert
      // a departure activity — there is no visit to depart.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table pending generated types (migration 20260917000003)
      const { data: departRows, error } = await (supabase as any)
        .from("ticket_visits")
        .update({ departure_at: at } as never)
        .eq("ticket_id", ticketId)
        .is("departure_at", null)
        .select("ticket_id");
      if (error) {
        toast.error(reportDbError("visit depart", error));
        return;
      }
      if (!departRows || departRows.length === 0) {
        // Already departed elsewhere, or the visit row is gone (reset).
        // Re-read so the bar shows the true state instead of a stale one.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- new table pending generated types (migration 20260917000003)
        const { data: fresh } = await (supabase as any)
          .from("ticket_visits")
          .select("arrival_at,departure_at")
          .eq("ticket_id", ticketId)
          .maybeSingle();
        const row = fresh as unknown as VisitRow | null;
        setVisit(row ? { arrival_at: row.arrival_at, departure_at: row.departure_at } : null);
        toast.info("Visit state refreshed — already departed or reset by admin");
        return;
      }
      try {
        const { data: u } = await supabase.auth.getUser();
        await supabase.from("ticket_activities").insert({
          ticket_id: ticketId,
          kind: "departure",
          notes: `Departed site at ${at}`,
          actor: u.user?.id ?? null,
        } as never);
      } catch (actErr) {
        console.warn("Activity insert failed:", actErr);
      }
      setVisit((v) => ({ arrival_at: v?.arrival_at ?? null, departure_at: at }));
      toast.success("Departure recorded");
      onVisitRecorded?.();
    } finally {
      departRef.current = false;
      setDepartBusy(false);
    }
  };

  const offline = !isOnline;

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">Site visit</h3>

        {loading ? (
          <div className="flex min-h-[44px] items-center gap-2" aria-busy="true">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">Loading visit…</p>
          </div>
        ) : !visit?.arrival_at ? (
          <>
            <Button
              className="min-h-[44px] w-full"
              disabled={arriveBusy || offline}
              onClick={handleArrive}
            >
              {arriveBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <MapPin className="h-4 w-4" aria-hidden />
              )}
              Arrived at site
            </Button>
            {offline && (
              <p role="status" className="text-xs text-muted-foreground">
                {OFFLINE_REASON}
              </p>
            )}
          </>
        ) : !visit?.departure_at ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm">
                Arrived <span className="font-semibold">{formatClock(visit.arrival_at)}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {formatElapsed(now - new Date(visit.arrival_at).getTime())}
                </span>
              </p>
            </div>
            <Button
              variant="outline"
              className="min-h-[44px] w-full"
              disabled={departBusy || offline}
              onClick={handleDepart}
            >
              {departBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <LogOut className="h-4 w-4" aria-hidden />
              )}
              Mark departed
            </Button>
            {offline && (
              <p role="status" className="text-xs text-muted-foreground">
                {OFFLINE_REASON}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm">
            On site {formatClock(visit.arrival_at)} – {formatClock(visit.departure_at)}
            <span className="text-muted-foreground">
              {" "}
              ·{" "}
              {formatElapsed(
                new Date(visit.departure_at!).getTime() - new Date(visit.arrival_at).getTime(),
              )}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
