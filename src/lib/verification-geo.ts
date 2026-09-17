export type GeoFix = {
  lat: number;
  long: number;
  accuracy: number | null;
  captured_at: string;
};

export function validateGeoForMismatch(geo: GeoFix | null): string | null {
  if (!geo)
    return "Live location is required with the serial-number photo. Allow location and retry.";
  if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.long))
    return "Live location is required with the serial-number photo. Allow location and retry.";
  if (!geo.captured_at) return "Photo capture time missing. Retake the photo.";
  return null;
}

export function geoErrorMessage(code: number): string {
  switch (code) {
    case 1:
      return "Location permission denied. Enable location for this site in Settings and retry.";
    case 2:
      return "Phone could not get a fix. Move outdoors and retry.";
    case 3:
      return "Location timed out. Try again.";
    default:
      return "Location permission denied. Allow location and retry.";
  }
}

export function getCurrentGeo(timeoutMs = 25000): Promise<GeoFix> {
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
            typeof e.code === "number"
              ? geoErrorMessage(e.code)
              : e.message || "Location permission denied. Allow location and retry.",
          ),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
