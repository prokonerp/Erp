import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { mergePartLines, stageFsrParts, type FsrPartInput } from "@/lib/sync-fsr-parts";
import type { PartLine } from "@/lib/tickets";

const syncInput = z.object({
  ticketId: z.string().uuid(),
});

/** FSR part_replacements rows are stored snake_case; tolerate camelCase too. */
export function toStageInput(e: Record<string, unknown>): FsrPartInput {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = e[k];
      if (typeof v === "string" && v.trim()) return v;
    }
    return null;
  };
  const qtyRaw = e.qty;
  return {
    item: pick("item"),
    qty:
      typeof qtyRaw === "number"
        ? qtyRaw
        : typeof qtyRaw === "string" && qtyRaw.trim() !== "" && Number.isFinite(Number(qtyRaw))
          ? Number(qtyRaw)
          : null,
    oldSrNo: pick("oldSrNo", "old_sr_no"),
    newSrNo: pick("newSrNo", "new_sr_no"),
  };
}

function asPartLines(v: unknown): PartLine[] {
  return Array.isArray(v) ? (v as PartLine[]) : [];
}

export const syncFsrPartsToTicket = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => syncInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("tickets")
      .select(
        "id, updated_at, defective_parts_details, good_parts_details, assigned_employee_id, assigned_engineer_name",
      )
      .eq("id", data.ticketId)
      .maybeSingle();
    if (ticketErr) throw new Error(ticketErr.message);
    if (!ticket) throw new Error(`NotFound: ticket ${data.ticketId} not found`);

    // Gate: admin via has_role OR the engineer assigned to this ticket
    // (FK-first on assigned_employee_id, name fallback on assigned_engineer_name).
    const { data: isAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) {
      // Identity by auth_user_id first (exact); email fallback for legacy rows.
      // Fast path: verified JWT email (skips the slow GoTrue admin lookup).
      const claimsEmail = (context as unknown as { claims?: { email?: unknown } })?.claims?.email;
      let callerEmail = typeof claimsEmail === "string" && claimsEmail !== "" ? claimsEmail : null;
      let caller: { id: string; name: string | null } | null = null;
      const { data: empByAuth } = await supabaseAdmin
        .from("employees")
        .select("id, name")
        .eq("auth_user_id", context.userId)
        .eq("active", true)
        .maybeSingle();
      if (empByAuth) {
        caller = empByAuth as { id: string; name: string | null };
      } else {
        if (!callerEmail) {
          const { data: authData } = await supabaseAdmin.auth.admin.getUserById(context.userId);
          callerEmail = authData?.user?.email ?? null;
        }
        if (!callerEmail) throw new Error("Forbidden: could not resolve your account email");
        const { data: empByEmail } = await supabaseAdmin
          .from("employees")
          .select("id, name")
          .eq("email", callerEmail)
          .eq("active", true)
          .maybeSingle();
        if (!empByEmail) {
          throw new Error("Forbidden: only an admin or the assigned engineer may sync");
        }
        caller = empByEmail as { id: string; name: string | null };
      }
      const row = ticket as unknown as {
        assigned_employee_id: string | null;
        assigned_engineer_name: string | null;
      };
      const fkMatch =
        !!caller && !!row.assigned_employee_id && row.assigned_employee_id === caller.id;
      // Name fallback: the display name may be shared by several employees, so it
      // only counts when exactly one active employee matches lower(trim(name)).
      let nameMatch = false;
      if (!fkMatch) {
        const callerName = ((caller as { name?: string | null } | null)?.name ?? "").trim();
        if (
          !!caller &&
          !!row.assigned_engineer_name &&
          callerName !== "" &&
          row.assigned_engineer_name.trim().toLowerCase() === callerName.toLowerCase()
        ) {
          const { data: sameNamed, error: sameNamedErr } = await supabaseAdmin
            .from("employees")
            .select("id, name")
            .eq("active", true);
          if (sameNamedErr) throw new Error(sameNamedErr.message);
          const dupes = (sameNamed ?? []).filter(
            (r) =>
              ((r as unknown as { name?: string | null }).name ?? "").trim().toLowerCase() ===
              callerName.toLowerCase(),
          );
          nameMatch = dupes.length === 1;
        }
      }
      if (!fkMatch && !nameMatch) {
        throw new Error("Forbidden: only an admin or the assigned engineer may sync FSR parts");
      }
    }

    // Read ALL field service reports for the ticket and stage every entry.
    const { data: fsrRows, error: fsrErr } = await supabaseAdmin
      .from("field_service_reports")
      .select("part_replacements")
      .eq("ticket_id", data.ticketId);
    if (fsrErr) throw new Error(fsrErr.message);
    const entries: FsrPartInput[] = [];
    for (const r of fsrRows ?? []) {
      const list = (r as { part_replacements?: unknown }).part_replacements;
      if (!Array.isArray(list)) continue;
      for (const e of list) {
        if (e && typeof e === "object") entries.push(toStageInput(e as Record<string, unknown>));
      }
    }
    const { defective, good, skipped } = stageFsrParts(entries);

    // Additive-only merge into the ticket's part lists.
    const t = ticket as unknown as {
      defective_parts_details: unknown;
      good_parts_details: unknown;
    };
    const defRes = mergePartLines(asPartLines(t.defective_parts_details), defective);
    const goodRes = mergePartLines(asPartLines(t.good_parts_details), good);

    // Single update of the tickets row. Flags only ever flip true, never false.
    const update: Record<string, unknown> = {
      defective_parts_details: defRes.merged,
      good_parts_details: goodRes.merged,
    };
    if (defRes.merged.length > 0) update.defective_parts_received = true;
    if (goodRes.merged.length > 0) {
      update.good_parts_used = true;
      update.parts_used = true;
    }
    // Optimistic concurrency: tickets_touch auto-bumps updated_at on every
    // UPDATE, so a zero-row match means an admin auto-save touched the ticket
    // mid-sync. Re-sync is idempotent, so the caller can safely retry.
    const readUpdatedAt = (ticket as unknown as { updated_at: string }).updated_at;
    const { data: updRows, error: updErr } = await supabaseAdmin
      .from("tickets")
      .update(update as never)
      .eq("id", data.ticketId)
      .eq("updated_at", readUpdatedAt)
      .select("id");
    if (updErr) throw new Error(updErr.message);
    if (!updRows || updRows.length === 0) {
      // Optimistic-concurrency miss (an admin auto-save bumped updated_at
      // mid-sync). Re-read once and retry — merge is additive/idempotent,
      // so the retry converges instead of failing to a warning toast.
      const { data: fresh, error: freshErr } = await supabaseAdmin
        .from("tickets")
        .select("defective_parts_details, good_parts_details, updated_at")
        .eq("id", data.ticketId)
        .maybeSingle();
      if (freshErr) throw new Error(freshErr.message);
      if (!fresh) throw new Error(`NotFound: ticket ${data.ticketId} not found`);
      const f = fresh as unknown as {
        defective_parts_details: unknown;
        good_parts_details: unknown;
        updated_at: string;
      };
      const defRetry = mergePartLines(asPartLines(f.defective_parts_details), defective);
      const goodRetry = mergePartLines(asPartLines(f.good_parts_details), good);
      const retryUpdate: Record<string, unknown> = {
        defective_parts_details: defRetry.merged,
        good_parts_details: goodRetry.merged,
      };
      if (defRetry.merged.length > 0) retryUpdate.defective_parts_received = true;
      if (goodRetry.merged.length > 0) {
        retryUpdate.good_parts_used = true;
        retryUpdate.parts_used = true;
      }
      const { data: retryRows, error: retryErr } = await supabaseAdmin
        .from("tickets")
        .update(retryUpdate as never)
        .eq("id", data.ticketId)
        .eq("updated_at", f.updated_at)
        .select("id");
      if (retryErr) throw new Error(retryErr.message);
      if (!retryRows || retryRows.length === 0) {
        throw new Error("Ticket changed while syncing — please retry (Sync FSR parts)");
      }
      return {
        ticketId: data.ticketId,
        defectiveAdded: defRetry.added,
        goodAdded: goodRetry.added,
        defectiveTotal: defRetry.merged.length,
        goodTotal: goodRetry.merged.length,
        skipped,
      };
    }

    return {
      ticketId: data.ticketId,
      defectiveAdded: defRes.added,
      goodAdded: goodRes.added,
      defectiveTotal: defRes.merged.length,
      goodTotal: goodRes.merged.length,
      skipped,
    };
  });
