import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { useRoadRoute } from "@/hooks/useRoadRoute";
import { useAnimatedLatLng } from "@/hooks/useAnimatedLatLng";
import type { DegradedReason, LatLng } from "@/lib/roadRoute";
import { sampleArrowPoints } from "@/lib/routeLegs";
import type { RenderedLeg } from "@/hooks/useRouteLegs";

export type MapPin = {
  id: string;
  lat: number;
  long: number;
  label: string;
  detail?: string;
  fresh: boolean;
  onDuty: boolean;
};

export type MapStop = {
  n: number;
  lat: number;
  long: number;
  label: string;
  flagged?: boolean;
};

const INDIA_CENTER: [number, number] = [22.5, 78.5];

// ---------------------------------------------------------------------------
// Marker icons
// ---------------------------------------------------------------------------

function numberIcon(n: number, flagged: boolean) {
  const ring = flagged ? "#d97706" : "#2563eb";
  return L.divIcon({
    className: "eng-map-stop",
    html: `<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:9999px;background:${flagged ? "#fef3c7" : "#2563eb"};color:${flagged ? "#92400e" : "#fff"};font-size:12px;font-weight:700;border:2px solid ${ring};box-shadow:0 1px 3px rgba(0,0,0,.4)">${flagged ? "!" : n}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/** 22 px circular start marker (green, letter "S"). */
function startIcon() {
  return L.divIcon({
    className: "eng-map-start",
    html: `<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:9999px;background:#16a34a;color:#fff;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">S</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/** 22 px circular end marker (red, letter "E"). */
function endIcon() {
  return L.divIcon({
    className: "eng-map-end",
    html: `<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:9999px;background:#dc2626;color:#fff;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">E</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

/** Arrow indicator — upward-pointing chevron rotated by bearing degrees. */
function arrowIcon(bearing: number, color: string) {
  return L.divIcon({
    className: "eng-map-arrow",
    html: `<svg width="14" height="14" viewBox="0 0 14 14" style="transform:rotate(${bearing}deg);display:block"><polygon points="7,1 13,13 7,9 1,13" fill="${color}" stroke="white" stroke-width="1.2"/></svg>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

// ---------------------------------------------------------------------------
// Animated roster pin — throttled glide between last-seen fixes
// ---------------------------------------------------------------------------

/**
 * One roster pin with a throttled, gliding position.
 *
 * PRIVACY (ADR-0001): this is a UI transition between "last seen" fixes —
 * the popup label still reads "last seen X ago"; this is NOT a live dot.
 */
function AnimatedPin({
  p,
  selected,
  onSelect,
}: {
  p: MapPin;
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const pos = useAnimatedLatLng([p.lat, p.long]);
  return (
    <CircleMarker
      center={pos}
      radius={selected ? 12 : 9}
      pathOptions={{
        color: selected ? "#1d4ed8" : "#fff",
        weight: selected ? 3 : 2,
        fillColor: p.onDuty && p.fresh ? "#16a34a" : "#9ca3af",
        fillOpacity: 1,
      }}
      eventHandlers={onSelect ? { click: () => onSelect(p.id) } : undefined}
    >
      <Tooltip>
        {p.label}
        {!p.onDuty || !p.fresh ? " (stale)" : ""}
      </Tooltip>
      <Popup>
        <strong>{p.label}</strong>
        {p.detail && (
          <>
            <br />
            {p.detail}
          </>
        )}
      </Popup>
    </CircleMarker>
  );
}

// ---------------------------------------------------------------------------
// Fit-to-data — keeps the map viewport scoped to visible content
// ---------------------------------------------------------------------------

function FitToData({ points, fitKey }: { points: Array<[number, number]>; fitKey: string }) {
  const map = useMap();
  // Coordinates are read through a ref so the effect can depend on `fitKey`
  // (a serialized coordinate snapshot) rather than array identity. Array
  // identity changes on every render, which re-fit the map — and threw away a
  // manual pan/zoom — on every 30 s freshness tick and every pin click.
  const pointsRef = useRef(points);
  pointsRef.current = points;
  useEffect(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0], 14);
      return;
    }
    map.fitBounds(L.latLngBounds(pts.map((p) => L.latLng(p[0], p[1]))), { padding: [24, 24] });
  }, [map, fitKey]);
  return null;
}

// ---------------------------------------------------------------------------
// Single-route rendering (legacy path — no legs)
// ---------------------------------------------------------------------------

function LegacyRoute({
  road,
  route,
  selectedLeg,
}: {
  road: { geometry: Array<[number, number]>; matched: boolean };
  route?: Array<[number, number]>;
  selectedLeg: number | null;
}) {
  if (road.geometry.length < 2) return null;

  return (
    <>
      {/* White casing underneath, coloured core on top.
          When road-matching failed render dashed amber so the user knows
          it is a straight-line approximation. */}
      <Polyline
        positions={road.geometry}
        pathOptions={{
          color: "#ffffff",
          weight: 8,
          opacity: 0.9,
          lineCap: "round" as const,
          lineJoin: "round" as const,
        }}
      />
      <Polyline
        positions={road.geometry}
        pathOptions={
          !road.matched
            ? {
                color: "#d97706",
                weight: 4.5,
                opacity: 0.95,
                dashArray: "6 8",
                lineCap: "round" as const,
                lineJoin: "round" as const,
              }
            : {
                color: "#2563eb",
                weight: 4.5,
                opacity: 0.95,
                lineCap: "round" as const,
                lineJoin: "round" as const,
              }
        }
      />
      {route && route.length > 1 && (
        <>
          <Marker position={road.geometry[0]} icon={startIcon()} />
          <Marker position={road.geometry[road.geometry.length - 1]} icon={endIcon()} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Legs-based rendering (new path)
// ---------------------------------------------------------------------------

function LegRoutes({
  legs,
  selectedLeg,
  onLegSelect,
}: {
  legs: readonly RenderedLeg[];
  selectedLeg: number | null;
  onLegSelect?: (index: number | null) => void;
}) {
  // S / E markers from first/last leg geometry
  const firstGeom = legs[0]?.geometry;
  const lastGeom = legs[legs.length - 1]?.geometry;

  return (
    <>
      {legs.map((leg) => {
        const isSelected = selectedLeg !== null && selectedLeg === leg.index;
        const dimmed = selectedLeg !== null && !isSelected;
        const opacity = dimmed ? 0.3 : 1;
        const geom = leg.geometry;

        if (geom.length < 2) return null;

        return (
          <g key={leg.index}>
            {/* White casing */}
            <Polyline
              positions={geom}
              pathOptions={{
                color: "#ffffff",
                weight: 8,
                opacity: dimmed ? 0.15 : 0.9,
                lineCap: "round" as const,
                lineJoin: "round" as const,
              }}
            />
            {/* Coloured core + click handler */}
            <Polyline
              positions={geom}
              pathOptions={{
                ...(!leg.matched
                  ? {
                      color: leg.colour,
                      weight: 4.5,
                      opacity,
                      dashArray: "6 8",
                      lineCap: "round" as const,
                      lineJoin: "round" as const,
                    }
                  : {
                      color: leg.colour,
                      weight: 4.5,
                      opacity,
                      lineCap: "round" as const,
                      lineJoin: "round" as const,
                    }),
              }}
              eventHandlers={
                onLegSelect
                  ? {
                      click: () => onLegSelect(isSelected ? null : leg.index),
                    }
                  : undefined
              }
            />
            {/* Arrows — only visible when leg is selected or nothing selected */}
            {!dimmed && (
              <>
                {sampleArrowPoints(geom, 400).map(
                  (arrow: { lat: number; long: number; bearing: number }, ai: number) => (
                    <Marker
                      key={`${leg.index}-${ai}`}
                      position={[arrow.lat, arrow.long]}
                      icon={arrowIcon(arrow.bearing, leg.colour)}
                      interactive={false}
                    />
                  ),
                )}
              </>
            )}
          </g>
        );
      })}
      {/* Start / end markers */}
      {firstGeom?.length && lastGeom?.length && (
        <>
          {firstGeom[0] && <Marker position={firstGeom[0]} icon={startIcon()} />}
          {lastGeom[lastGeom.length - 1] && (
            <Marker position={lastGeom[lastGeom.length - 1]} icon={endIcon()} />
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Leaflet map with road-snapped route rendering — client-only (always render
 * through MovementMap: mounted guard + lazy). The adjacent roster list carries
 * the same data, so the map is never the only surface (G6).
 *
 * Route geometry uses three-tier OSRM fallback (match → route → raw polyline)
 * so a failed match degrades to a straight line rather than nothing.
 *
 * New: when `legs` is provided, each leg is drawn in its own colour with
 * direction arrows and click-to-select emphasis.
 */
export function MovementMapInner({
  pins,
  route,
  stops,
  height = 320,
  selectedId,
  onPinSelect,
  emptyHint = "No engineers on duty",
  legs,
  selectedLeg,
  onLegSelect,
  degraded,
  replayPath,
  replayPosition,
}: {
  pins: MapPin[];
  route?: Array<[number, number]>;
  stops?: MapStop[];
  height?: number;
  selectedId?: string | null;
  onPinSelect?: (id: string) => void;
  emptyHint?: string;
  legs?: readonly RenderedLeg[];
  selectedLeg?: number | null;
  onLegSelect?: (index: number | null) => void;
  degraded?: DegradedReason;
  replayPath?: Array<[number, number]>;
  replayPosition?: [number, number] | null;
}) {
  const [tilesFailed, setTilesFailed] = useState(false);
  const road = useRoadRoute(route ?? []);

  // Collect every point that should be within fit bounds
  const allPoints: Array<[number, number]> = useMemo(() => {
    const pts: Array<[number, number]> = pins.map((p) => [p.lat, p.long] as [number, number]);
    if (legs && legs.length > 0) {
      for (const leg of legs) {
        for (const p of leg.geometry) pts.push(p);
      }
    } else {
      pts.push(...(route ?? []));
      pts.push(...road.geometry);
    }
    return pts;
  }, [pins, route, road.geometry, legs]);

  const fitKey = allPoints.map((p) => `${p[0]},${p[1]}`).join("|");
  const empty = allPoints.length === 0;
  const hasLegs = legs && legs.length > 0;
  const selLeg = selectedLeg ?? null;
  // A hard guardrail trip (budget/service) means geometry is straight-line.
  const guardrailDegraded =
    degraded === "budget" ||
    degraded === "service" ||
    road.degraded === "budget" ||
    road.degraded === "service";

  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div
        className="relative min-h-[320px]"
        style={{ height, isolation: "isolate" }}
        aria-label="Engineer movement map"
        role="img"
      >
        <MapContainer
          center={allPoints[0] ?? INDIA_CENTER}
          zoom={allPoints[0] ? 13 : 5}
          style={{ height: "100%", width: "100%", minHeight: 320 }}
          scrollWheelZoom={false}
        >
          <FitToData points={allPoints} fitKey={fitKey} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            eventHandlers={{ tileerror: () => setTilesFailed(true) }}
          />

          {/* Render either legs-based or legacy single-route path */}
          {hasLegs ? (
            <LegRoutes legs={legs} selectedLeg={selLeg} onLegSelect={onLegSelect} />
          ) : (
            <LegacyRoute road={road} route={route} selectedLeg={selLeg} />
          )}

          {/* Pins — throttled glide between last-seen fixes (ADR-0001: no live dot) */}
          {pins.map((p) => (
            <AnimatedPin
              key={p.id}
              p={p}
              selected={selectedId != null && selectedId === p.id}
              onSelect={onPinSelect}
            />
          ))}

          {/* Stops */}
          {(stops ?? []).map((s) => (
            <Marker key={s.n} position={[s.lat, s.long]} icon={numberIcon(s.n, !!s.flagged)}>
              <Popup>
                <strong>
                  Stop {s.n}: {s.label}
                </strong>
                {s.flagged && (
                  <>
                    <br />
                    Flagged for review (impossible fix data)
                  </>
                )}
              </Popup>
            </Marker>
          ))}

          {/* Trail replay — road-snapped progress + playhead (admins only) */}
          {replayPath && replayPath.length > 1 && (
            <>
              <Polyline
                positions={replayPath}
                pathOptions={{
                  color: "#ffffff",
                  weight: 9,
                  opacity: 0.9,
                  lineCap: "round" as const,
                  lineJoin: "round" as const,
                }}
              />
              <Polyline
                positions={replayPath}
                pathOptions={{
                  color: "#16a34a",
                  weight: 5.5,
                  opacity: 0.95,
                  lineCap: "round" as const,
                  lineJoin: "round" as const,
                }}
              />
            </>
          )}
          {replayPosition && (
            <CircleMarker
              center={replayPosition}
              radius={8}
              pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#16a34a", fillOpacity: 1 }}
              interactive={false}
            />
          )}
        </MapContainer>

        {/* Empty-state overlay */}
        {empty && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/60 p-4">
            <p className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
              {emptyHint}
            </p>
          </div>
        )}
      </div>

      {/* Legend */}
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        {/* Always-visible: pin legend */}
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full bg-green-600 ring-2 ring-white"
            aria-hidden="true"
          />
          Fresh (on duty)
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full bg-gray-400 ring-2 ring-white"
            aria-hidden="true"
          />
          Stale / off duty
        </span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-grid h-4 w-4 place-items-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-800 ring-2 ring-amber-600"
            aria-hidden="true"
          >
            !
          </span>
          Flagged stop
        </span>

        {/* Legs-based legend */}
        {hasLegs && (
          <>
            {/* Leg chips */}
            {legs!.map((leg) => (
              <span
                key={leg.index}
                className="inline-flex cursor-pointer items-center gap-1 hover:opacity-80"
                onClick={() => onLegSelect?.(selLeg === leg.index ? null : leg.index)}
              >
                <span
                  className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: leg.colour }}
                  aria-hidden="true"
                >
                  {leg.index}
                </span>
                <span className={leg.matched ? "" : "italic"}>
                  {leg.fromLabel}
                  {" \u2192 "}
                  {leg.toLabel}
                </span>
              </span>
            ))}
            {/* S/E always shown with legs */}
            <span className="inline-flex items-center gap-1">
              <span className="inline-grid h-4 w-4 place-items-center rounded-full bg-green-600 text-[10px] font-bold text-white">
                S
              </span>
              {"\u2192"}
              <span className="inline-grid h-4 w-4 place-items-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                E
              </span>
              Start / end
            </span>
          </>
        )}

        {/* Legacy single-route legend */}
        {!hasLegs && route && route.length > 1 && (
          <>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-6 rounded-sm bg-blue-600" aria-hidden="true" />
              Route (road-matched)
            </span>
            {!road.matched && (
              <>
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block h-2.5 w-6 rounded-sm"
                    style={{
                      background: "#d97706",
                      backgroundImage:
                        "repeating-linear-gradient(90deg,#d97706 0,#d97706 6px,transparent 6px,transparent 8px)",
                    }}
                    aria-hidden="true"
                  />
                  Route (straight — not matched)
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-grid h-4 w-4 place-items-center rounded-full bg-green-600 text-[10px] font-bold text-white">
                    S
                  </span>
                  {"\u2192"}
                  <span className="inline-grid h-4 w-4 place-items-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                    E
                  </span>
                  Start / end
                </span>
              </>
            )}
          </>
        )}

        {guardrailDegraded && (
          <span className="text-amber-700">
            Road matching paused (service limit) — showing straight lines
          </span>
        )}
        {road.loading && <span className="text-muted-foreground">Matching route to roads…</span>}
        {tilesFailed && <span>Map tiles failed to load — the list has the same data.</span>}
      </figcaption>
    </figure>
  );
}
