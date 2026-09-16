import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";
import { assertTicketAssignee } from "@/lib/engineer-identity";

const finalizeInput = z.object({
  ticketId: z.string().uuid(),
});

/** Statuses that must never be auto-closed (terminal states). */
const TERMINAL_STATUSES = ["Cancelled", "Closed"] as const;

/**
 * finalizeFsrSubmission — auto-depart + auto-close after an FSR submit.
 *
 * Engineers cannot UPDATE tickets under RLS, so both writes run here with
 * the service-role client. Same admin-or-assigned-engineer gate as
 * syncFsrPartsToTicket (FK-first on assigned_employee_id, name fallback on
 * assigned_engineer_name only when the name is unique across active employees).
 *
 * Idempotent: departure only when arrival_at exists and departure_at is
 * unset; close only when the ticket is not already terminal. Safe to call
 * once per submission — the client navigates away immediately after.
 */
export const finalizeFsrSubmission = createServerFn({ method: "POST" })
  .middleware([requireActiveUser])
  .inputValidator((input) => finalizeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("tickets")
      .select("id, status, updated_at, assigned_employee_id, assigned_engineer_name")
      .eq("id", data.ticketId)
      .maybeSingle();
    if (ticketErr) throw new Error(ticketErr.message);
    if (!ticket) throw new Error(`NotFound: ticket ${data.ticketId} not found`);

    // Gate: admin OR the engineer assigned to this ticket (shared gate:
    // FK match, else unique-name match; fail-loud on ambiguity).
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
    let closed = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ticket_visits pending generated types (migration 20260917000003)
    const visits = (supabaseAdmin as any).from("ticket_visits");

    // 1) Auto-depart: only when the engineer arrived and has not departed yet.
    //    No arrival row → nothing to depart (prevents phantom departures).
    //    The update is conditional on departure_at IS NULL: concurrent double
    //    calls race, exactly one wins (row-count check), the other skips —
    //    so no duplicate departure activities. limit(1): multi-visit tickets
    //    must not crash finalize (maybeSingle throws on >1 row).
    const { data: visitRows, error: visitErr } = await visits
      .select("arrival_at, departure_at")
      .eq("ticket_id", data.ticketId)
      .order("arrival_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (visitErr) throw new Error(visitErr.message);
    const v = (Array.isArray(visitRows) && visitRows.length > 0
      ? visitRows[0]
      : null) as unknown as { arrival_at: string | null; departure_at: string | null } | null;
    if (v?.arrival_at && !v.departure_at) {
      const { data: departRows, error: departErr } = await visits
        .update({ departure_at: now } as never)
        .eq("ticket_id", data.ticketId)
        .is("departure_at", null)
        .select("ticket_id");
      if (departErr) throw new Error(departErr.message);
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

    // 2) Auto-close: skip terminal states (Cancelled/Closed stay untouched).
    //    Optimistic concurrency on updated_at — a concurrent admin edit means
    //    zero rows; finalize is idempotent so the admin state wins silently.
    const status = (ticket as unknown as { status: string }).status;
    if (!(TERMINAL_STATUSES as readonly string[]).includes(status)) {
      const readUpdatedAt = (ticket as unknown as { updated_at: string }).updated_at;
      // Auto-close stamps closed_at: print lifecycle, closed_at filters, and
      // SLA math all key off it (previously only status flipped).
      const { data: updRows, error: updErr } = await supabaseAdmin
        .from("tickets")
        .update({ status: "Closed", closed_at: new Date().toISOString() } as never)
        .eq("id", data.ticketId)
        .eq("updated_at", readUpdatedAt)
        .select("id");
      if (updErr) throw new Error(updErr.message);
      closed = !!updRows && updRows.length > 0;
    }

    return { ticketId: data.ticketId, departed, closed };
  });
