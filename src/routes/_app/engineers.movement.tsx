import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { AdminWarnings } from "@/components/engineer/AdminWarnings";
import { MovementMap } from "@/components/engineer/MovementMap";
import { LiveRoster } from "@/components/engineer/LiveRoster";
import { DayRouteView } from "@/components/engineer/DayRouteView";
import { formatLastSeen, useLiveRoster } from "@/hooks/useEngineerMovement";

export const Route = createFileRoute("/_app/engineers/movement")({
  component: EngineersMovementPage,
  head: () => ({ meta: [{ title: "Engineers Movement — Prokon" }] }),
});

/**
 * Movement tab: live on-duty map + roster, per-engineer day route below.
 * Map and list carry the same data — tiles failing never blocks the roster.
 */
function EngineersMovementPage() {
  const live = useLiveRoster();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const roster = useMemo(() => live.data ?? [], [live.data]);

  useEffect(() => {
    if (selectedId && !roster.some((e) => e.employee_id === selectedId)) {
      setSelectedId(null);
    }
  }, [roster, selectedId]);

  const stats = useMemo(() => {
    let onDuty = 0;
    let stale = 0;
    for (const e of roster) {
      if (!e.on_duty) continue;
      onDuty += 1;
      if (!e.last_seen_at || nowMs - Date.parse(e.last_seen_at) > 15 * 60_000) stale += 1;
    }
    return { onDuty, stale, off: roster.length - onDuty };
  }, [roster, nowMs]);

  const pins = useMemo(
    () =>
      roster
        .filter((e) => e.last_lat != null && e.last_long != null)
        .map((e) => ({
          id: e.employee_id,
          lat: e.last_lat as number,
          long: e.last_long as number,
          label: e.name ?? "Unknown engineer",
          detail: `${e.on_duty ? "On duty" : "Off duty"} · last seen ${formatLastSeen(e.last_seen_at, nowMs)}`,
          fresh: e.on_duty && e.last_seen_at != null,
          onDuty: e.on_duty,
        })),
    [roster, nowMs],
  );

  const selected = roster.find((e) => e.employee_id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Movement"
        description="On-duty positions and day routes — positions render as “last seen”, never live dots"
      />
      <div
        role="status"
        aria-label="Roster summary"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-border bg-card px-3 py-2 text-[13px] tabular-nums"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-600" aria-hidden="true" />
          <strong className="font-semibold">{stats.onDuty}</strong>
          <span className="text-muted-foreground">on duty</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
          <strong className="font-semibold">{stats.stale}</strong>
          <span className="text-muted-foreground">stale</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/40" aria-hidden="true" />
          <strong className="font-semibold">{stats.off}</strong>
          <span className="text-muted-foreground">off</span>
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="order-1">
          <MovementMap
            pins={pins}
            height={380}
            selectedId={selectedId}
            onPinSelect={(id) => setSelectedId((s) => (s === id ? null : id))}
          />
        </div>
        <div className="order-2">
          <LiveRoster
            roster={roster}
            loading={live.isLoading}
            warnings={live.warnings}
            loadError={live.loadError}
            selectedId={selectedId}
            onSelect={setSelectedId}
            nowMs={nowMs}
            onChanged={() => void live.refetch()}
          />
        </div>
      </div>
      {selected && <DayRouteView employeeId={selected.employee_id} name={selected.name} />}
    </div>
  );
}
