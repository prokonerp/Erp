// Field-location gate (ADR-0001). NEW file — auth-middleware.ts is
// auto-generated and must not be edited.
//
// requireFieldLocation enforces the transparent gate server-side: engineer
// write fns may run only with a fresh on-duty fix (or a live manager
// override). Fail CLOSED everywhere: any lookup failure blocks with a retry
// message rather than passing through.
//
// Exemptions are structural, not listed: this middleware is applied ONLY to
// engineer write fns. Auth, logout, change-password, getMyProfile, and the
// location fns themselves (startDutySession, recordPings, getMyLiveStatus,
// recordLocationConsent) must NEVER carry it — a blocked engineer can always
// fix GPS, log out, or change their password. Admins bypass (F2) because the
// gate targets /eng + engineer writes, never admin review.

import { createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { requireActiveUser } from "./auth-middleware";
import {
  isFixFresh,
  LOCATION_GATE_MESSAGE,
  LOCATION_GRACE_MS,
  LOCATION_REQUIRED,
} from "@/lib/field-location";

export { LOCATION_GRACE_MS, LOCATION_REQUIRED };

export type FieldLocationGateError = Error & { statusCode: number; code: string };

/**
 * Build a 403 for the server-fn transport. Must be a real `Error` instance
 * (same serialization contract as `unauthorized` in auth-middleware.ts).
 */
function locationDenied(message: string, code: string): FieldLocationGateError {
  const err = new Error(message) as FieldLocationGateError;
  err.statusCode = 403;
  err.code = code;
  try {
    setResponseStatus(403);
  } catch {
    // Not inside a request scope (e.g. direct unit call) — statusCode carries it.
  }
  return err;
}

async function getAdmin() {
  const { supabaseAdmin } = await import("./client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- location tables pending generated types
  return supabaseAdmin as any;
}

/**
 * Server-side enforcement of the on-duty location policy. Depends on
 * `requireActiveUser`, so it is used alone (TanStack de-duplicates auth).
 * Override passes are auditable via the engineer_gate_overrides table —
 * the middleware intentionally adds no extra context.
 */
export const requireFieldLocation = createMiddleware({ type: "function" })
  .middleware([requireActiveUser])
  .server(async ({ next, context }) => {
    const failClosed = (message: string) => {
      throw locationDenied(message, LOCATION_REQUIRED);
    };
    let admin: {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- location tables pending generated types
      from: (table: string) => any;
    };
    try {
      admin = await getAdmin();
    } catch (e) {
      console.error("[field-location] admin client unavailable (failing CLOSED):", e);
      return failClosed("Location check unavailable. Turn on GPS and internet, then try again.");
    }

    // F2: admins are exempt — the gate targets engineer writes, never review.
    try {
      const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
        _user_id: context.userId,
        _role: "admin",
      });
      if (roleErr) throw roleErr;
      if (isAdmin) return next();
    } catch (e) {
      console.error("[field-location] role lookup failed (failing CLOSED):", e);
      return failClosed("Location check unavailable. Turn on GPS and internet, then try again.");
    }

    // C7: never trust a client-supplied employee id — derive from auth.
    let employeeId: string;
    try {
      const { fetchMyIdentityAdmin } = await import("@/lib/engineer-identity");
      const identity = await fetchMyIdentityAdmin(admin as never, { userId: context.userId });
      if (identity.status === "ambiguous") {
        throw locationDenied(
          "Multiple employee rows match your login. Contact your administrator.",
          LOCATION_REQUIRED,
        );
      }
      if (identity.status !== "ok") {
        throw locationDenied(
          "No employee record is linked to this login. Contact your administrator.",
          LOCATION_REQUIRED,
        );
      }
      employeeId = (identity.employee as { id: string }).id;
    } catch (e) {
      if ((e as { code?: string } | null)?.code === LOCATION_REQUIRED) throw e;
      console.error("[field-location] identity lookup failed (failing CLOSED):", e);
      return failClosed("Location check unavailable. Turn on GPS and internet, then try again.");
    }

    // Fresh on-duty fix?
    try {
      const { data: live, error: liveErr } = await admin
        .from("engineer_live_status")
        .select("on_duty, last_seen_at")
        .eq("employee_id", employeeId)
        .maybeSingle();
      if (liveErr) throw liveErr;
      const row = live as { on_duty: boolean; last_seen_at: string | null } | null;
      if (!row?.on_duty) {
        throw locationDenied("You are off duty. Start duty to continue.", LOCATION_REQUIRED);
      }
      if (isFixFresh(row.last_seen_at, Date.now(), LOCATION_GRACE_MS)) return next();
    } catch (e) {
      if ((e as { code?: string } | null)?.code === LOCATION_REQUIRED) throw e;
      console.error("[field-location] live-status lookup failed (failing CLOSED):", e);
      return failClosed("Location check unavailable. Turn on GPS and internet, then try again.");
    }

    // Fix aged out — honour a live manager override, else block.
    try {
      const { data: overrides, error: ovErr } = await admin
        .from("engineer_gate_overrides")
        .select("id")
        .eq("employee_id", employeeId)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .limit(1);
      if (ovErr) throw ovErr;
      if ((overrides as unknown[]).length > 0) {
        return next();
      }
    } catch (e) {
      console.error("[field-location] override lookup failed (failing CLOSED):", e);
      return failClosed("Location check unavailable. Turn on GPS and internet, then try again.");
    }

    throw locationDenied(LOCATION_GATE_MESSAGE, LOCATION_REQUIRED);
  });
