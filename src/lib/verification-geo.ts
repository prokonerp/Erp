export type GeoFix = {
  lat: number;
  long: number;
  accuracy: number | null;
  captured_at: string;
};

export function validateGeoForMismatch(geo: GeoFix | null): string | null {
  if (!geo)
    return "Live location is required for mismatch photo. Allow location and retry.";
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.long))
    return "Live location is required for mismatch photo. Allow location and retry.";
  if (!geo.captured_at) return "Photo capture time missing. Retake the photo.";
  return null;
}

export function getCurrentGeo(timeoutMs = 15000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator))
      return reject(new Error("Geolocation not supported on this device."));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          long: p.coords.longitude,
          accuracy: p.coords.accuracy ?? null,
          captured_at: new Date().toISOString(),
        }),
      (e) =>
        reject(
          new Error(
            e.message || "Location permission denied. Allow location and retry.",
          ),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
