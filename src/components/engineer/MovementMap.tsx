import { Suspense, lazy, useEffect, useState } from "react";
import { CardSkeleton } from "@/components/shared/skeletons";
import type { MapPin, MapStop } from "@/components/engineer/MovementMapInner";

const LazyInner = lazy(() =>
  import("@/components/engineer/MovementMapInner").then((m) => ({ default: m.MovementMapInner })),
);

/**
 * Client-only map shell: SSR guard + lazy leaflet (bundle + window safety).
 * The accessible roster list beside the map carries the same data — the map
 * is never the only surface (G6).
 */
export function MovementMap({
  pins,
  route,
  stops,
  height,
  selectedId,
  onPinSelect,
  emptyHint,
}: {
  pins: MapPin[];
  route?: Array<[number, number]>;
  stops?: MapStop[];
  height?: number;
  selectedId?: string | null;
  onPinSelect?: (id: string) => void;
  emptyHint?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return <CardSkeleton className="min-h-[320px]" />;
  return (
    <Suspense fallback={<CardSkeleton className="min-h-[320px]" />}>
      <LazyInner
        pins={pins}
        route={route}
        stops={stops}
        height={height}
        selectedId={selectedId}
        onPinSelect={onPinSelect}
        emptyHint={emptyHint}
      />
    </Suspense>
  );
}

export type { MapPin, MapStop };
