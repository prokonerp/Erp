import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "get_ticket",
  title: "Get ticket details",
  description: "Fetch the full details of one service ticket by its case id (e.g. TKT-0042) or its internal id.",
  inputSchema: {
    case_id: z.string().min(1).describe("The ticket case id or internal ticket id."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ case_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(case_id);
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .eq(isUuid ? "id" : "case_id", case_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!data) return { content: [{ type: "text", text: `No ticket found for "${case_id}".` }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { ticket: data },
    };
  },
});