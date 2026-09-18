import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/skeletons";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { MovementMap } from "@/components/engineer/MovementMap";
import { useEngineerDayRoute } from "@/hooks/useEngineerMovement";
import { istDateKey, formatISTTime } from "@/lib/time";

function formatKm(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return "—";
  return `${(m / 1000).toFixed(1)} km`;
}

/**
 * Per-engineer day route: polyline of raw pings + numbered stops from the
 * rollup's site list, with distance/stop stats. Dates are IST days.
 */
export function DayRouteView({ employeeId, name }: { employeeId: string; name: string | null }) {
  const [day, setDay] = useState(() => istDateKey());
  const { data, isLoading, warnings, loadError } = useEngineerDayRoute(employeeId, day);

  const route = useMemo(
    () => (data?.pings ?? []).map((p) => [p.lat, p.long] as [number, number]),
    [data],
  );
  // Tickets with any flagged ping (impossible fix data) — advisory markers.
  const flaggedTickets = useMemo(() => {
    const set = new Set<string>();
    for (const p of data?.pings ?? []) {
      if (p.ticket_id && p.spoof_flags.length > 0) set.add(p.ticket_id);
    }
    return set;
  }, [data]);
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
      ) : route.length === 0 ? (
        <EmptyState
          title="No fixes this day"
          hint="Raw fixes appear while the engineer is on duty; the daily summary rolls up overnight."
        />
      ) : (
        <>
          <MovementMap
            pins={[]}
            route={route}
            stops={stops}
            height={340}
            emptyHint="No fixes this day"
          />
          {stops.length > 0 && (
            <Card>
              <CardContent className="p-3">
                <ol className="space-y-1.5">
                  {(data?.movement?.sites ?? []).map((s, i) => {
                    const flagged = !!s.ticket_id && flaggedTickets.has(s.ticket_id);
                    return (
                      <li key={`${s.ticket_id ?? "na"}-${i}`} className="flex gap-2 text-[13px]">
                        <span
                          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                            flagged
                              ? "bg-amber-100 text-amber-800 ring-2 ring-amber-600"
                              : "bg-primary text-primary-foreground"
                          }`}
                          aria-hidden="true"
                        >
                          {flagged ? "!" : i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground tabular-nums">
                          {s.ticket_id ? (
                            <span className="font-mono">Ticket {s.ticket_id.slice(0, 8)}…</span>
                          ) : (
                            "Untagged fix"
                          )}
                          {flagged && <span className="text-amber-700"> · flagged</span>}
                          {s.arrived_at && <> · arrived {formatISTTime(s.arrived_at)}</>}
                          {s.departed_at && s.departed_at !== s.arrived_at && (
                            <> · departed {formatISTTime(s.departed_at)}</>
                          )}
                        </span>
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
