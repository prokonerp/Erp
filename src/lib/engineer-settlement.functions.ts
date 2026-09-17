import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { reportDbError } from "@/lib/format-error";
import {
  markPaidAllowed,
  payableForPeriod,
  resolveAdjustment,
  settlementStatusChangeAllowed,
} from "@/lib/engineersAdmin";

// Settlement write fns (TASK 3): upsert + approve/reject for
// engineer_conveyance_settlements (migration 20260925000001 §2).
// Reads recompute server-side via payableForPeriod + resolveAdjustment —
// the client never dictates totals. Overlap rejects surface the
// no_overlapping_settlements exclusion constraint; MEM-054: no deletes,
// locked periods are immutable.

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

const upsertSettlementInput = z.object({
  employee_id: z.string().uuid(),
  period_start: z.string().regex(DATE_RE),
  period_end: z.string().regex(DATE_RE),
  overridden_amount: z.number().nonnegative().max(100_000_000).optional(),
  reason: z.string().max(1000).optional(),
});

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "23505";
}

function isExclusionViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === "23P01";
}

type SettlementRow = {
  id: string;
  period_start: string;
  period_end: string;
  status: string | null;
  locked_at: string | null;
};

/**
 * Upsert one settlement period: recomputes km/amount/flat server-side,
 * applies the override only with a reason (resolveAdjustment rule),
 * rejects overlapping windows, and refuses locked rows. Upserts on the
 * (employee_id, period_start, period_end) unique key; reopened rows go
 * back to Pending.
 */
export const upsertSettlement = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => upsertSettlementInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.period_start > data.period_end) {
      throw new Error("Period start must be on or before period end.");
    }
    // Override wins only with a reason — without one the computed total stands.
    if (data.overridden_amount !== undefined) {
      const adj = resolveAdjustment(null, data.overridden_amount, data.reason);
      if (!adj.overridden) throw new Error("An override amount needs a reason.");
    }
    const admin = await getAdmin();

    // 1. Overlap / lock check (app fallback for no_overlapping_settlements).
    const { data: existing, error: readErr } = await admin
      .from("engineer_conveyance_settlements")
      .select("id, period_start, period_end, status, locked_at")
      .eq("employee_id", data.employee_id)
      .lte("period_start", data.period_end)
      .gte("period_end", data.period_start);
    if (readErr) throw new Error(reportDbError("read existing settlements", readErr));
    const rows = (Array.isArray(existing) ? existing : []) as SettlementRow[];
    const self = rows.find(
      (r) =>
        String(r.period_start).slice(0, 10) === data.period_start &&
        String(r.period_end).slice(0, 10) === data.period_end,
    );
    if (rows.some((r) => r !== self)) {
      throw new Error("Period overlaps an existing settlement — adjust the dates first.");
    }
    if (self) {
      const gate = settlementStatusChangeAllowed(
        { status: self.status, locked_at: self.locked_at },
        "Approved",
      );
      // Reuse the lock verdict for upserts too: locked/Approved rows are
      // immutable, so a same-window recompute must refuse rather than
      // silently rewrite history. (The nextStatus here only satisfies the
      // guard signature — upsert keeps its own Pending target.)
      if (!gate.ok) throw new Error(gate.error);
    }

    // 2. Server-side recompute from day logs + flat expenses + rates.
    const [{ data: days }, { data: expenses }, { data: rates }] = await Promise.all([
      admin
        .from("engineer_daily_logs")
        .select("log_date, morning_odometer, evening_odometer")
        .eq("employee_id", data.employee_id)
        .gte("log_date", data.period_start)
        .lte("log_date", data.period_end),
      admin
        .from("engineer_conveyance_expenses")
        .select("expense_date, charge_type, amount, receipt_path")
        .eq("employee_id", data.employee_id)
        .gte("expense_date", data.period_start)
        .lte("expense_date", data.period_end),
      admin
        .from("engineer_conveyance_rates")
        .select("employee_id, rate_per_km, effective_from")
        .eq("employee_id", data.employee_id)
        .lte("effective_from", data.period_end),
    ]);
    const payable = payableForPeriod({
      employeeId: data.employee_id,
      rates: Array.isArray(rates) ? rates : [],
      days: Array.isArray(days) ? days : [],
      expenses: Array.isArray(expenses) ? expenses : [],
    });
    const computedKm = Math.round(payable.perDay.reduce((s, d) => s + d.km, 0) * 10) / 10;
    const final = resolveAdjustment(payable.grandTotal, data.overridden_amount, data.reason);

    // 3. Upsert on the one-row-per-period key.
    const { data: row, error } = await admin
      .from("engineer_conveyance_settlements")
      .upsert(
        {
          employee_id: data.employee_id,
          period_start: data.period_start,
          period_end: data.period_end,
          computed_km: computedKm,
          computed_amount: payable.amountTotal,
          flat_expenses: payable.flatTotal,
          adjusted_amount: final.overridden ? final.value : null,
          adjustment_reason: final.overridden ? (data.reason as string).trim() : null,
          status: "Pending",
        },
        { onConflict: "employee_id,period_start,period_end" },
      )
      .select("id")
      .single();
    if (error) {
      if (isExclusionViolation(error)) {
        throw new Error("Period overlaps an existing settlement (no_overlapping_settlements).");
      }
      if (isUniqueViolation(error)) {
        throw new Error("A settlement already exists for this exact period — refresh and retry.");
      }
      throw new Error(reportDbError("upsert settlement", error));
    }
    const id = (row as { id: string }).id;
    // Audit is log-only — a failed audit must never fail the committed upsert.
    const { error: auditErr } = await admin.from("engineer_admin_audit").insert({
      actor: context.userId,
      action: "settlement.upsert",
      entity: "engineer_conveyance_settlements",
      entity_id: id,
      after: {
        employee_id: data.employee_id,
        period_start: data.period_start,
        period_end: data.period_end,
        computed_km: computedKm,
        computed_amount: payable.amountTotal,
        flat_expenses: payable.flatTotal,
        adjusted_amount: final.overridden ? final.value : null,
        overridden: final.overridden,
      },
    });
    if (auditErr) console.error("[upsertSettlement] audit insert failed:", auditErr.message);
    return {
      ok: true as const,
      id,
      computed_amount: payable.amountTotal,
      flat_expenses: payable.flatTotal,
      grand_total: payable.grandTotal,
      overridden: final.overridden,
    };
  });

const setStatusInput = z.object({
  settlement_id: z.string().uuid(),
  status: z.enum(["Approved", "Rejected"]),
  reason: z.string().max(1000).optional(),
});

/**
 * Approve (locks the period: approved_by/at + locked_at/by) or reject a
 * settlement. Refuses when locked_at is set; rejections need a reason.
 */
export const setSettlementStatus = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => setStatusInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const admin = await getAdmin();
    const { data: row, error: readErr } = await admin
      .from("engineer_conveyance_settlements")
      .select("id, employee_id, period_start, period_end, status, locked_at")
      .eq("id", data.settlement_id)
      .maybeSingle();
    if (readErr) throw new Error(reportDbError("read settlement", readErr));
    if (!row) throw new Error("Settlement not found.");
    const current = row as SettlementRow & { employee_id: string };
    const gate = settlementStatusChangeAllowed(
      { status: current.status, locked_at: current.locked_at },
      data.status,
    );
    if (!gate.ok) throw new Error(gate.error);
    const reason = (data.reason ?? "").trim();
    if (data.status === "Rejected" && reason === "") {
      throw new Error("A rejection needs a reason.");
    }
    const now = new Date().toISOString();
    const patch =
      data.status === "Approved"
        ? {
            status: "Approved",
            approved_by: context.userId,
            approved_at: now,
            locked_at: now,
            locked_by: context.userId,
          }
        : { status: "Rejected", notes: reason };
    const { error } = await admin
      .from("engineer_conveyance_settlements")
      .update(patch)
      .eq("id", data.settlement_id);
    if (error) throw new Error(reportDbError("update settlement status", error));
    // Audit is log-only.
    const { error: auditErr } = await admin.from("engineer_admin_audit").insert({
      actor: context.userId,
      action: "settlement.status",
      entity: "engineer_conveyance_settlements",
      entity_id: data.settlement_id,
      after: {
        from: current.status,
        to: data.status,
        employee_id: current.employee_id,
        period_start: String(current.period_start).slice(0, 10),
        period_end: String(current.period_end).slice(0, 10),
        reason: reason || null,
      },
    });
    if (auditErr) console.error("[setSettlementStatus] audit insert failed:", auditErr.message);
    return { ok: true as const, id: data.settlement_id, status: data.status };
  });

const markPaidInput = z.object({
  settlement_id: z.string().uuid(),
  payment_ref: z.string().max(200),
});

type PaidRow = SettlementRow & { paid_at: string | null; payment_ref: string | null };

/**
 * Mark an approved settlement paid: stamps paid_at (timestamptz now) +
 * payment_ref, and locks the row (locked_at/by) when still unlocked.
 * Requires a non-blank payment_ref; refuses unless status is Approved
 * (markPaidAllowed: unpaid + unlocked + Approved only). MEM-054: update
 * only, never a delete.
 */
export const markSettlementPaid = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => markPaidInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const ref = data.payment_ref.trim();
    if (ref === "") throw new Error("A payment reference is required to mark paid.");
    const admin = await getAdmin();
    const { data: row, error: readErr } = await admin
      .from("engineer_conveyance_settlements")
      .select("id, period_start, period_end, status, locked_at, paid_at, payment_ref")
      .eq("id", data.settlement_id)
      .maybeSingle();
    if (readErr) throw new Error(reportDbError("read settlement", readErr));
    if (!row) throw new Error("Settlement not found.");
    const current = row as PaidRow & { employee_id?: string };
    const gate = markPaidAllowed(current);
    if (!gate.ok) throw new Error(gate.error);
    const now = new Date().toISOString();
    const patch: Record<string, string> = { paid_at: now, payment_ref: ref };
    const lockedAt =
      typeof current.locked_at === "string" ? current.locked_at.trim() : current.locked_at;
    if (lockedAt == null || lockedAt === "") {
      patch.locked_at = now;
      patch.locked_by = context.userId;
    }
    const { error } = await admin
      .from("engineer_conveyance_settlements")
      .update(patch)
      .eq("id", data.settlement_id);
    if (error) throw new Error(reportDbError("mark settlement paid", error));
    // Audit is log-only.
    const { error: auditErr } = await admin.from("engineer_admin_audit").insert({
      actor: context.userId,
      action: "settlement.paid",
      entity: "engineer_conveyance_settlements",
      entity_id: data.settlement_id,
      after: {
        payment_ref: ref,
        paid_at: now,
        period_start: String(current.period_start).slice(0, 10),
        period_end: String(current.period_end).slice(0, 10),
      },
    });
    if (auditErr) console.error("[markSettlementPaid] audit insert failed:", auditErr.message);
    return { ok: true as const, id: data.settlement_id, paid_at: now, payment_ref: ref };
  });
