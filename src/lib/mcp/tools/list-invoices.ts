import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_invoices",
  title: "List sales invoices",
  description: "List sales invoices, newest first. Optionally filter by status or search invoice number / buyer name.",
  inputSchema: {
    status: z.string().nullable().describe("Invoice status to filter by, or null for all."),
    search: z.string().nullable().describe("Text to match invoice number or buyer name, or null."),
    limit: z.number().int().min(1).max(100).describe("Maximum number of invoices to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("invoices")
      .select("id, invoice_no, invoice_date, buyer_name, buyer_gstin, status, total, due_date, po_number")
      .eq("is_deleted", false)
      .order("invoice_date", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);
    if (search) {
      const term = `%${search}%`;
      query = query.or(`invoice_no.ilike.${term},buyer_name.ilike.${term}`);
    }
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { invoices: data ?? [] },
    };
  },
});