import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { fetchMyIdentityAdmin } from "@/lib/engineer-identity";
import { nextLiveStatus, type LiveRow } from "@/lib/field-location";
import { reportDbError } from "@/lib/format-error";

export const CONSENT_REQUIRED = "CONSENT_REQUIRED";
export const NOT_LINKED = "ENGINEER_NOT_LINKED";

/** Idle open sessions older than this are auto-closed on the next start. */
const STALE_SESSION_IDLE_MS = 2 * 3_600_000;

/** Anti-abuse ceiling: normal clients send ~2 pings/min. */
const MAX_PINGS_PER_MINUTE = 300;

/** Batch ceiling (matches the reconnect-storm flush size). */
const MAX_BATCH = 50;

async function assertOverrideManager(ctx: { supabase: unknown; userId: string }) {
  const db = ctx.supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data: isAdmin, error: adminErr } = await db.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (adminErr) throw new Error(reportDbError("override manager check", adminErr));
  if (isAdmin) return;
  const { data: canEdit, error: permErr } = await db.rpc("has_permission", {
    _user_id: ctx.userId,
    _module: "engineers",
    _action: "edit",
  });
  if (permErr) throw new Error(reportDbError("override manager check", permErr));
  if (!canEdit) throw new Error("Forbidden: admin or engineers-edit only");
}

/** Service-role client (bypasses RLS — every fn below gates on the caller). */
async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- location tables pending generated types
  return supabaseAdmin as any;
}

function claimsEmail(ctx: unknown): string | null {
  const email = (ctx as { claims?: { email?: unknown } } | null)?.claims?.email;
  return typeof email === "string" && email !== "" ? email : null;
}

/**
 * Resolve the caller's employee id via the central identity policy
 * (auth_user_id link first, unique-email fallback, fail loud on ambiguity).
 * Throws NOT_LINKED fail-closed when unlinked.
 */
async function myEmployeeId(
  admin: {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  } & { auth: unknown },
  ctx: { userId: string; claims?: unknown },
): Promise<string> {
  const identity = await fetchMyIdentityAdmin(admin as never, {
    userId: ctx.userId,
    emailHint: claimsEmail(ctx),
  });
  if (identity.status === "ambiguous") {
    throw new Error("Forbidden: multiple employee rows match your login. Contact admin.");
  }
  if (identity.status !== "ok") {
    const err = new Error(
      "No employee record is linked to this login. Contact your administrator.",
    );
    (err as Error & { code: string }).code = NOT_LINKED;
    throw err;
  }
  return (identity.employee as { id: string }).id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- location tables pending generated types
async function hasConsented(admin: { from: (t: string) => any }, employeeId: string) {
  const { data, error } = await admin
    .from("engineer_consent_events")
    .select("id")
    .eq("employee_id", employeeId)
    .limit(1);
  if (error) throw new Error(reportDbError("consent check", error));
  return (data as unknown[]).length > 0;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- location tables pending generated types
async function openSession(admin: { from: (t: string) => any }, employeeId: string) {
  const { data, error } = await admin
    .from("engineer_duty_sessions")
    .select("id, started_at")
    .eq("employee_id", employeeId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(reportDbError("open session lookup", error));
  return (data ?? null) as { id: string; started_at: string } | null;
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "23505";
}

/**
 * getMyLiveStatus — the engineer's own gate inputs: live row, open session,
 * consent state, and any active manager override. Admins get linked:false
 * (they use the admin roster, never this path).
 */
export const getMyLiveStatus = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .handler(async ({ context }) => {
    const admin = await getAdmin();
    const { data: isAdmin } = await (
      context.supabase as unknown as {
        rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }>;
      }
    ).rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (isAdmin) return { linked: false as const, isAdmin: true as const };
    const employeeId = await myEmployeeId(admin, context);
    const { data: live, error: liveErr } = await admin
      .from("engineer_live_status")
      .select("on_duty, last_lat, last_long, last_accuracy_m, last_seen_at, session_id, updated_at")
      .eq("employee_id", employeeId)
      .maybeSingle();
    if (liveErr) throw new Error(reportDbError("live status read", liveErr));
    const session = await openSession(admin, employeeId);
    const consented = await hasConsented(admin, employeeId);
    const { data: overrides, error: ovErr } = await admin
      .from("engineer_gate_overrides")
      .select("id, expires_at")
      .eq("employee_id", employeeId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .limit(1);
    if (ovErr) throw new Error(reportDbError("override check", ovErr));
    return {
      linked: true as const,
      employee_id: employeeId,
      live: (live ?? null) as {
        on_duty: boolean;
        last_lat: number | null;
        last_long: number | null;
        last_accuracy_m: number | null;
        last_seen_at: string | null;
        session_id: string | null;
        updated_at: string;
      } | null,
      open_session: session,
      consented,
      override_active: (overrides as unknown[]).length > 0,
    };
  });

const startDutyInput = z.object({
  device_label: z.string().max(120).optional(),
});

/**
 * startDutySession — open an on-duty window. Idempotent: a fresh open
 * session is resumed (double-tap / two-tab safe via the partial unique
 * index); an idle-stale one is auto-closed first. Requires consent.
 */
export const startDutySession = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => startDutyInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const employeeId = await myEmployeeId(admin, context);
    if (!(await hasConsented(admin, employeeId))) {
      const err = new Error("Location consent is required before starting duty.");
      (err as Error & { code: string }).code = CONSENT_REQUIRED;
      throw err;
    }
    const existing = await openSession(admin, employeeId);
    if (existing) {
      const { data: live } = await admin
        .from("engineer_live_status")
        .select("last_seen_at")
        .eq("employee_id", employeeId)
        .maybeSingle();
      const lastSeen = (live as { last_seen_at?: string | null } | null)?.last_seen_at;
      const idleMs = lastSeen ? Date.now() - Date.parse(lastSeen) : Number.POSITIVE_INFINITY;
      if (Number.isFinite(idleMs) && idleMs <= STALE_SESSION_IDLE_MS) {
        // Resume must also restore liveness — otherwise the client
        // recomputes off-duty from the stale live row and Start loops.
        const { error: resumeErr } = await admin.from("engineer_live_status").upsert(
          {
            employee_id: employeeId,
            on_duty: true,
            session_id: existing.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "employee_id" },
        );
        if (resumeErr) throw new Error(reportDbError("live status resume", resumeErr));
        return { session_id: existing.id, resumed: true as const };
      }
      // Stale (app killed, no End shift): close it as auto_closed, open fresh.
      const { error: closeErr } = await admin
        .from("engineer_duty_sessions")
        .update({ ended_at: new Date().toISOString(), end_reason: "auto_closed" })
        .eq("id", existing.id)
        .is("ended_at", null);
      if (closeErr) throw new Error(reportDbError("auto-close stale session", closeErr));
    }
    const { data: row, error } = await admin
      .from("engineer_duty_sessions")
      .insert({ employee_id: employeeId, device_label: data.device_label?.trim() || null })
      .select("id")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        // Lost the race with another tab/device: resume the winner.
        const winner = await openSession(admin, employeeId);
        if (winner) return { session_id: winner.id, resumed: true as const };
      }
      throw new Error(reportDbError("start duty session", error));
    }
    const sessionId = (row as { id: string }).id;
    const { error: liveErr } = await admin.from("engineer_live_status").upsert(
      {
        employee_id: employeeId,
        on_duty: true,
        session_id: sessionId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id" },
    );
    if (liveErr) throw new Error(reportDbError("live status upsert", liveErr));
    return { session_id: sessionId, resumed: false as const };
  });

const pingInput = z.object({
  client_ping_id: z.string().uuid(),
  lat: z.number().min(-90).max(90),
  long: z.number().min(-180).max(180),
  accuracy: z.number().min(0).nullable(),
  captured_at: z.string().datetime(),
  ticket_id: z.string().uuid().nullable().optional(),
  source: z.enum(["heartbeat", "arrive", "depart", "fsr", "photo", "manual"]).default("heartbeat"),
});

const recordPingsInput = z.object({
  session_id: z.string().uuid().nullable().optional(),
  pings: z.array(pingInput).min(1).max(MAX_BATCH),
});

/**
 * recordPings — idempotent batch insert (client_ping_id upsert → exactly
 * once) + live-status refresh from the newest fix. Server-side rate cap.
 */
export const recordPings = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => recordPingsInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const employeeId = await myEmployeeId(admin, context);
    const { count, error: countErr } = await admin
      .from("engineer_location_pings")
      .select("id", { count: "exact", head: true })
      .eq("employee_id", employeeId)
      .gte("received_at", new Date(Date.now() - 60_000).toISOString());
    if (countErr) throw new Error(reportDbError("ping rate check", countErr));
    if ((count ?? 0) + data.pings.length > MAX_PINGS_PER_MINUTE) {
      throw new Error("Rate limited: too many location pings. Slow down and retry.");
    }
    const open = await openSession(admin, employeeId);
    const openSessionId = open?.id ?? null;
    const rows = data.pings.map((p) => ({
      client_ping_id: p.client_ping_id,
      employee_id: employeeId,
      session_id: data.session_id ?? openSessionId,
      ticket_id: p.ticket_id ?? null,
      lat: p.lat,
      long: p.long,
      accuracy_m: p.accuracy,
      captured_at: p.captured_at,
      source: p.source,
    }));
    const { data: inserted, error } = await admin
      .from("engineer_location_pings")
      .upsert(rows, { onConflict: "client_ping_id", ignoreDuplicates: true })
      .select("client_ping_id");
    if (error) throw new Error(reportDbError("record pings", error));
    const latest = [...data.pings].sort((a, b) => (a.captured_at < b.captured_at ? 1 : -1))[0];
    const { data: currentLive } = await admin
      .from("engineer_live_status")
      .select("on_duty, last_seen_at, last_lat, last_long, last_accuracy_m, session_id")
      .eq("employee_id", employeeId)
      .maybeSingle();
    const next = nextLiveStatus({
      current: (currentLive as LiveRow | null) ?? null,
      latest: {
        lat: latest.lat,
        long: latest.long,
        accuracy: latest.accuracy,
        captured_at: latest.captured_at,
      },
      openSessionId,
    });
    // No open session and no live row: stay out of live_status entirely —
    // off-duty fixes are stored, never surfaced as presence.
    if (openSessionId != null || currentLive != null) {
      const { error: liveErr } = await admin.from("engineer_live_status").upsert(
        {
          employee_id: employeeId,
          ...next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "employee_id" },
      );
      if (liveErr) throw new Error(reportDbError("live status refresh", liveErr));
    }
    return {
      received: data.pings.length,
      stored: (inserted as unknown[] | null)?.length ?? 0,
    };
  });

const endDutyInput = z.object({
  session_id: z.string().uuid(),
});

/** endDutySession — close the window; live flips to off-duty (last fix kept). */
export const endDutySession = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => endDutyInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const employeeId = await myEmployeeId(admin, context);
    const { data: closed, error } = await admin
      .from("engineer_duty_sessions")
      .update({ ended_at: new Date().toISOString(), end_reason: "completed" })
      .eq("id", data.session_id)
      .eq("employee_id", employeeId)
      .is("ended_at", null)
      .select("id");
    if (error) throw new Error(reportDbError("end duty session", error));
    if (!closed || (closed as unknown[]).length === 0) {
      return { ended: false as const, reason: "already_closed" as const };
    }
    const { error: liveErr } = await admin
      .from("engineer_live_status")
      .update({ on_duty: false, session_id: null, updated_at: new Date().toISOString() })
      .eq("employee_id", employeeId);
    if (liveErr) throw new Error(reportDbError("live status off-duty", liveErr));
    return { ended: true as const };
  });

const consentInput = z.object({
  version: z.string().min(1).max(40),
  user_agent: z.string().max(300).optional(),
});

/** recordLocationConsent — append-only BYOD consent (immutable by RLS). */
export const recordLocationConsent = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => consentInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const employeeId = await myEmployeeId(admin, context);
    if (await hasConsented(admin, employeeId)) return { already: true as const };
    const { error } = await admin.from("engineer_consent_events").insert({
      employee_id: employeeId,
      version: data.version,
      user_agent: data.user_agent ?? null,
    });
    if (error) {
      if (isUniqueViolation(error)) return { already: true as const };
      throw new Error(reportDbError("record consent", error));
    }
    return { already: false as const };
  });

const grantOverrideInput = z.object({
  employee_id: z.string().uuid(),
  minutes: z.number().int().min(5).max(120),
  reason: z.string().trim().min(1).max(280),
});

/**
 * grantGateOverride — time-boxed manager pass for dead zones. 5–120 min,
 * reason mandatory, audit-logged. Never puts anyone on duty by itself.
 */
export const grantGateOverride = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => grantOverrideInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertOverrideManager(context);
    const admin = await getAdmin();
    const expiresAt = new Date(Date.now() + data.minutes * 60_000).toISOString();
    const { data: row, error } = await admin
      .from("engineer_gate_overrides")
      .insert({
        employee_id: data.employee_id,
        granted_by: context.userId,
        reason: data.reason,
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .single();
    if (error) throw new Error(reportDbError("grant gate override", error));
    const inserted = row as { id: string; expires_at: string };
    const { error: auditErr } = await admin.from("engineer_admin_audit").insert({
      actor: context.userId,
      action: "gate-override.grant",
      entity: "engineer_gate_overrides",
      entity_id: inserted.id,
      after: { employee_id: data.employee_id, minutes: data.minutes, reason: data.reason },
    });
    if (auditErr) console.error("[grantGateOverride] audit insert failed:", auditErr.message);
    return { ok: true as const, id: inserted.id, expires_at: inserted.expires_at };
  });

const revokeOverrideInput = z.object({
  id: z.string().uuid(),
});

/** revokeGateOverride — kill an active override early (audited). */
export const revokeGateOverride = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => revokeOverrideInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertOverrideManager(context);
    const admin = await getAdmin();
    const { error } = await admin
      .from("engineer_gate_overrides")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("revoked_at", null);
    if (error) throw new Error(reportDbError("revoke gate override", error));
    const { error: auditErr } = await admin.from("engineer_admin_audit").insert({
      actor: context.userId,
      action: "gate-override.revoke",
      entity: "engineer_gate_overrides",
      entity_id: data.id,
      after: null,
    });
    if (auditErr) console.error("[revokeGateOverride] audit insert failed:", auditErr.message);
    return { ok: true as const };
  });
