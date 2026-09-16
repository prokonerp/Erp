import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { reportDbError } from "@/lib/format-error";

/** Engineer-work activity kinds that an admin reset is allowed to delete. Exact set. */
export const RESET_ACTIVITY_KINDS = [
  "customer_verify",
  "equipment_verify",
  "photo",
  "note",
  "acknowledge",
  "arrival",
  "departure",
  "signature",
] as const;
export type ResetActivityKind = (typeof RESET_ACTIVITY_KINDS)[number];

/** Activity kinds that must never be deleted by a reset. */
export const RESET_FORBIDDEN_KINDS = ["created", "status"] as const;

/** Tables that a reset must never touch. */
export const RESET_FORBIDDEN_TABLES = [
  "ticket_assignment_history",
  "tickets",
  "ims_stock_items",
] as const;

/** Storage filename prefixes the reset is allowed to remove. */
export const RESET_STORAGE_KIND_ALLOWLIST = [
  "equipment_correction",
  "issue_photo",
  "customer_signature",
] as const;

/**
 * Allow-listed tables touched by this module. Exported so pure scoping tests
 * can assert forbidden tables are never referenced (contains no forbidden names).
 */
export const RESET_MODULE_SOURCE =
  "ticket_customer_verifications|ticket_equipment_verifications|ticket_activities|ticket_visits|field_service_reports|ticket-attachments";

export type ResetScope = {
  ticketId: string;
  customerFilter: { ticket_id: string };
  equipmentFilter: { ticket_id: string };
  activityFilter: { ticket_id: string; kindIn: string[] };
  visitFilter: { ticket_id: string };
  fsrFilter: { ticket_id: string };
  storagePrefix: string;
  storageKindAllowlist: string[];
};

/** Pure helper: single source of scoping truth used by the serverFn. */
export function buildResetScope(ticket_id: string): ResetScope {
  return {
    ticketId: ticket_id,
    customerFilter: { ticket_id },
    equipmentFilter: { ticket_id },
    activityFilter: { ticket_id, kindIn: [...RESET_ACTIVITY_KINDS] },
    visitFilter: { ticket_id },
    fsrFilter: { ticket_id },
    storagePrefix: `ticket/${ticket_id}/`,
    storageKindAllowlist: [...RESET_STORAGE_KIND_ALLOWLIST],
  };
}

/**
 * Pure helper: true only for exact file paths under ticket/{id}/ whose
 * filename starts with equipment_correction-, issue_photo-, or
 * customer_signature-. Never true for a bare prefix (prefix wipe guard).
 */
export function isResetStoragePathAllowed(path: string, ticket_id: string): boolean {
  const prefix = `ticket/${ticket_id}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  // Must be a file inside a subfolder (date/name), never the prefix itself.
  if (!rest || !rest.includes("/") || rest.endsWith("/")) return false;
  const filename = rest.split("/").pop() || "";
  return RESET_STORAGE_KIND_ALLOWLIST.some((k) => filename.startsWith(`${k}-`));
}

async function assertAdmin(supabaseAdmin: any, userId: string) {
  const { data, error } = await supabaseAdmin.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(reportDbError("reset admin check", error));
  if (!data) throw new Error("Forbidden: admin only");
}

const resetInput = z.object({
  ticket_id: z.string().uuid(),
  dryRun: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

export const resetTicketEngineerWork = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => resetInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertAdmin(supabaseAdmin, context.userId);
    const scope = buildResetScope(data.ticket_id);

    // (a) Select verification rows for ticket_id (collect photo_path).
    const [
      { data: customerRow },
      { data: equipmentRow },
      { data: activityRows },
      { data: visitRow },
      { data: fsrRows },
    ] = await Promise.all([
      supabaseAdmin
        .from("ticket_customer_verifications")
        .select("ticket_id")
        .eq("ticket_id", scope.ticketId)
        .maybeSingle(),
      supabaseAdmin
        .from("ticket_equipment_verifications")
        .select("ticket_id, photo_path")
        .eq("ticket_id", scope.ticketId)
        .maybeSingle(),
      supabaseAdmin
        .from("ticket_activities")
        .select("id")
        .eq("ticket_id", scope.ticketId)
        .in("kind", [...RESET_ACTIVITY_KINDS]),
      supabaseAdmin
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ticket_visits pending generated types (migration 20260917000003)
        .from("ticket_visits" as any)
        .select("ticket_id")
        .eq("ticket_id", scope.ticketId)
        .maybeSingle(),
      supabaseAdmin
        .from("field_service_reports")
        .select("id, customer_signature_path")
        .eq("ticket_id", scope.ticketId),
    ]);
    const customerRows = customerRow ? 1 : 0;
    const equipmentRows = equipmentRow ? 1 : 0;
    const activityCount = (activityRows || []).length;
    const visitRows = visitRow ? 1 : 0;
    const fsrRowsCount = (fsrRows || []).length;
    const dbPhotoPath = (equipmentRow as { photo_path?: string | null } | null)?.photo_path ?? null;
    const fsrSignaturePaths = ((fsrRows || []) as { customer_signature_path?: string | null }[])
      .map((r) => r.customer_signature_path)
      .filter((p): p is string => !!p && isResetStoragePathAllowed(p, scope.ticketId));
    const photoPaths = [
      ...(dbPhotoPath && isResetStoragePathAllowed(dbPhotoPath, scope.ticketId)
        ? [dbPhotoPath]
        : []),
      ...fsrSignaturePaths.filter((p) => p !== dbPhotoPath),
    ];

    // Dry-run: counts only, no deletes.
    if (data.dryRun) {
      return {
        customerRows,
        equipmentRows,
        activityRows: activityCount,
        visitRows,
        fsrRows: fsrRowsCount,
        photoPaths,
      };
    }

    // (b) Delete customer verifications for this ticket only.
    const { error: delCustErr } = await supabaseAdmin
      .from("ticket_customer_verifications")
      .delete()
      .eq("ticket_id", scope.ticketId);
    if (delCustErr)
      throw new Error(reportDbError("reset delete customer verifications", delCustErr));

    // (c) Delete equipment verifications for this ticket only.
    const { error: delEqErr } = await supabaseAdmin
      .from("ticket_equipment_verifications")
      .delete()
      .eq("ticket_id", scope.ticketId);
    if (delEqErr) throw new Error(reportDbError("reset delete equipment verifications", delEqErr));

    // (d) Delete allow-listed engineer-work activities only. NEVER created/status.
    const { data: deletedActivities, error: delActErr } = await supabaseAdmin
      .from("ticket_activities")
      .delete()
      .eq("ticket_id", scope.ticketId)
      .in("kind", [...RESET_ACTIVITY_KINDS])
      .select("id");
    if (delActErr) throw new Error(reportDbError("reset delete activities", delActErr));

    // (e) Delete the site-visit row for this ticket only.
    const { error: delVisitErr } = await supabaseAdmin
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ticket_visits pending generated types (migration 20260917000003)
      .from("ticket_visits" as any)
      .delete()
      .eq("ticket_id", scope.ticketId);
    if (delVisitErr) throw new Error(reportDbError("reset delete visit", delVisitErr));

    // (f) Delete field service reports for this ticket only. They belong to
    // the invalidated work run; the kind=verification_reset audit row below
    // is the preserved record.
    const { data: deletedFsr, error: delFsrErr } = await supabaseAdmin
      .from("field_service_reports")
      .delete()
      .eq("ticket_id", scope.ticketId)
      .select("id");
    if (delFsrErr) throw new Error(reportDbError("reset delete fsr", delFsrErr));

    // (g) Remove exact photo files only (allow-listed names under ticket/{id}/).
    const removedPhotos: string[] = [];
    try {
      const toRemove = [...photoPaths];
      // List date subfolders under ticket/{id}/ and collect allow-listed files.
      const { data: dayFolders } = await supabaseAdmin.storage
        .from("ticket-attachments")
        .list(`ticket/${scope.ticketId}`);
      for (const folder of dayFolders || []) {
        const name = (folder as { name?: string }).name;
        if (!name) continue;
        const { data: files } = await supabaseAdmin.storage
          .from("ticket-attachments")
          .list(`ticket/${scope.ticketId}/${name}`);
        for (const f of files || []) {
          const fname = (f as { name?: string }).name;
          if (!fname) continue;
          const full = `ticket/${scope.ticketId}/${name}/${fname}`;
          if (isResetStoragePathAllowed(full, scope.ticketId) && !toRemove.includes(full)) {
            toRemove.push(full);
          }
        }
      }
      if (toRemove.length > 0) {
        const { error: rmErr } = await supabaseAdmin.storage
          .from("ticket-attachments")
          .remove(toRemove);
        if (rmErr) throw rmErr;
        removedPhotos.push(...toRemove);
      }
    } catch (e) {
      console.warn("[resetTicketEngineerWork] storage cleanup skipped:", e);
    }

    // (h) Audit trail: assignment and status are preserved (no ticket row touched).
    const notes =
      `Engineer work reset by admin ${context.userId}: ` +
      `customer=${customerRows} equipment=${equipmentRows} activities=${(deletedActivities || []).length} ` +
      `visits=${visitRows} fsr=${(deletedFsr || []).length} (customer signature cleared) ` +
      `photos=${removedPhotos.length}. Reason: ${data.reason?.trim() || "—"}. ` +
      `Assignment and status preserved.`;
    const { data: resetRow, error: resetErr } = await supabaseAdmin
      .from("ticket_activities")
      .insert({
        ticket_id: scope.ticketId,
        kind: "verification_reset",
        notes,
        actor: context.userId,
      })
      .select("id")
      .single();
    if (resetErr) throw new Error(reportDbError("reset audit insert", resetErr));

    return {
      deletedCustomer: customerRows,
      deletedEquipment: equipmentRows,
      deletedActivities: (deletedActivities || []).length,
      deletedVisits: visitRows,
      deletedFsr: (deletedFsr || []).length,
      removedPhotos,
      resetActivityId: (resetRow as { id: string }).id,
    };
  });
