import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatLastSeen, type LiveEngineer } from "@/hooks/useEngineerMovement";
import { isFixFresh, LOCATION_GRACE_MS } from "@/lib/field-location";

/**
 * Duty freshness badge — "On duty · 3m ago", never a bare live dot.
 * Ticks internally so the relative time ages without parent re-renders.
 */
export function LiveBadge({ live }: { live: LiveEngineer | null | undefined }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!live?.on_duty) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, [live?.on_duty]);

  if (!live) return <span className="text-muted-foreground">—</span>;
  if (!live.on_duty) return <StatusBadge tone="neutral">Off</StatusBadge>;
  const now = Date.now();
  const fresh = isFixFresh(live.last_seen_at, now, LOCATION_GRACE_MS);
  return (
    <StatusBadge tone={fresh ? "success" : "warning"}>
      On duty · {formatLastSeen(live.last_seen_at, now)}
    </StatusBadge>
  );
}
