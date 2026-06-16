## Overview

This is a large, multi-module change touching Imports, Masters, Tickets, and a brand-new INDENT module with database tables. I'll break it into 4 phases.

---

## Phase 1 — Import Template UI Standardization

**Goal:** Import screens use the same branded header as "New Form" screens (Prokon + OEM logos, field grouping).

- Audit current import UI (`src/routes/_app/import.tsx`) and the "New" form headers (e.g. `amc.new.tsx`, `tickets.new.tsx`, `crm.leads.tsx` new dialogs).
- Extract a shared `<FormPageHeader>` component (Prokon logo left, optional OEM logo right, title, subtitle).
- Apply it to the existing Import screen and all new import screens added in Phase 2.

## Phase 2 — Enable Import Across All Masters

**Goal:** Every Master sub-module supports Excel/CSV bulk import with validation and per-row error reporting.

Masters to cover:
- Customer Master
- Product Master
- OEM/Brand Master
- City/Area Master (currently part of branches/india data — confirm scope)
- Engineer Master (employees)
- Product Categories, Call Type Master, Vendors, Warehouses, Branches, Companies (existing masters)

Pattern per master:
- "Import" button on the master page → opens unified Import dialog/page.
- Reuses `src/lib/csv.ts` parser + a per-master Zod schema.
- Shows preview table, row-level validation errors, "Import valid rows" action.
- Standard header from Phase 1.

A single generic `<MasterImport entity="customers" schema={...} columns={...} />` component will back all of them.

## Phase 3 — Ticket Module: Model & OEM Display

3.1 **Model dropdown** in Tickets list filters and New Ticket form: show **Model Name only** (strip the OEM/brand prefix/suffix currently shown).

3.2 **OEM placement**: Move OEM/Brand chip to the **top header band** of:
- Ticket list page (as a prominent filter/section header)
- Ticket detail view (`tickets.$id.tsx`) — show OEM logo + name at top

Files: `src/routes/_app/tickets.index.tsx`, `tickets.new.tsx`, `tickets.$id.tsx`, `src/components/ProductPicker.tsx`.

## Phase 4 — NEW MODULE: INDENT

### 4a. Database (migration)

New table `public.indents`:
- `id`, `indent_no` (auto, format `PHS/IND/<seq>` via trigger), `indent_date`
- `ticket_id` (FK → tickets, NOT NULL, cascade) — INDENT cannot exist without ticket
- `indent_city`, `case_id`, `oem_case_id`, `company` (OEM brand)
- `def_model_no`, `def_serial_no`
- `problem_reported`
- `indent_type` enum: `rma_advance_exchange`, `rma_exchange`, `rma_service_ship`
- `oracles` (text)
- `material_exchange_model`, `material_exchange_serial_no`
- `material_rec_model_no`, `material_rec_serial_no`, `material_rec_date`
- `engineer_name`
- `created_by`, `created_at`, `updated_at`

Plus: `indent_sequence` table + `next_indent_seq()` + `set_indent_no()` trigger.
Plus: GRANTs, RLS policies, `updated_at` trigger.

### 4b. Backend rule

- Trigger or check: insert blocked unless source ticket has `tag = 'OEM'` (or whatever the OEM tag column is — confirm in tickets schema).

### 4c. Routes / UI

- `src/routes/_app/indent.tsx` — layout with sub-routes
- `src/routes/_app/indent.index.tsx` — list of all indents
- `src/routes/_app/indent.$id.tsx` — view/edit
- `src/routes/_app/indent.new.tsx` — create (usually pre-populated from ticket)

### 4d. Ticket quick action

In `tickets.$id.tsx`, add **"Create INDENT"** button:
- Enabled only when ticket tag = OEM
- Pre-fills indent form from ticket data (city, case_id, oem_case_id, oem brand, model, serial, problem, engineer)
- Navigates to `/indent/new?ticket_id=...`

### 4e. Sync

Read-only mirror of ticket fields on indent view (city, case ids, brand, model, serial, problem, engineer) re-fetched from ticket on open.

### 4f. Nav

Add INDENT to main app sidebar/nav in `src/routes/_app.tsx`.

---

## Clarifying questions before I start

1. **City/Area & Engineer Masters** — I don't see dedicated tables for these. Should "City Master" map to `branches` (city column) / a new table, and "Engineer Master" to `employees` filtered by a role?
2. **Ticket "OEM tag"** — what field identifies an OEM ticket? Is it `tickets.tag = 'OEM'`, the linked product's brand, or a separate flag? I'll confirm via the schema, but please confirm intent.
3. **INDENT permissions** — should INDENT be a new permission module in the role system (with read/create/edit/delete like other modules)?
4. **Scope confirmation** — this is roughly 1–2 days of work in one shot. OK to ship all 4 phases in sequence in this same chat, or would you prefer I ship Phase 3 + Phase 4 first (the highest-impact items) and follow with Phase 1 + 2?
