import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildLegs, legColour, legDistanceM, type LegPing, type LegSite } from "@/lib/routeLegs";
import { fetchRoadRoute, hashTrace, type LatLng } from "@/lib/roadRoute";

export type RenderedLeg = {
  index: number;
  colour: string;
  geometry: LatLng[];
  matched: boolean;
  fromLabel: string;
  toLabel: string;
  startedAt: string | null;
  endedAt: string | null;
  distanceM: number;
  ticketId: string | null;
};

/**
 * TanStack Query wrapper around buildLegs + per-leg road matching.
 *
 * - Memoises raw legs (no road data) from pings/sites.
 * - If >12 legs, collapses to a single leg over all pings (bounded work).
 * - Road-matches each leg sequentially with a bounded request budget.
 * - While loading, returns raw per-leg points as `matched: false`.
 * - Never throws — fetch failures degrade to straight-line for that leg.
 */
export function useRouteLegs(
  pings: LegPing[],
  sites: LegSite[],
): { legs: RenderedLeg[]; loading: boolean } {
  // ---- Hooks called unconditionally (order invariant) ----

  // 1. useMemo — build raw legs from pure logic
  const rawLegs = useMemo(() => buildLegs(pings, sites), [pings, sites]);

  // 2. Bounded work: collapse >12 legs to one; tolerate empty input (→ empty)
  const legsForFetch =
    rawLegs.length === 0
      ? []
      : rawLegs.length > 12
        ? [
            {
              ...rawLegs[0],
              pings: rawLegs.flatMap((l) => l.pings),
              index: 1,
            },
          ]
        : rawLegs;

  // 3. Derived values (not hooks — just plain computation)
  const pingArr = rawLegs.flatMap((l) => l.pings);
  const pingHash = hashTrace(pingArr.map((p) => [p.lat, p.long] as [number, number]));
  const sitesSig = sites
    .map((s) => `${s.ticket_id ?? ""}|${s.arrived_at ?? ""}|${s.departed_at ?? ""}`)
    .join("|");
  const queryKey = ["route-legs", pingHash, sitesSig];

  // 4. Per-leg request budget (safe: MAX_TOTAL / 0 → Infinity; queryFn won't run)
  const MAX_TOTAL = 12;
  const perLeg = Math.max(1, Math.floor(MAX_TOTAL / legsForFetch.length));

  // 5. useQuery — always called; disabled when no legs
  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<RenderedLeg[]> => {
      const results: RenderedLeg[] = [];
      for (const leg of legsForFetch) {
        const geom = leg.pings.map((p) => [p.lat, p.long] as [number, number]);
        try {
          const r = await fetchRoadRoute(geom, { maxRequests: perLeg });
          results.push({
            index: leg.index,
            colour: legColour(leg.index - 1),
            geometry: r.geometry,
            matched: r.matched,
            fromLabel: leg.fromLabel,
            toLabel: leg.toLabel,
            startedAt: leg.startedAt,
            endedAt: leg.endedAt,
            distanceM: legDistanceM(r.geometry),
            ticketId: leg.ticketId,
          });
        } catch {
          // Fetch failed → straight-line fallback for this leg only
          results.push({
            index: leg.index,
            colour: legColour(leg.index - 1),
            geometry: geom,
            matched: false,
            fromLabel: leg.fromLabel,
            toLabel: leg.toLabel,
            startedAt: leg.startedAt,
            endedAt: leg.endedAt,
            distanceM: legDistanceM(geom),
            ticketId: leg.ticketId,
          });
        }
      }
      return results;
    },
    enabled: typeof window !== "undefined" && legsForFetch.length > 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 6. Computed non-hook value
  const loading = query.status === "pending";

  // 7. useMemo — render result (returns [] when no raw legs)
  const rendered = useMemo(() => {
    if (rawLegs.length === 0) return [];
    if (query.data) return query.data;
    return legsForFetch.map((leg) => {
      const geom = leg.pings.map((p) => [p.lat, p.long] as [number, number]);
      return {
        index: leg.index,
        colour: legColour(leg.index - 1),
        geometry: geom,
        matched: false,
        fromLabel: leg.fromLabel,
        toLabel: leg.toLabel,
        startedAt: leg.startedAt,
        endedAt: leg.endedAt,
        distanceM: legDistanceM(geom),
        ticketId: leg.ticketId,
      };
    });
  }, [query.data, rawLegs.length, legsForFetch]);

  return { legs: rendered, loading };
}
