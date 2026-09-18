import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { reportDbError } from "@/lib/format-error";

// Per-day Eng-Ops review on engineer_daily_logs (migration 20260927000001).
// Engineers hold SELECT-only on this table and never see these columns in
// their own UI; every write below runs service-role and gates on admin.

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- daily logs pending generated types
  return supabaseAdmin as any;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const reviewInput = z.object({
  employee_id: z.string().uuid(),
  log_date: z.string().regex(DATE_RE),
  status: z.enum(["Pending", "Paid", "Flagged"]),
  remarks: z.string().max(1000).optional(),
});

/**
 * Set one day's admin review. Flagging needs a remark; a blank remark
 * clears the stored one. Refuses when the engineer never logged that day
 * (there is no row to review). Mirrors setSettlementStatus semantics.
 */
export const setEngineerDayReview = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => reviewInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const remarks = (data.remarks ?? "").trim();
    if (data.status === "Flagged" && remarks === "") {
      throw new Error("Flagging a day needs a remark.");
    }
    const admin = await getAdmin();
    const { data: rows, error } = await admin
      .from("engineer_daily_logs")
      .update({
        admin_status: data.status,
        admin_remarks: remarks === "" ? null : remarks,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      } as never)
      .eq("employee_id", data.employee_id)
      .eq("log_date", data.log_date)
      .select("id, log_date");
    if (error) throw new Error(reportDbError("set day review", error));
    const updated = (Array.isArray(rows) ? rows : [])[0] as
      | { id: string; log_date: string }
      | undefined;
    if (!updated) {
      throw new Error(`No log for ${data.log_date} — the engineer hasn't logged that day yet.`);
    }
    // Audit is log-only — a failed audit must never fail the committed review.
    const { error: auditErr } = await admin.from("engineer_admin_audit").insert({
      actor: context.userId,
      action: "day_review.set",
      entity: "engineer_daily_logs",
      entity_id: updated.id,
      after: {
        employee_id: data.employee_id,
        log_date: updated.log_date,
        status: data.status,
        remarks: remarks === "" ? null : remarks,
      },
    });
    if (auditErr) console.error("[setEngineerDayReview] audit insert failed:", auditErr.message);
    return { ok: true as const, log_date: updated.log_date, status: data.status };
  });
