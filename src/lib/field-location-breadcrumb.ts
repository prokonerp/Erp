import { recordPings } from "@/lib/field-location.functions";
import { getCurrentGeo, type GeoFix } from "@/lib/verification-geo";
import { newClientId } from "@/lib/duty-queue";

export type BreadcrumbSource = "arrive" | "depart" | "fsr" | "photo";

/**
 * Best-effort event breadcrumb: one ping with a source tag attached to a
 * ticket event. NEVER throws and must never block the parent flow — call as
 * `void breadcrumbPing(...)`.
 *
 * - pass a GeoFix to reuse a fix the caller already captured (photo flows);
 * - pass null to skip silently (caller decided GPS is unavailable indoors);
 * - pass undefined to capture a fresh one-shot fix (arrive/depart/fsr).
 */
export async function breadcrumbPing(
  source: BreadcrumbSource,
  ticketId: string,
  geo?: GeoFix | null,
): Promise<void> {
  try {
    let fix: GeoFix | null = geo ?? null;
    if (fix == null && geo === undefined) {
      try {
        fix = await getCurrentGeo(8000);
      } catch {
        return;
      }
    }
    if (!fix) return;
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.long)) return;
    await recordPings({
      data: {
        session_id: null,
        pings: [
          {
            client_ping_id: newClientId(),
            lat: fix.lat,
            long: fix.long,
            accuracy: fix.accuracy,
            captured_at: fix.captured_at,
            ticket_id: ticketId,
            source,
          },
        ],
      },
    });
  } catch {
    // Breadcrumb only — the visit/photo/FSR result already stands.
  }
}
