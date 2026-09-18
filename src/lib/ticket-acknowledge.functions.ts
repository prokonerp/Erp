import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireFieldLocation } from "@/integrations/supabase/field-location-middleware";
import { assertTicketAssignee } from "@/lib/engineer-identity";

const ackInput = z.object({
  ticketId: z.string().uuid(),
});

/**
 * acknowledgeTicketInstruction — engineer acknowledgement of a ticket's
 * special instruction that ALSO flips the tickets column.
 *
 * Engineers cannot UPDATE tickets under RLS, so the client-side acknowledge
 * used to insert only a ticket_activities row — admin views/exports reading
 * the `special_instruction_acknowledged` column never saw the ack. This fn
 * writes both, with the service-role client, behind the shared
 * admin-or-assigned-engineer gate.
 *
 * Idempotent: an already-true column returns early (no duplicate activity);
 * a previous partial attempt (activity present, column false) skips the
 * activity insert and just flips the column — no split-brain state.
 */
export const acknowledgeTicketInstruction = createServerFn({ method: "POST" })
  .middleware([requireFieldLocation])
  .inputValidator((input) => ackInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ticket, error: ticketErr } = await supabaseAdmin
      .from("tickets")
      .select(
        "id, special_instruction, special_instruction_acknowledged, assigned_employee_id, assigned_engineer_name",
      )
      .eq("id", data.ticketId)
      .maybeSingle();
    if (ticketErr) throw new Error(ticketErr.message);
    if (!ticket) throw new Error(`NotFound: ticket ${data.ticketId} not found`);
    const t = ticket as unknown as {
      special_instruction: string | null;
      special_instruction_acknowledged: boolean | null;
      assigned_employee_id: string | null;
      assigned_engineer_name: string | null;
    };
    if (!t.special_instruction || !t.special_instruction.trim()) {
      throw new Error("This ticket has no special instruction to acknowledge.");
    }
    if (t.special_instruction_acknowledged) return { acknowledged: true, already: true };

    const claimsEmail = (context as unknown as { claims?: { email?: unknown } })?.claims?.email;
    await assertTicketAssignee(supabaseAdmin, {
      userId: context.userId,
      emailHint: typeof claimsEmail === "string" && claimsEmail !== "" ? claimsEmail : null,
      ticket: t,
      action: "acknowledge instructions",
    });

    const { data: existing } = await supabaseAdmin
      .from("ticket_activities")
      .select("id")
      .eq("ticket_id", data.ticketId)
      .eq("kind", "acknowledge")
      .limit(1);
    if (!existing || (existing as unknown[]).length === 0) {
      const { error: actErr } = await supabaseAdmin.from("ticket_activities").insert({
        ticket_id: data.ticketId,
        kind: "acknowledge",
        notes: "Acknowledged special instruction",
        actor: context.userId,
      } as never);
      if (actErr) throw new Error(actErr.message);
    }

    const { error: updErr } = await supabaseAdmin
      .from("tickets")
      .update({ special_instruction_acknowledged: true } as never)
      .eq("id", data.ticketId);
    if (updErr) throw new Error(updErr.message);
    return { acknowledged: true, already: false };
  });
