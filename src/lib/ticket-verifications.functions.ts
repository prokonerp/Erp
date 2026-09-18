import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFieldLocation } from "@/integrations/supabase/field-location-middleware";
import { assertTicketAssignee } from "@/lib/engineer-identity";
import { reportDbError } from "@/lib/format-error";

/**
 * Verification writes through the server gate. The /eng workspace used to
 * upsert `ticket_customer_verifications` / `ticket_equipment_verifications`
 * straight from the browser (UI + RLS only); every sibling write path
 * (ack, uploads, parts sync, finalize) already goes through an
 * `assertTicketAssignee`-gated server fn. These two close the gap:
 * admin-or-assigned-engineer, service-role write, same on-duty location
 * posture as finalize (callers already `announceLocationDenial`).
 */

export const customerVerificationInput = z.object({
  ticketId: z.string().uuid(),
  verdict: z.enum(["verified", "incorrect"]),
  customerId: z.string().uuid().nullable(),
  snapshot: z.record(z.string(), z.unknown()),
  corrected: z.record(z.string(), z.unknown()).optional(),
  engineerEmployeeId: z.string().uuid().nullable(),
  engineerName: z.string().min(1).max(200),
});

async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- verification tables pending generated types
  return supabaseAdmin as any;
}

async function loadTicketForGate(
  admin: { from: (t: string) => any },
  ticketId: string,
  scope: string,
) {
  const { data: ticket, error: ticketErr } = await admin
    .from("tickets")
    .select("id, assigned_employee_id, assigned_engineer_name")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketErr) throw new Error(reportDbError(scope, ticketErr));
  if (!ticket) throw new Error(`NotFound: ticket ${ticketId} not found`);
  return ticket as {
    assigned_employee_id: string | null;
    assigned_engineer_name: string | null;
  };
}

function claimsEmailOf(context: unknown): string | null {
  const email = (context as { claims?: { email?: unknown } })?.claims?.email;
  return typeof email === "string" && email !== "" ? email : null;
}

export const upsertCustomerVerification = createServerFn({ method: "POST" })
  .middleware([requireFieldLocation])
  .inputValidator((input) => customerVerificationInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const ticket = await loadTicketForGate(admin, data.ticketId, "verification ticket load");
    await assertTicketAssignee(admin, {
      userId: context.userId,
      emailHint: claimsEmailOf(context),
      ticket,
      action: "verify",
    });
    const row: Record<string, unknown> = {
      ticket_id: data.ticketId,
      customer_id: data.customerId,
      verdict: data.verdict,
      snapshot: data.snapshot,
      engineer_employee_id: data.engineerEmployeeId,
      engineer_name: data.engineerName,
    };
    // Mirror the legacy client shape: `corrected` is only stored on the
    // incorrect path (omitted keys keep prior values on upsert conflict).
    if (data.corrected !== undefined) row.corrected = data.corrected;
    const { data: rows, error } = await admin
      .from("ticket_customer_verifications")
      .upsert(row, { onConflict: "ticket_id" })
      .select("id");
    if (error) throw new Error(reportDbError("customer verify save", error));
    const saved = (Array.isArray(rows) ? rows : []) as { id: string }[];
    return { ticketId: data.ticketId, verdict: data.verdict, id: saved[0]?.id ?? null };
  });

export const equipmentVerificationInput = z.object({
  ticketId: z.string().uuid(),
  verdict: z.enum(["matched", "mismatch"]),
  originalModel: z.string().max(300).nullable(),
  originalSerial: z.string().max(300).nullable(),
  correctedModel: z.string().max(300).nullable(),
  correctedSerial: z.string().max(300).nullable(),
  photoPath: z.string().min(1).max(500),
  // Geo is compulsory for mismatch but best-effort for matched (indoor
  // flows may have no fix). Absent keys stay absent on the upsert so a
  // geo-less re-verify never nulls a previously stored fix (legacy parity).
  photoLat: z.number().min(-90).max(90).nullish(),
  photoLong: z.number().min(-180).max(180).nullish(),
  photoAccuracy: z.number().min(0).max(100000).nullish(),
  photoCapturedAt: z.string().max(100).nullish(),
  engineerEmployeeId: z.string().uuid().nullable(),
  engineerName: z.string().min(1).max(200),
});

export const upsertEquipmentVerification = createServerFn({ method: "POST" })
  .middleware([requireFieldLocation])
  .inputValidator((input) => equipmentVerificationInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await getAdmin();
    const ticket = await loadTicketForGate(admin, data.ticketId, "verification ticket load");
    await assertTicketAssignee(admin, {
      userId: context.userId,
      emailHint: claimsEmailOf(context),
      ticket,
      action: "verify",
    });
    // Previous photo path (for the caller's orphan cleanup) — read before
    // the upsert wins the race, exactly like the legacy client flow.
    const { data: existing } = await admin
      .from("ticket_equipment_verifications")
      .select("photo_path")
      .eq("ticket_id", data.ticketId)
      .maybeSingle();
    const previousPhotoPath =
      ((existing as { photo_path?: unknown } | null)?.photo_path as string | null) ?? null;
    const row: Record<string, unknown> = {
      ticket_id: data.ticketId,
      verdict: data.verdict,
      original_model: data.originalModel,
      original_serial: data.originalSerial,
      corrected_model: data.correctedModel,
      corrected_serial: data.correctedSerial,
      photo_path: data.photoPath,
      engineer_employee_id: data.engineerEmployeeId,
      engineer_name: data.engineerName,
    };
    // Geo is compulsory for mismatch, best-effort for matched (indoor flows
    // may have no fix) — mirror the legacy client spreads exactly: geo keys
    // are only written when some geo is present, so a geo-less re-verify
    // keeps a previously stored fix instead of nulling it.
    if (data.photoLat != null || data.photoLong != null || data.photoCapturedAt != null) {
      row.photo_lat = data.photoLat;
      row.photo_long = data.photoLong;
      row.photo_accuracy = data.photoAccuracy;
      row.photo_captured_at = data.photoCapturedAt;
    }
    const { data: rows, error } = await admin
      .from("ticket_equipment_verifications")
      .upsert(row, { onConflict: "ticket_id" })
      .select("id");
    if (error) throw new Error(reportDbError("equipment verify save", error));
    const saved = (Array.isArray(rows) ? rows : []) as { id: string }[];
    return {
      ticketId: data.ticketId,
      verdict: data.verdict,
      id: saved[0]?.id ?? null,
      previousPhotoPath,
    };
  });

