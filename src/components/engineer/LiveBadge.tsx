import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatLastSeen, type LiveEngineer } from "@/hooks/useEngineerMovement";
import { isFixFresh, LOCATION_GRACE_MS } from "@/lib/field-location";

/**
 * Duty freshness badge — "On duty · 3m ago", never a bare live dot.
 * Time comes from the parent's single tick (no per-row intervals).
 */
export function LiveBadge({
  live,
  nowMs,
}: {
  live: LiveEngineer | null | undefined;
  nowMs: number;
}) {
  if (!live) return <span className="text-muted-foreground">—</span>;
  if (!live.on_duty) return <StatusBadge tone="neutral">Off</StatusBadge>;
  const fresh = isFixFresh(live.last_seen_at, nowMs, LOCATION_GRACE_MS);
  return (
    <StatusBadge tone={fresh ? "success" : "warning"}>
      On duty · {formatLastSeen(live.last_seen_at, nowMs)}
    </StatusBadge>
  );
}
