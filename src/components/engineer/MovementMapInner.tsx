import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
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

function numberIcon(n: number, flagged: boolean) {
  const ring = flagged ? "#d97706" : "#2563eb";
  return L.divIcon({
    className: "eng-map-stop",
    html: `<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:9999px;background:${flagged ? "#fef3c7" : "#2563eb"};color:${flagged ? "#92400e" : "#fff"};font-size:12px;font-weight:700;border:2px solid ${ring};box-shadow:0 1px 3px rgba(0,0,0,.4)">${flagged ? "!" : n}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function FitToData({ points }: { points: Array<[number, number]> }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(L.latLngBounds(points.map((p) => L.latLng(p[0], p[1]))), { padding: [24, 24] });
  }, [map, points]);
  return null;
}

/**
 * Leaflet map. Client-only — always render through MovementMap (mounted
 * guard + lazy), never import this file on the server path. The adjacent
 * roster list carries the same data, so the map is never the only surface.
 */
export function MovementMapInner({
  pins,
  route,
  stops,
  height = 320,
  selectedId,
  onPinSelect,
  emptyHint = "No engineers on duty",
}: {
  pins: MapPin[];
  route?: Array<[number, number]>;
  stops?: MapStop[];
  height?: number;
  selectedId?: string | null;
  onPinSelect?: (id: string) => void;
  emptyHint?: string;
}) {
  const [tilesFailed, setTilesFailed] = useState(false);
  const points: Array<[number, number]> = [
    ...pins.map((p) => [p.lat, p.long] as [number, number]),
    ...(route ?? []),
  ];
  const empty = points.length === 0;
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div
        className="relative min-h-[320px]"
        style={{ height, isolation: "isolate" }}
        aria-label="Engineer movement map"
        role="img"
      >
        <MapContainer
          center={points[0] ?? INDIA_CENTER}
          zoom={points[0] ? 13 : 5}
          style={{ height: "100%", width: "100%", minHeight: 320 }}
          scrollWheelZoom={false}
        >
          <FitToData points={points} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            eventHandlers={{
              tileerror: () => setTilesFailed(true),
            }}
          />
          {route && route.length > 1 && (
            <Polyline positions={route} pathOptions={{ color: "#2563eb", weight: 3 }} />
          )}
          {pins.map((p) => {
            const selected = selectedId != null && p.id === selectedId;
            return (
              <CircleMarker
                key={p.id}
                center={[p.lat, p.long]}
                radius={selected ? 12 : 9}
                pathOptions={{
                  color: selected ? "#1d4ed8" : "#fff",
                  weight: selected ? 3 : 2,
                  fillColor: p.onDuty && p.fresh ? "#16a34a" : "#9ca3af",
                  fillOpacity: 1,
                }}
                eventHandlers={onPinSelect ? { click: () => onPinSelect(p.id) } : undefined}
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
          })}
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
        </MapContainer>
        {empty && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/60 p-4">
            <p className="rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
              {emptyHint}
            </p>
          </div>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
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
        {tilesFailed && <span>Map tiles failed to load — the list has the same data.</span>}
      </figcaption>
    </figure>
  );
}
