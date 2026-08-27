import { createServerFn } from "@tanstack/react-start";
import { requireActiveUser } from "@/integrations/supabase/auth-middleware";

export type IndentMapRow = {
  oracle_no: string;
  indent_id: string;
  indent_no: string | null;
  status: string | null;
};

/** Return every (oracle_no → indent) mapping for a ticket. Used by the ticket
 *  page to render per-row View/Create actions in one round-trip. */
export const listIndentMapForTicket = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((data: { ticket_id: string }) => data)
  .handler(async ({ data, context }): Promise<IndentMapRow[]> => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("indent_oracle_map" as never)
      .select("oracle_no, indent_id, indents:indent_id(indent_no, oracles_data)")
      .eq("ticket_id", data.ticket_id) as unknown as {
        data: Array<{
          oracle_no: string;
          indent_id: string;
          indents: { indent_no: string | null; oracles_data: Array<{ oracle_no?: string; status?: string }> | null } | null;
        }> | null;
        error: { message: string } | null;
      };
    if (error) throw new Error(error.message);
    return (rows || []).map((r) => {
      const oracles = r.indents?.oracles_data || [];
      const match = oracles.find((o) => (o?.oracle_no || "").trim().toUpperCase() === r.oracle_no.trim().toUpperCase());
      return {
        oracle_no: r.oracle_no,
        indent_id: r.indent_id,
        indent_no: r.indents?.indent_no ?? null,
        status: match?.status ?? null,
      };
    });
  });

/** Lookup a single (ticket, oracle_no) mapping. Returns null when no indent
 *  exists for that oracle yet, so the caller can fall back to Create. */
export const getIndentByTicketOracle = createServerFn({ method: "GET" })
  .middleware([requireActiveUser])
  .inputValidator((data: { ticket_id: string; oracle_no: string }) => data)
  .handler(async ({ data, context }): Promise<IndentMapRow | null> => {
    const on = (data.oracle_no || "").trim();
    if (!on) return null;
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("indent_oracle_map" as never)
      .select("oracle_no, indent_id, indents:indent_id(indent_no, oracles_data)")
      .eq("ticket_id", data.ticket_id)
      .ilike("oracle_no", on)
      .maybeSingle() as unknown as {
        data: {
          oracle_no: string;
          indent_id: string;
          indents: { indent_no: string | null; oracles_data: Array<{ oracle_no?: string; status?: string }> | null } | null;
        } | null;
        error: { message: string } | null;
      };
    if (error) throw new Error(error.message);
    if (!row) return null;
    const oracles = row.indents?.oracles_data || [];
    const match = oracles.find((o) => (o?.oracle_no || "").trim().toUpperCase() === row.oracle_no.trim().toUpperCase());
    return {
      oracle_no: row.oracle_no,
      indent_id: row.indent_id,
      indent_no: row.indents?.indent_no ?? null,
      status: match?.status ?? null,
    };
  });