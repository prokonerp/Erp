import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { reportDbError } from "@/lib/format-error";

// Rates are append-only (MEM-054: no deletes): corrections are new rows,
// never updates — the one-row-per-day rule is enforced by the DB constraint
// engineer_conveyance_rates_one_per_day (migration 20260925000001) plus the
// client-side validateRateAppend guard in @/lib/engineersAdmin.

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(reportDbError("admin check", error));
  if (!data) throw new Error("Forbidden: admin only");
}

/** Service-role client (bypasses RLS — every fn below gates on the caller). */
async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- conveyance tables pending generated types
  return supabaseAdmin as any;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const upsertRateInput = z.object({
  employee_id: z.string().uuid(),
  rate_per_km: z.number().positive().max(100000),
  effective_from: z.string().regex(DATE_RE),
  notes: z.string().max(500).optional(),
});

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "23505";
}

/**
 * Append one rate row (never update/delete). A same-day second row for the
 * employee hits the unique constraint and surfaces as a friendly error.
 */
export const upsertEngineerRate = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => upsertRateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const admin = await getAdmin();
    const { data: row, error } = await admin
      .from("engineer_conveyance_rates")
      .insert({
        employee_id: data.employee_id,
        rate_per_km: data.rate_per_km,
        effective_from: data.effective_from,
        notes: data.notes?.trim() || null,
        created_by: context.userId,
      })
      .select("id, effective_from")
      .single();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new Error(
          `A rate already exists for ${data.effective_from} — append a new day instead.`,
        );
      }
      throw new Error(reportDbError("append engineer rate", error));
    }
    const inserted = row as { id: string; effective_from: string };
    // Audit is a log-only side effect — a failed audit must never fail the
    // already-committed append (retry would then hit the unique constraint).
    const { error: auditErr } = await admin.from("engineer_admin_audit").insert({
      actor: context.userId,
      action: "rate.append",
      entity: "engineer_conveyance_rates",
      entity_id: inserted.id,
      after: {
        employee_id: data.employee_id,
        rate_per_km: data.rate_per_km,
        effective_from: inserted.effective_from,
      },
    });
    if (auditErr) console.error("[upsertEngineerRate] audit insert failed:", auditErr.message);
    return { ok: true as const, id: inserted.id, effective_from: inserted.effective_from };
  });

const backfillInput = z.object({
  employee_id: z.string().uuid(),
  rate_per_km: z.number().positive().max(100000),
  from: z.string().regex(DATE_RE),
  to: z.string().regex(DATE_RE),
});

const MAX_BACKFILL_DAYS = 366;

function eachDay(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const days: string[] = [];
  let cur = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  while (cur <= end) {
    days.push(new Date(cur).toISOString().slice(0, 10));
    cur += 86_400_000;
  }
  return days;
}

/**
 * Bulk backfill: insert one row per day in [from, to], skipping days that
 * already have a rate (append-only — existing rows are never touched).
 */
export const backfillEngineerRates = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => backfillInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.from > data.to) throw new Error("Backfill start must be on or before end.");
    const days = eachDay(data.from, data.to);
    if (days.length > MAX_BACKFILL_DAYS) {
      throw new Error(`Backfill window too large — max ${MAX_BACKFILL_DAYS} days.`);
    }
    const admin = await getAdmin();
    const { data: existing, error: readErr } = await admin
      .from("engineer_conveyance_rates")
      .select("effective_from")
      .eq("employee_id", data.employee_id)
      .gte("effective_from", data.from)
      .lte("effective_from", data.to);
    if (readErr) throw new Error(reportDbError("backfill read existing rates", readErr));
    const taken = new Set(
      ((existing ?? []) as { effective_from: string }[]).map((r) =>
        String(r.effective_from).slice(0, 10),
      ),
    );
    const missing = days.filter((d) => !taken.has(d));
    if (missing.length > 0) {
      const { error: insErr } = await admin.from("engineer_conveyance_rates").insert(
        missing.map((d) => ({
          employee_id: data.employee_id,
          rate_per_km: data.rate_per_km,
          effective_from: d,
          created_by: context.userId,
        })),
      );
      if (insErr) {
        if (isUniqueViolation(insErr)) {
          throw new Error("Some days were filled by another admin — refresh and retry.");
        }
        throw new Error(reportDbError("backfill insert rates", insErr));
      }
    }
    const skipped = days.filter((d) => taken.has(d));
    const { error: auditErr } = await admin.from("engineer_admin_audit").insert({
      actor: context.userId,
      action: "rate.backfill",
      entity: "engineer_conveyance_rates",
      entity_id: null,
      after: {
        employee_id: data.employee_id,
        rate_per_km: data.rate_per_km,
        from: data.from,
        to: data.to,
        inserted: missing.length,
        skipped: skipped.length,
        skipped_dates: skipped,
      },
    });
    if (auditErr) console.error("[backfillEngineerRates] audit insert failed:", auditErr.message);
    return { ok: true as const, inserted: missing.length, skipped: skipped.length, skipped_dates: skipped };
  });
