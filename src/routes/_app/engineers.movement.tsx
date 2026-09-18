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
      <div className="grid gap-4 lg:grid-cols-2">
        <MovementMap pins={pins} height={380} />
        <LiveRoster
          roster={roster}
          loading={live.isLoading}
          warnings={live.warnings}
          selectedId={selectedId}
          onSelect={setSelectedId}
          nowMs={nowMs}
          onChanged={() => void live.refetch()}
        />
      </div>
      {selected && <DayRouteView employeeId={selected.employee_id} name={selected.name} />}
    </div>
  );
}
