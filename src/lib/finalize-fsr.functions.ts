import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFieldLocation } from "@/integrations/supabase/field-location-middleware";
import { assertTicketAssignee } from "@/lib/engineer-identity";
import {
  buildSerialPhotoWarning,
  collectSerialPhotoRefs,
  pickLatestOpenVisit,
} from "@/lib/fieldServiceReport";
import { reportDbError } from "@/lib/format-error";

const finalizeInput = z.object({
  ticketId: z.string().uuid(),
});

/**
 * finalizeFsrSubmission — auto-depart after an FSR submit. The ticket
 * status is intentionally left untouched: submitting a report never
 * closes the ticket (an admin closes it explicitly).
 *
 * Engineers cannot UPDATE tickets under RLS, so the departure write runs
 * here with the service-role client. Same admin-or-assigned-engineer gate
 * as syncFsrPartsToTicket (FK-only on assigned_employee_id, mirroring the
 * RLS policies).
 *
 * Idempotent: departure only when arrival_at exists and departure_at is
 * unset. Safe to call once per submission — the client navigates away
 * immediately after.
 *
 * Serial-photo evidence is warn-instead-of-block: serial-bearing part lines
 * without photo evidence surface a `warnings` entry but never prevent
 * departure (the line shape cannot carry photo evidence yet).
 */
export const finalizeFsrSubmission = createServerFn({ method: "POST" })
  .middleware([requireFieldLocation])
  .inputValidator((input) => finalizeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("tickets")
      .select("id, status, updated_at, assigned_employee_id, assigned_engineer_name")
      .eq("id", data.ticketId)
      .maybeSingle();
    if (ticketErr) throw new Error(reportDbError("finalize ticket load", ticketErr));
    if (!ticket) throw new Error(`NotFound: ticket ${data.ticketId} not found`);

    // Gate: admin OR the engineer assigned to this ticket (shared gate:
    // FK match only; fail-loud on ambiguity).
    // Fast path: verified JWT email (skips the slow GoTrue admin lookup).
    const claimsEmail = (context as unknown as { claims?: { email?: unknown } })?.claims?.email;
    await assertTicketAssignee(supabaseAdmin, {
      userId: context.userId,
      emailHint: typeof claimsEmail === "string" && claimsEmail !== "" ? claimsEmail : null,
      ticket: ticket as unknown as {
        assigned_employee_id: string | null;
        assigned_engineer_name: string | null;
      },
      action: "finalize",
    });

    const now = new Date().toISOString();
    let departed = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ticket_visits pending generated types (migration 20260917000003)
    const visits = (supabaseAdmin as any).from("ticket_visits");

    // 0) Serial-photo evidence (warn-instead-of-block): the
    //    part_replacements line shape carries no photo field, so a
    //    serial-bearing line can never show photo evidence yet. Blocking
    //    here deadlocked auto-depart on every parts job — so refs are
    //    collected as warnings and departure proceeds. The explicit
    //    serial-photo capture step (not finalize) is where a future hard
    //    gate belongs. Reads mirror syncFsrPartsToTicket (ALL reports for
    //    the ticket).
    const { data: fsrRows, error: fsrErr } = await supabaseAdmin
      .from("field_service_reports")
      .select("part_replacements")
      .eq("ticket_id", data.ticketId);
    if (fsrErr) throw new Error(reportDbError("finalize serial-photo check", fsrErr));
    const serialRefs = collectSerialPhotoRefs(fsrRows);
    const warnings: string[] =
      serialRefs.length > 0 ? [buildSerialPhotoWarning(serialRefs)] : [];

    // 1) Auto-depart: only the single latest open visit departs (open rows
    //    only, ordered by arrival desc with created_at as tiebreak, limit 1;
    //    the JS picker re-applies the same rule defensively). No arrival row
    //    → nothing to depart (prevents phantom departures). The update is
    //    scoped by row id AND conditional on departure_at IS NULL: concurrent
    //    double calls race, exactly one wins (row-count check), the other
    //    skips — so no duplicate departure activities.
    const { data: visitRows, error: visitErr } = await visits
      .select("id, arrival_at, departure_at, created_at")
      .eq("ticket_id", data.ticketId)
      .is("departure_at", null)
      .order("arrival_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1);
    if (visitErr) throw new Error(reportDbError("finalize visit load", visitErr));
    const latest = pickLatestOpenVisit(
      (Array.isArray(visitRows) ? visitRows : []) as {
        id: string;
        arrival_at: string | null;
        departure_at: string | null;
        created_at: string | null;
      }[],
    );
    if (latest?.arrival_at) {
      const { data: departRows, error: departErr } = await visits
        .update({ departure_at: now } as never)
        .eq("id", latest.id)
        .is("departure_at", null)
        .select("ticket_id");
      if (departErr) throw new Error(reportDbError("finalize auto-depart", departErr));
      if (!departRows || (departRows as unknown[]).length === 0) {
        // Lost the race (already departed elsewhere) — skip the activity insert; report truthfully that this call departed nothing.
        departed = false;
      } else {
        try {
          await supabaseAdmin.from("ticket_activities").insert({
            ticket_id: data.ticketId,
            kind: "departure",
            notes: `Departed site at ${now} (auto-recorded on report submit)`,
            actor: context.userId,
          } as never);
        } catch (actErr) {
          console.warn("Departure activity insert failed:", actErr);
        }
        departed = true;
      }
    }

    return { ticketId: data.ticketId, departed, warnings };
  });
