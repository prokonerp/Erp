/**
 * Road-snapping for engineer pings — client-side only.
 *
 * Three tiers, never blank, never throws:
 *   1. match/v1 (map-matching a noisy trace to roads) → preferred, Zomato-like result
 *   2. route/v1 (waypoint routing between pings) → still road-following
 *   3. Raw straight polyline → fallback when both services fail
 *
 * Uses OSRM public demo by default (`https://router.project-osrm.org`).
 * Override with `import.meta.env.VITE_OSRM_BASE_URL` if self-hosting.
 */

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export type LatLng = [number, number]; // [lat, long] — matches rest of codebase

/** Default OSRM demo server (CORS *) — override via VITE_OSRM_BASE_URL env var */
export const DEFAULT_OSRM_BASE_URL = "https://router.project-osrm.org";

/** Maximum coordinates per OSRM route request (measured Ok to 300+ on the demo). */
export const OSRM_MAX_COORDS = 100;

/**
 * Maximum coordinates per OSRM match request. MEASURED 2026-09-22 against the
 * public demo server: match returns `TooBig` at 12+ coordinates (Ok at 10), so
 * a 100-point chunk would spend a request on a guaranteed failure before
 * falling through to route. Trace-sized traces therefore skip map-matching
 * against the default host; a self-hosted OSRM (VITE_OSRM_BASE_URL) usually
 * raises this limit.
 */
export const OSRM_MATCH_MAX_COORDS = 10;

/** Radius in metres for urban GPS noise during map-matching (5 m default drops legitimate points). */
export const OSRM_MATCH_RADIUS_M = 30;

/** Max points after decimation — bounds a day's trace so we hit ≤ MAX_REQUESTS chunks. */
export const MAX_TRACE_COORDS = 600;

/** Maximum number of network requests; beyond this we fall back to raw points. */
export const MAX_REQUESTS = 8;

// ---------------------------------------------------------------------------
// Preparation helpers
// ---------------------------------------------------------------------------

/** Drop non-finite / out-of-range coords and exact duplicate consecutive points. */
export function prepareTrace(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    if (p[0] < -90 || p[0] > 90 || p[1] < -180 || p[1] > 180) continue;
    if (out.length > 0) {
      const prev = out[out.length - 1];
      if (prev[0] === p[0] && prev[1] === p[1]) continue; // exact duplicate
    }
    out.push(p);
  }
  return out;
}

/** Evenly sample to `maxCoords` while always keeping first and last point. */
export function decimateTrace(points: LatLng[], maxCoords = MAX_TRACE_COORDS): LatLng[] {
  if (points.length <= maxCoords) return points;
  const out: LatLng[] = [points[0]];
  const stride = Math.max(1, Math.ceil((points.length - 2) / (maxCoords - 2)));
  for (let i = 1; i < points.length - 1; i += stride) {
    out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Split into chunks that share boundary points (no visual gap on merge). */
export function chunkTrace(points: LatLng[], max = OSRM_MAX_COORDS): LatLng[][] {
  const chunks: LatLng[][] = [];
  if (points.length <= max) {
    return [points];
  }
  let start = 0;
  while (start < points.length) {
    const end = Math.min(start + max, points.length);
    const chunk = points.slice(start, end);
    chunks.push(chunk);
    if (end >= points.length) break;
    // Next chunk starts at one point before this chunk's last so they overlap.
    start = end - 1;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// URL builders (emits lon,lat — OSRM expects lon,lat; app uses lat,long)
// ---------------------------------------------------------------------------

export function buildMatchUrl(
  baseUrl: string,
  points: LatLng[],
  radiusM = OSRM_MATCH_RADIUS_M,
): string {
  const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const radii = points.map(() => radiusM).join(";");
  return `${baseUrl}/match/v1/driving/${coords}?geometries=geojson&overview=full&tidy=true&radiuses=${radii}`;
}

export function buildRouteUrl(baseUrl: string, points: LatLng[]): string {
  const coords = points.map(([lat, lng]) => `${lng},${lat}`).join(";");
  return `${baseUrl}/route/v1/driving/${coords}?geometries=geojson&overview=full`;
}

// ---------------------------------------------------------------------------
// Geometry parser — extracts OSRM output, reverses [lon,lat] → [lat,long]
// ---------------------------------------------------------------------------

function coordPair(c: unknown): LatLng | null {
  if (!Array.isArray(c) || c.length < 2) return null;
  const lat = Number(c[1]);
  const lng = Number(c[0]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

/**
 * Extract road geometry from an OSRM response body.
 * Tries matchings[].geometry.coordinates then routes[].geometry.coordinates.
 * Reverses every coordinate from [lon,lat] → [lat,long].
 * Returns null when code !== "Ok" or geometry is missing/empty/malformed.
 */
export function parseOsrmGeometry(body: unknown): LatLng[] | null {
  if (body == null || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const code = obj.code;
  if (code !== "Ok" && code !== "ok") return null;

  const coords: LatLng[] = [];

  // Tier 1: matchings (plural) — concatenates all matched segments.
  const matchings = obj.matchings;
  if (Array.isArray(matchings)) {
    for (const m of matchings) {
      if (m == null || typeof m !== "object") continue;
      const geom = (m as Record<string, unknown>).geometry;
      if (geom == null || typeof geom !== "object") continue;
      const c = (geom as Record<string, unknown>).coordinates;
      if (!Array.isArray(c)) continue;
      for (const pt of c) {
        const pair = coordPair(pt);
        if (pair) coords.push(pair);
      }
    }
  }

  // Tier 2: routes — single geometry spanning every leg.
  if (coords.length === 0) {
    const routes = obj.routes;
    if (Array.isArray(routes) && routes.length > 0) {
      const first = routes[0];
      if (first != null && typeof first === "object") {
        const geom = (first as Record<string, unknown>).geometry;
        if (geom != null && typeof geom === "object") {
          const c = (geom as Record<string, unknown>).coordinates;
          if (Array.isArray(c)) {
            for (const pt of c) {
              const pair = coordPair(pt);
              if (pair) coords.push(pair);
            }
          }
        }
      }
    }
  }

  if (coords.length === 0) return null;
  return coords;
}

// ---------------------------------------------------------------------------
// Merge geometries — concatenate parts dropping shared boundary points
// ---------------------------------------------------------------------------

export function mergeGeometries(parts: LatLng[][]): LatLng[] {
  const out: LatLng[] = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    if (
      out.length > 0 &&
      part[0][0] === out[out.length - 1][0] &&
      part[0][1] === out[out.length - 1][1]
    ) {
      // Skip the shared boundary point.
      out.push(...part.slice(1));
    } else {
      out.push(...part);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// FNV-1a 32-bit hash — stable short digest for react-query cache key
// ---------------------------------------------------------------------------

export function hashTrace(points: LatLng[]): string {
  let h = 2166136261 >>> 0; // FNV offset basis
  for (const [lat, lng] of points) {
    // Round to 5 decimal places (~1 m resolution) and encode as fixed-string.
    const s = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619); // FNV prime (32-bit)
    }
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Internal fetch helper — timeout + caller-signal combination
// ---------------------------------------------------------------------------

async function fetchWithTimeoutAndSignal(
  url: string,
  init: RequestInit,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Always combine with the caller's signal: a mid-flight unmount must abort
    // the request. `AbortSignal.any` is already aborted when the caller aborted
    // before this point, which is the desired behaviour.
    const combined =
      callerSignal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([callerSignal, controller.signal])
        : controller.signal;
    return await fetch(url, { ...init, signal: combined });
  } finally {
    clearTimeout(timerId);
  }
}

// ---------------------------------------------------------------------------
// Single-chunk resolver — try match, then route, then raw fallback
// ---------------------------------------------------------------------------

type ChunkResult = {
  geometry: LatLng[];
  usedService: boolean;
};

async function resolveChunk(
  baseUrl: string,
  chunk: LatLng[],
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<ChunkResult> {
  // Try tier 1: match — only when the chunk fits the engine's map-matching
  // limit. MEASURED 2026-09-22: the public demo returns TooBig at 12+
  // coordinates, so a full-size chunk would burn a request on a guaranteed
  // failure before falling through to route.
  if (chunk.length <= OSRM_MATCH_MAX_COORDS) {
    const matchUrl = buildMatchUrl(baseUrl, chunk);
    try {
      const res = await fetchWithTimeoutAndSignal(matchUrl, {}, callerSignal, timeoutMs);
      if (res.ok) {
        const body = (await res.json()) as unknown;
        const geo = parseOsrmGeometry(body);
        if (geo && geo.length >= 2) {
          return { geometry: geo, usedService: true };
        }
      }
    } catch (_e) {
      // Match failed — fall through to route.
    }
  }

  // Try tier 2: route
  const routeUrl = buildRouteUrl(baseUrl, chunk);
  try {
    const res = await fetchWithTimeoutAndSignal(routeUrl, {}, callerSignal, timeoutMs);
    if (res.ok) {
      const body = (await res.json()) as unknown;
      const geo = parseOsrmGeometry(body);
      if (geo && geo.length >= 2) {
        return { geometry: geo, usedService: true };
      }
    }
  } catch (_e) {
    // Route failed — fall through to raw.
  }

  // Tier 3: raw points.
  return { geometry: chunk, usedService: false };
}

// ---------------------------------------------------------------------------
// Main entry — fetchRoadRoute (never rejects, never throws)
// ---------------------------------------------------------------------------

/**
 * Resolve a trace of pings to road-following geometry using OSRM.
 *
 * Returns `{ geometry, matched }` where `matched` is true only if every
 * chunk produced service geometry. If any chunk fell back to raw points,
 * `matched` is false so the UI can stay honest about provenance.
 *
 * Never rejects — errors are silently swallowed and degrade to raw geometry.
 */
export async function fetchRoadRoute(
  points: LatLng[],
  opts?: {
    baseUrl?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    maxRequests?: number;
  },
): Promise<{ geometry: LatLng[]; matched: boolean }> {
  const {
    baseUrl = import.meta.env.VITE_OSRM_BASE_URL || DEFAULT_OSRM_BASE_URL,
    signal,
    timeoutMs = 8000,
    maxRequests = MAX_REQUESTS,
  } = opts ?? {};

  // If the caller has already aborted, return raw points immediately.
  if (signal?.aborted) {
    return { geometry: points, matched: false };
  }

  const cleaned = prepareTrace(points);
  if (cleaned.length < 2) {
    return { geometry: points, matched: false };
  }

  const trimmed = decimateTrace(cleaned);
  const chunks = chunkTrace(trimmed);

  const serviceParts: LatLng[][] = [];
  let matched = true;

  for (let i = 0; i < chunks.length; i++) {
    if (i >= maxRequests) {
      // Out of request budget — keep the REMAINING chunks as raw geometry
      // rather than dropping them, so the tail of a long route is never
      // silently truncated off the map.
      serviceParts.push(...chunks.slice(i));
      matched = false;
      break;
    }

    try {
      const result = await resolveChunk(baseUrl, chunks[i], signal, timeoutMs);
      serviceParts.push(result.geometry);
      if (!result.usedService) matched = false;
    } catch (_e) {
      // Any error degrades this chunk to raw.
      serviceParts.push(chunks[i]);
      matched = false;
    }
  }

  const merged = mergeGeometries(serviceParts);
  if (merged.length < 2) {
    return { geometry: cleaned, matched: false };
  }

  return { geometry: merged, matched };
}
