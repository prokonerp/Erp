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
};

const INDIA_CENTER: [number, number] = [22.5, 78.5];

function numberIcon(n: number) {
  return L.divIcon({
    className: "eng-map-stop",
    html: `<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:9999px;background:#2563eb;color:#fff;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)">${n}</span>`,
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
 * guard + lazy), never import this file on the server path.
 */
export function MovementMapInner({
  pins,
  route,
  stops,
  height = 320,
}: {
  pins: MapPin[];
  route?: Array<[number, number]>;
  stops?: MapStop[];
  height?: number;
}) {
  const [tilesFailed, setTilesFailed] = useState(false);
  const points: Array<[number, number]> = [
    ...pins.map((p) => [p.lat, p.long] as [number, number]),
    ...(route ?? []),
  ];
  return (
    <figure className="overflow-hidden rounded-xl border border-border">
      <div style={{ height }} aria-label="Engineer movement map" role="img">
        <MapContainer
          center={points[0] ?? INDIA_CENTER}
          zoom={points[0] ? 13 : 5}
          style={{ height: "100%", width: "100%" }}
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
          {pins.map((p) => (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.long]}
              radius={9}
              pathOptions={{
                color: "#fff",
                weight: 2,
                fillColor: p.onDuty && p.fresh ? "#16a34a" : "#9ca3af",
                fillOpacity: 1,
              }}
            >
              <Tooltip>{p.label}</Tooltip>
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
          ))}
          {(stops ?? []).map((s) => (
            <Marker key={s.n} position={[s.lat, s.long]} icon={numberIcon(s.n)}>
              <Popup>
                <strong>
                  Stop {s.n}: {s.label}
                </strong>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      {tilesFailed && (
        <figcaption className="border-t border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          Map tiles failed to load — the list beside the map has the same data.
        </figcaption>
      )}
    </figure>
  );
}
