import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "search_customers",
  title: "Search customers",
  description: "Search the customer master by company name, contact name, city, email or phone.",
  inputSchema: {
    search: z.string().min(1).describe("Text to search for across customer fields."),
    limit: z.number().int().min(1).max(50).describe("Maximum number of customers to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const term = `%${search}%`;
    const { data, error } = await supabase
      .from("customers")
      .select("id, company, contact_name, email, phone, city, sector, gst, customer_type, customer_code")
      .or(
        `company.ilike.${term},contact_name.ilike.${term},email.ilike.${term},phone.ilike.${term},city.ilike.${term}`,
      )
      .order("company", { ascending: true })
      .limit(limit);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { customers: data ?? [] },
    };
  },
});