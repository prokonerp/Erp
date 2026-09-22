import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/skeletons";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { MovementMap } from "@/components/engineer/MovementMap";
import { useEngineerDayRoute } from "@/hooks/useEngineerMovement";
import { useRouteLegs } from "@/hooks/useRouteLegs";
import { istDateKey, formatISTTime } from "@/lib/time";

function formatKm(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return `${(m / 1000).toFixed(1)} km`;
}

/**
 * Per-engineer day route: leg-coloured polyline of pings snapped to roads,
 * with direction arrows and a click-to-select legs panel. Dates are IST days.
 */
export function DayRouteView({ employeeId, name }: { employeeId: string; name: string | null }) {
  const [day, setDay] = useState(() => istDateKey());
  const { data, isLoading, warnings, loadError } = useEngineerDayRoute(employeeId, day);

  const [selectedLeg, setSelectedLeg] = useState<number | null>(null);

  // Tickets with any flagged ping — advisory markers.
  const flaggedTickets = useMemo(() => {
    const set = new Set<string>();
    for (const p of data?.pings ?? []) {
      if (p.ticket_id && p.spoof_flags.length > 0) set.add(p.ticket_id);
    }
    return set;
  }, [data]);

  const rawPings = data?.pings ?? [];

  // Build leg-friendly data structures
  const legPings = useMemo(
    () => rawPings.map((p) => ({ lat: p.lat, long: p.long, captured_at: p.captured_at, ticket_id: p.ticket_id })),
    [rawPings],
  );
  const legSites = useMemo(
    () => (data?.movement?.sites ?? []).map((s) => ({
      ticket_id: s.ticket_id,
      arrived_at: s.arrived_at,
      departed_at: s.departed_at,
      lat: s.lat,
      long: s.long,
    })),
    [data],
  );

  const { legs, loading: legsLoading } = useRouteLegs(legPings, legSites);

  // Legacy route polyline for fit-bounds when no legs
  const legacyRoute = useMemo(
    () => rawPings.map((p) => [p.lat, p.long] as [number, number]),
    [rawPings],
  );

  // Stops (numbered) — kept for map marker rendering
  const stops = useMemo(
    () =>
      (data?.movement?.sites ?? [])
        .filter((s) => s.lat != null && s.long != null)
        .map((s, i) => ({
          n: i + 1,
          lat: s.lat as number,
          long: s.long as number,
          label: s.ticket_id ? `Ticket ${s.ticket_id.slice(0, 8)}` : `Stop ${i + 1}`,
          flagged: !!s.ticket_id && flaggedTickets.has(s.ticket_id),
        })),
    [data, flaggedTickets],
  );

  // Determine if any leg is unmatched
  const hasUnmatched = legs.some((l) => !l.matched);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{name ?? "Engineer"} — day route</h3>
        <label className="sr-only" htmlFor="day-route-date">
          Route date (IST)
        </label>
        <input
          id="day-route-date"
          type="date"
          value={day}
          max={istDateKey()}
          onChange={(e) => e.target.value && setDay(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        />
        {data?.movement ? (
          <>
            <StatusBadge tone="info">{formatKm(data.movement.distance_m)}</StatusBadge>
            <StatusBadge tone="neutral">
              {data.movement.stop_count ?? 0} stop{(data.movement.stop_count ?? 0) === 1 ? "" : "s"}
            </StatusBadge>
          </>
        ) : (
          <StatusBadge tone="neutral">No rollup yet</StatusBadge>
        )}
      </div>

      <AdminWarnings lists={[warnings]} />

      {loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-[13px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          <p className="font-semibold">Day route failed to load</p>
          <p className="mt-0.5 break-words font-mono text-xs">{loadError}</p>
        </div>
      ) : isLoading ? (
        <TableSkeleton rows={4} colCount={2} />
      ) : rawPings.length === 0 ? (
        <EmptyState
          title="No fixes this day"
          hint="Raw fixes appear while the engineer is on duty; the daily summary rolls up overnight."
        />
      ) : (
        <>
          <MovementMap
            pins={[]}
            route={legacyRoute}
            stops={legsLoading ? stops : legs.length > 0 ? undefined : stops}
            height={340}
            emptyHint="No fixes this day"
            legs={legs.length > 0 ? legs : undefined}
            selectedLeg={selectedLeg}
            onLegSelect={setSelectedLeg}
          />

          {hasUnmatched && (
            <p className="text-xs text-muted-foreground">
              some legs are straight-line — road match unavailable
            </p>
          )}

          {legs.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <ol className="space-y-1.5">
                  {legs.map((leg) => {
                    const isSelected = selectedLeg === leg.index;
                    const destFlagged =
                      leg.ticketId != null && flaggedTickets.has(leg.ticketId);
                    return (
                      <li key={leg.index}>
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => setSelectedLeg(isSelected ? null : leg.index)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                            destFlagged ? "border-l-2 border-l-amber-500 pl-0" : ""
                          } hover:bg-muted/60`}
                        >
                          {/* Colour swatch */}
                          <span
                            className="inline-block h-4 w-4 shrink-0 rounded"
                            style={{ backgroundColor: leg.colour }}
                            aria-hidden="true"
                          />
                          {/* Leg index */}
                          <span className="shrink-0 text-xs font-bold tabular-nums">
                            Leg {leg.index}
                          </span>
                          {/* From → To */}
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {leg.fromLabel} → {leg.toLabel}
                          </span>
                          {/* Time range */}
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {formatISTTime(leg.startedAt)}–{formatISTTime(leg.endedAt)}
                          </span>
                          {/* Distance */}
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {formatKm(leg.distanceM)}
                          </span>
                          {/* Flagged indicator */}
                          {destFlagged && (
                            <span className="shrink-0 text-xs font-semibold text-amber-700">
                              flagged
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
