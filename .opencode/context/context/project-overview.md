# Project Overview

**Prokon ERP** — an enterprise workspace for **Prokon Hi-Tech Systems**, an Indian company (Gurgaon) selling and servicing UPS, batteries, CCTV, inverters, solar panels, and related equipment.

App title/meta: *"Prokon ERP — sales, service, inventory and procurement in one enterprise workspace."*

## What the system does (plain English)

1. **Service Tickets** — log and manage service calls (warranty/OOW/installation/AMC/PM/CCTV). Engineers assigned, parts tracked, WhatsApp templates for customer updates, public customer-facing ticket form (`/raise-ticket`, no login).
2. **AMC (Annual Maintenance Contracts)** — manage AMC agreements, auto-generate preventive-maintenance (PM) visits, track OEM warranty data (from tickets/AMC/PM).
3. **CRM** — leads pipeline, quotations (GST-compliant, Zoho-style), incentives for salespeople, UPS bundles & battery catalog, UPS backup-time calculator.
4. **Sales** — quotations → sales orders → delivery challans (DC) → GST invoices, payments received with allocation, e-Way bills, per-branch document numbering (FY-aware, Apr–Mar).
5. **IMS (Inventory Management System)** — serialized stock tracking across warehouses, good/defective stock types, transfers with approval workflow, reservations, defective-tag printing, OEM returns, negative-stock overrides, ledger.
6. **Indent / RMA** — OEM exchange workflow: defective parts → Oracle blocks (Sections A→D) → DC/GRN documents → auto-close logic.
7. **PO (Purchase Orders)** — vendor POs with GST, per-branch numbering.
8. **Payroll / HR** — employees, monthly attendance grid with locks, auto salary calculation, advances with EMI deduction, audit trails.
9. **Gatepass** — physical gate passes (returnable/non-returnable items) with generated challan numbers.
10. **Masters** — companies, branches, warehouses, customers, vendors, products, categories, accounts ledger, users & roles.
11. **Admin / Security** — Supabase email+password auth, RBAC with global admin role + module-level permissions, password policy (strong, 30-day expiry, 5-password history), idle timeout (30 min), activity tracking (heartbeats).
12. **MCP (Model Context Protocol)** — external AI tools can query ERP data read-only, OAuth-authenticated via Supabase.

## Key domain facts

- Indian GST context: CGST+SGST same-state, IGST inter-state; GSTIN validation; amount-in-words (Crore/Lakh); e-Invoice IRN fields (currently mocked deterministically — real GSP integration is a future swap).
- Document numbering is FY-aware (Apr–Mar) with per-branch settings tables and advisory-lock-protected sequences.
- Soft-delete pattern (is_deleted) for tickets/indents/amcs/invoices; admin-only hard delete with audit; 30-day purge via pg_cron.
- Real-time subscriptions (supabase_realtime) on tickets, indents, amcs.

## Ownership / repo state

- Local git repo on branch `fork` (forked from original repo `gauravarora97/prokon-gatepass`, which is now disconnected).
- New remote: `https://github.com/prokonerp/Erp.git`
- Supabase project: `vimkodursmcsaptrrzbl` (project id in `.env` and `supabase/config.toml`) — credentials currently unchanged (user will update later).
- See `git.md` for full repo state.