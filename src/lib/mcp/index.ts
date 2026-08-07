import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listTicketsTool from "./tools/list-tickets";
import getTicketTool from "./tools/get-ticket";
import searchCustomersTool from "./tools/search-customers";
import stockLookupTool from "./tools/stock-lookup";
import listInvoicesTool from "./tools/list-invoices";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged.
const projectRef = import.meta.env['VITE_SUPABASE_PROJECT_ID'] ?? "project-ref-unset";

export default defineMcp({
  name: "prokon-erp",
  title: "Prokon ERP",
  version: "0.1.0",
  instructions:
    "Read-only tools for Prokon ERP. Use `list_tickets` and `get_ticket` for service tickets, `search_customers` for the customer master, `stock_lookup` for inventory, and `list_invoices` for sales invoices. All tools act as the signed-in Prokon ERP user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listTicketsTool, getTicketTool, searchCustomersTool, stockLookupTool, listInvoicesTool],
});