import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { mergePartLines, stageFsrParts, type FsrPartInput } from "@/lib/sync-fsr-parts";
import type { PartLine } from "@/lib/tickets";

const syncInput = z.object({
  ticketId: z.string().uuid(),
});

/** FSR part_replacements rows are stored snake_case; tolerate camelCase too. */
function toStageInput(e: Record<string, unknown>): FsrPartInput {
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
    qty: typeof qtyRaw === "number" ? qtyRaw : null,
    oldSrNo: pick("oldSrNo", "old_sr_no"),
    oldBarcode: pick("oldBarcode", "old_barcode"),
    newSrNo: pick("newSrNo", "new_sr_no"),
    newChallan: pick("newChallan", "new_challan"),
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
        "id, defective_parts_details, good_parts_details, assigned_employee_id, assigned_engineer_name",
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
      const { data: authData } = await supabaseAdmin.auth.admin.getUserById(context.userId);
      const callerEmail = authData?.user?.email;
      if (!callerEmail) throw new Error("Forbidden: could not resolve your account email");
      const { data: caller } = await supabaseAdmin
        .from("employees")
        .select("id, name")
        .eq("email", callerEmail)
        .eq("active", true)
        .maybeSingle();
      const row = ticket as unknown as {
        assigned_employee_id: string | null;
        assigned_engineer_name: string | null;
      };
      const fkMatch =
        !!caller && !!row.assigned_employee_id && row.assigned_employee_id === caller.id;
      const nameMatch =
        !!caller &&
        !!row.assigned_engineer_name &&
        !!(caller as { name?: string | null }).name &&
        row.assigned_engineer_name.trim().toLowerCase() ===
          ((caller as { name: string }).name ?? "").trim().toLowerCase();
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
    const { defective, good } = stageFsrParts(entries);

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
    const { error: updErr } = await supabaseAdmin
      .from("tickets")
      .update(update as never)
      .eq("id", data.ticketId);
    if (updErr) throw new Error(updErr.message);

    return {
      ticketId: data.ticketId,
      defectiveAdded: defRes.added,
      goodAdded: goodRes.added,
      defectiveTotal: defRes.merged.length,
      goodTotal: goodRes.merged.length,
    };
  });
