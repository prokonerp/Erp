import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRoadRoute, hashTrace, type LatLng } from "@/lib/roadRoute";

/**
 * TanStack Query wrapper around fetchRoadRoute.
 *
 * Mirrors the style of useEngineerMovement: immutable data, no hammering,
 * raw-point fallback on any failure. Returns raw points (matched: false)
 * while loading or when the service fails so the map is never empty.
 */
export function useRoadRoute(points: Array<[number, number]>): {
  geometry: Array<[number, number]>;
  matched: boolean;
  loading: boolean;
} {
  // Stable hash for cache key — don't recompute every render.
  const traceHash = useMemo(() => hashTrace(points), [points]);

  const query = useQuery({
    queryKey: ["road-route", traceHash],
    queryFn: () => fetchRoadRoute(points),
    enabled: points.length >= 2 && typeof window !== "undefined",
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const geometry = useMemo(() => {
    if (query.data?.geometry) return query.data.geometry;
    // Fallback: always return raw points so the map is never blank.
    return points;
  }, [query.data?.geometry, points]);

  const matched = query.data?.matched ?? false;

  return {
    geometry,
    matched,
    loading: query.status === "pending",
  };
}
