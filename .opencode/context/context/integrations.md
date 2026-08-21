# Integrations

## Supabase (primary backend)
- Postgres + RLS, Auth (email/password), Storage buckets (ticket-attachments, amc-agreements, oem-logos), Realtime (tickets, indents, amcs).
- Project: `vimkodursmcsaptrrzbl` (`https://vimkodursmcsaptrrzbl.supabase.co`).
- Clients:
  - Browser: `src/integrations/supabase/client.ts` (VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY; lazy Proxy singleton).
  - Server admin: `src/integrations/supabase/client.server.ts` (SUPABASE_SERVICE_ROLE_KEY — bypasses RLS).
  - MCP per-request: `src/lib/mcp/supabase.ts` (key-set JSON parsing, forwards OAuth token).
- Middleware: `auth-attacher.ts` (client) + `auth-middleware.ts` (server, getClaims verification).

## MCP (Model Context Protocol) — AI tool access
- Endpoint `/mcp`; auto-generated routes by Lovable MCP Vite plugin (`mcpPlugin()` in vite.config.ts).
- OAuth: Supabase auth v1 issuer, `acceptedAudiences: "authenticated"`; consent flow at `/.lovable/oauth/consent`; metadata at `/.well-known/oauth-protected-resource`.
- Read-only tools: list_tickets, get_ticket, list_invoices, search_customers, stock_lookup.

## WhatsApp
- Template system: `wa_templates` (engineer_assign, oow_quotation, ticket_closed) with placeholder tokens auto-filled per record.
- Launch logging: `whatsapp_launch_logs` (module, record, URL, success). WhatsApp is launched via wa.me links from UI (no official API integration).

## Documents (PDF / print)
- jsPDF + jspdf-autotable + html2canvas for generated PDFs (invoices, quotations, POs, AMCs, tickets, defective tags, challans).
- `window.print()` print styles for A4 documents.
- `qrcode` for QR (e.g., e-invoice QR payload mock, UPI payment URIs).
- Letterhead/theme settings per document type (`letterhead_settings`, branch company info, OEM logos).

## GST (Indian statutory)
- Pure engine in `src/lib/gst.ts` + `src/lib/india.ts`: GSTIN validation/state codes, CGST/SGST vs IGST by state comparison, CESS, round-off, amount-in-words (Indian numbering), UPI payment URI.
- e-Invoice IRN: `mockIrnPayload` generates deterministic fake IRN/Ack/QR — **real GSP integration is a future swap-in** (same interface).
- e-Way bills: generated per invoice (>₹50k), stored in `eway_bills`.

## Excel / CSV
- `xlsx` library: CSV import (customers, installed equipment) and Excel export (PM schedule, ticket lists, reports).

## Deployment (see deployment.md)
- Cloudflare Workers via wrangler + @cloudflare/vite-plugin; Lovable Cloud pipeline drives deploys (no in-repo CI).

## Other
- `@lovable.dev/vite-tanstack-config` — Lovable scaffolding plugin (component tagger, env injection, MCP plugin).
- react-hook-form for forms; recharts for dashboards/charts; sonner toasts; date-fns.