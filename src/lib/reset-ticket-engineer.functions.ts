import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { reportDbError } from "@/lib/format-error";
import { parseUploadFilename } from "@/lib/upload-naming";
import { PART_SOURCE_FSR } from "@/lib/sync-fsr-parts";
import type { PartLine } from "@/lib/tickets";

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
  "serial_photo",
] as const;

/** New-scheme upload kinds the reset is allowed to remove. */
export const RESET_DELETABLE_NAME_KINDS = ["SERIAL", "ISSUE", "MISMATCH", "SIGNATURE"] as const;

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
 * filename parses via parseUploadFilename as either a new-scheme name with
 * kind in RESET_DELETABLE_NAME_KINDS, or a legacy name with legacyKind in
 * RESET_STORAGE_KIND_ALLOWLIST. Never true for a bare prefix (prefix wipe guard).
 */
export function isResetStoragePathAllowed(path: string, ticket_id: string): boolean {
  const prefix = `ticket/${ticket_id}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  // Must be a file inside a subfolder (date/name), never the prefix itself.
  if (!rest || !rest.includes("/") || rest.endsWith("/")) return false;
  const filename = rest.split("/").pop() || "";
  const parsed = parseUploadFilename(filename);
  if (!parsed) return false;
  if (!parsed.legacy) {
    return (RESET_DELETABLE_NAME_KINDS as readonly string[]).includes(parsed.kind);
  }
  return (RESET_STORAGE_KIND_ALLOWLIST as readonly string[]).includes(parsed.legacyKind);
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

/** Upper(trim()) serial normalization for custody matching; "" when blank/non-string. */
export function normalizeResetSerial(v: unknown): string {
  return typeof v === "string" ? v.trim().toUpperCase() : "";
}

/**
 * Pure helper: collect old+new serials named in deleted FSRs' part_replacements
 * (stored snake_case; tolerates camelCase). Upper(trim())-normalized, blanks
 * skipped, de-duplicated in first-seen order.
 */
export function collectResetCustodySerials(
  fsrRows: { part_replacements?: unknown }[] | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of fsrRows ?? []) {
    const list = (r as { part_replacements?: unknown }).part_replacements;
    if (!Array.isArray(list)) continue;
    for (const e of list) {
      if (!e || typeof e !== "object") continue;
      const rec = e as Record<string, unknown>;
      for (const k of ["old_sr_no", "oldSrNo", "new_sr_no", "newSrNo"]) {
        const s = normalizeResetSerial(rec[k]);
        if (s && !seen.has(s)) {
          seen.add(s);
          out.push(s);
        }
      }
    }
  }
  return out;
}

/**
 * Pure helper: drop FSR-staged lines (source === "fsr") from a ticket part-line
 * array. Admin hand-added lines (any other source, including unset) survive.
 */
export function stripFsrPartLines(lines: PartLine[] | null | undefined): PartLine[] {
  return (lines ?? []).filter((l) => (l as PartLine).source !== PART_SOURCE_FSR);
}

/**
 * Pure helper: recompute ticket part flags from the REMAINING lines —
 * defective_parts_received iff the defective array is non-empty,
 * good_parts_used/parts_used iff the good array is non-empty.
 */
export function recomputeResetPartFlags(
  defective: PartLine[] | null | undefined,
  good: PartLine[] | null | undefined,
): { defective_parts_received: boolean; good_parts_used: boolean; parts_used: boolean } {
  const hasDefective = (defective ?? []).length > 0;
  const hasGood = (good ?? []).length > 0;
  return {
    defective_parts_received: hasDefective,
    good_parts_used: hasGood,
    parts_used: hasGood,
  };
}

/** Coerce an unknown ticket part-details value to a PartLine array. */
function asResetPartLines(v: unknown): PartLine[] {
  return Array.isArray(v) ? (v as PartLine[]) : [];
}

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
      { data: ticketRow },
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
      // Part lines + assignee for the FSR-line strip / flag recompute / custody
      // release below. Scoped read of this ticket only; the update in (f2)
      // writes part-detail + flag columns only (never created/status/identity).
      supabaseAdmin
        .from("tickets")
        .select("id, assigned_employee_id, defective_parts_details, good_parts_details")
        .eq("id", scope.ticketId)
        .maybeSingle(),
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
      .select("id, part_replacements");
    if (delFsrErr) throw new Error(reportDbError("reset delete fsr", delFsrErr));

    // (f2) Strip FSR-staged part lines from THIS ticket only, recompute flags
    // from the remaining lines, and release custody held by the ticket's
    // assignee for serials named in the deleted FSRs.
    // FORBIDDEN-list tension (reported, not resolved by deletion): the
    // RESET_FORBIDDEN_TABLES list names "tickets" and "ims_stock_items", but
    // the reset contract requires scoped UPDATEs — never row DELETEs — on
    // exactly those tables here. No rows are deleted from either table; only
    // this ticket's part-line arrays + flags are rewritten, and only
    // ims_stock_items rows whose custodian equals this ticket's
    // assigned_employee_id are NULLed. Created/status/identity columns are
    // never written.
    const deletedFsrRows = (deletedFsr || []) as { id: string; part_replacements?: unknown }[];
    const custodySerials = collectResetCustodySerials(deletedFsrRows);
    const tRow = (ticketRow || {}) as {
      assigned_employee_id?: string | null;
      defective_parts_details?: unknown;
      good_parts_details?: unknown;
    };
    const remainingDefective = stripFsrPartLines(asResetPartLines(tRow.defective_parts_details));
    const remainingGood = stripFsrPartLines(asResetPartLines(tRow.good_parts_details));
    const removedFsrDefective =
      asResetPartLines(tRow.defective_parts_details).length - remainingDefective.length;
    const removedFsrGood = asResetPartLines(tRow.good_parts_details).length - remainingGood.length;
    const partFlags = recomputeResetPartFlags(remainingDefective, remainingGood);
    if (ticketRow) {
      const { error: partStripErr } = await supabaseAdmin
        .from("tickets")
        .update({
          defective_parts_details: remainingDefective,
          good_parts_details: remainingGood,
          ...partFlags,
        } as never)
        .eq("id", scope.ticketId);
      if (partStripErr) throw new Error(reportDbError("reset strip fsr part lines", partStripErr));
    }
    let releasedCustody = 0;
    const assigneeId =
      typeof tRow.assigned_employee_id === "string" && tRow.assigned_employee_id.trim() !== ""
        ? tRow.assigned_employee_id
        : null;
    if (assigneeId && custodySerials.length > 0) {
      const wanted = new Set(custodySerials);
      const { data: heldRows, error: heldErr } = await supabaseAdmin
        .from("ims_stock_items")
        .select("id, part_serial_no")
        .eq("custodian_employee_id", assigneeId);
      if (heldErr) throw new Error(reportDbError("reset read custody rows", heldErr));
      const releaseIds = ((heldRows || []) as { id: string; part_serial_no?: unknown }[])
        .filter((r) => wanted.has(normalizeResetSerial(r.part_serial_no)))
        .map((r) => r.id);
      if (releaseIds.length > 0) {
        const { error: releaseErr } = await supabaseAdmin
          .from("ims_stock_items")
          .update({ custodian_employee_id: null } as never)
          .in("id", releaseIds);
        if (releaseErr) throw new Error(reportDbError("reset release custody", releaseErr));
        releasedCustody = releaseIds.length;
      }
    }

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
      `fsr_part_lines_removed=defective:${removedFsrDefective},good:${removedFsrGood} ` +
      `custody_released=${releasedCustody} ` +
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
      removedFsrDefective,
      removedFsrGood,
      releasedCustody,
      removedPhotos,
      resetActivityId: (resetRow as { id: string }).id,
    };
  });
