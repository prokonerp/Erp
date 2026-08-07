import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_tickets",
  title: "List service tickets",
  description:
    "List service tickets, newest first. Optionally filter by status (Open, In Progress, Closed, ...) or a free-text search across case id, customer name and complaint.",
  inputSchema: {
    status: z.string().nullable().describe("Exact ticket status to filter by, or null for all."),
    search: z.string().nullable().describe("Free-text search on case id, customer or complaint, or null."),
    limit: z.number().int().min(1).max(100).describe("Maximum number of tickets to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("tickets")
      .select(
        "id, case_id, status, priority, call_type, customer_name, complaint, product, assigned_engineer_name, created_at, closed_at",
      )
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (search) {
      const term = `%${search}%`;
      query = query.or(`case_id.ilike.${term},customer_name.ilike.${term},complaint.ilike.${term}`);
    }
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { tickets: data ?? [] },
    };
  },
});