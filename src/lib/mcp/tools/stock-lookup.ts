import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "stock_lookup",
  title: "Look up inventory stock",
  description:
    "Look up inventory stock items by part name, model number, serial number or OEM. Optionally filter by stock type (good/defective/scrap).",
  inputSchema: {
    search: z.string().nullable().describe("Text to match against part name, model no, serial no or OEM, or null for all."),
    stock_type: z.string().nullable().describe("Stock type filter such as good, defective or scrap, or null for all."),
    limit: z.number().int().min(1).max(200).describe("Maximum number of stock rows to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, stock_type, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("ims_stock_items")
      .select(
        "id, part_name, part_model_no, part_serial_no, oem, category, qty, stock_type, stock_status, warehouse_id, warehouse_type, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (search) {
      const term = `%${search}%`;
      query = query.or(
        `part_name.ilike.${term},part_model_no.ilike.${term},part_serial_no.ilike.${term},oem.ilike.${term}`,
      );
    }
    if (stock_type) query = query.eq("stock_type", stock_type as never);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { stock: data ?? [] },
    };
  },
});