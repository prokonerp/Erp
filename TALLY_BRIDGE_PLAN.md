# Tally Bridge — Complete Blueprint

> **Prokon ERP ↔ TallyPrime Integration with Owner-Controlled "Pass Bill" Workflow**
> Free, zero-API-cost, 3-branch ready. Mac (dev) + Windows PC (prod) architecture.

- **Project:** Prokon ERP (`/Users/jai/Desktop/Prokon Erp`)
- **Date:** 2026-09-08
- **Status:** Build-ready plan — awaiting execution
- **Author:** Muse Spark (opencode/muse-spark-1.2-contributor-free)
- **Decisions locked:** Cloud-hosted Prokon (Vercel) · TallyPrime (single company, single Windows PC) · Prokon is sole billing source · Prokon generates e-invoices + eway · Owner clicks PASS BILL in Prokon web UI (admin-only) · List + per-bill + Pass All · Gate: bill passable only when IRN+EWB complete

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State — What You Already Have](#2-current-state--what-you-already-have)
3. [Tally vs Busy — Free vs Paid Analysis](#3-tally-vs-busy--free-vs-paid-analysis)
4. [Architecture Overview](#4-architecture-overview)
5. [Multi-Branch — 3 Locations, Single Tally Company](#5-multi-branch--3-locations-single-tally-company)
6. [Pass Bill Workflow — The Core Loop](#6-pass-bill-workflow--the-core-loop)
7. [Database Design — Supabase Migrations](#7-database-design--supabase-migrations)
8. [Tally XML Specification](#8-tally-xml-specification)
9. [Bridge Agent — Detailed Design](#9-bridge-agent--detailed-design)
10. [Prokon UI — Owner Dashboard + Invoice Badges](#10-prokon-ui--owner-dashboard--invoice-badges)
11. [Project Structure — Files to Create / Modify](#11-project-structure--files-to-create--modify)
12. [Build Plan — Waves & Tasks](#12-build-plan--waves--tasks)
13. [Verification Plan — How We Prove It Works](#13-verification-plan--how-we-prove-it-works)
14. [Mac Development Setup — How to Build Without Windows](#14-mac-development-setup--how-to-build-without-windows)
15. [Cost Analysis](#15-cost-analysis)
16. [Constraints, Risks & Mitigations](#16-constraints-risks--mitigations)
17. [Migration & Cutover — From Busy to Tally Bridge](#17-migration--cutover--from-busy-to-tally-bridge)
18. [Security & Permissions](#18-security--permissions)
19. [Appendix A — Reference File Map](#appendix-a--reference-file-map)
20. [Appendix B — Tally XML Examples](#appendix-b--tally-xml-examples)
21. [Appendix C — Bridge Config Reference](#appendix-c--bridge-config-reference)
22. [Appendix D — Glossary](#appendix-d--glossary)

---

## 1. Executive Summary

### The Problem

- Prokon ERP handles CRM, sales, inventory, procurement and **invoicing with NIC v1.03 e-invoice + eway JSON generation** — but those invoices live only in Supabase.
- Accounting books (GST filing, P&L, ledger) live in **TallyPrime** (single company, single Windows PC at the main office) and partially in **Busy Gold**.
- There is **no connection** between Prokon invoices and Tally vouchers — manual re-entry, duplicate risk, no audit trail.
- You want a **free** solution (no paid API subscription like BusyNotify/BizAgent) that works for **3 branches at different locations**, where **all staff create invoices** and the **owner reviews and passes** each bill to Tally.

### The Solution

A **Tally Bridge**: TallyPrime's built-in HTTP/XML gateway (port 9000, ₹0) + a lightweight **Node.js bridge agent** on the Windows PC + a **Supabase sync queue** + an **owner-only "Pass Bill" dashboard** inside Prokon.

```
Staff (3 branches) → Prokon (cloud) → Supabase queue → [Owner clicks PASS BILL in Prokon web UI]
                                                    → Bridge agent (Windows PC) → TallyPrime :9000 → ✓ Passed
```

### Key Properties

| Property | Value |
|---|---|
| Cost | **₹0** — Tally XML gateway is built-in, bridge is open-source Node.js, hosting already exists |
| Branches supported | 3 now, 10+ later — no architectural change |
| Billing source | **Prokon only** — staff stop creating invoices directly in Tally/Busy |
| E-invoicing + eway | **Prokon** generates IRN/EWB (NIC JSON), passed to Tally as `IRNNO`/`EWAYBILLNO` fields |
| Approval model | Owner reviews + approves each bill; bulk "Pass All" supported |
| Gate | Bill becomes passable only when `getInvoiceCompletionStatus() === 'complete'` (IRN when B2B, EWB when ≥₹50k) |
| Dev machine | macOS — builds & tests with a mock Tally; production bridge runs on the Windows PC |
| Offline behaviour | Bills queue safely; auto-sync when Tally/bridge come back online |

---

## 2. Current State — What You Already Have

### 2.1 Prokon ERP Stack

| Layer | Choice | Version |
|---|---|---|
| Framework | TanStack Start (`@tanstack/react-start` + `@tanstack/react-router`) via `nitro@3` | 1.167+ |
| UI | React 19.2, `react-hook-form@7`, `zod@4`, `sonner`, Tailwind CSS 4.2 | — |
| Database | Supabase (`@supabase/supabase-js`), `@tanstack/react-query@5` | — |
| PDF / QR / Excel | `jspdf@4` + `jspdf-autotable@5`, `qrcode@1.5`, `xlsx@0.18`, `html2canvas-pro@2` | — |
| Host | Vercel (cloud) + Supabase (Postgres) | — |
| Data layer | **All browser → Supabase direct** (`supabase.from("invoices").insert(...)`) — `src/server.ts` only does SSR error normalization, no custom API routes | Verified in `sales.invoices.new.tsx:3,444` |

### 2.2 Invoicing Module

| File | Route / Purpose |
|---|---|
| `src/routes/_app/sales.invoices.index.tsx` | `/_app/sales/invoices/` — list, filters, DataTable, PaginationFooter |
| `src/routes/_app/sales.invoices.new.tsx` | `/_app/sales/invoices/new` — 960-line create form: customer/branch picker, PO, billing/shipping, SalesType, LUT, ProductMasterPicker, SerialMultiPicker, BundleApplyDialog, `computeTotals`, GDC prefill |
| `src/routes/_app/sales.invoices.$id.tsx` | `/_app/sales/invoices/$id` — detail + Compliance Cockpit (Generate GST JSON / Paste IRN, Generate E-Way JSON / Paste EWB), `InvoicePrintModal`, print-audit hashing, cancel + lock after IRN |
| `src/routes/_app/sales.eway.index.tsx` | `/_app/sales/eway/` — eway_bills registry |
| `src/routes/_app/sales.payments.index.tsx` + `new.tsx` | Payments ledger + record payment (`?invoice_id`) |
| `src/routes/_app/sales.settings.tsx` | `invoice_settings` per branch (theme, prefix, terms, company name/address) |

### 2.3 GST / E-Invoice / E-Way (Already Built)

| File | What It Does |
|---|---|
| `src/lib/sales.ts` | `InvoiceRow`, `InvoiceItemRow`, `BranchRow`, `PaymentRow`, `SALES_TYPES` (7 types), `INVOICE_STATUSES` |
| `src/lib/sales.schemas.ts` | Zod schemas for invoices |
| `src/lib/gst.ts` | 537-line GST engine — `computeTotals`, `hsnSummary`, per-SalesType/SupplyClass logic |
| `src/lib/india.ts` | `GSTIN_REGEX`, `GSTIN_STATE_CODES` (01–38), `validateGSTINChecksum` (mod-36), PIN/vehicle regexes |
| `src/lib/money.ts` | `r2` rounding (`Math.round((v+EPSILON)*100)/100`) |
| `src/lib/transport.ts` | 25-field `TransportDetails` + `DispatchDetails`, `computeEInvoiceRequired`, `computeEWayRequired` (≥₹50k), `PIN_REGEX`, `VEHICLE_REGEX` |
| `src/lib/invoiceJson.ts` | **~1299 lines, pure, no I/O** — NIC v1.03 + NIC v1.0 builders, `gstDateDDMMYYYY`, checksum-gated GSTIN, `ExpDtls` for SEZ/Export |
| `src/lib/einvoice.ts` | Re-export façade over `invoiceJson` + `transport` — adds `getInvoiceCompletionStatus` (derives `e_invoice_required`, `e_way_required`, `complete` badge). No GSP, no I/O — staged manual-upload flow |
| `src/lib/invoicePdf.ts` | 880-line PDF renderer — letterhead, QR, signature, HSN/rate summaries, sha256 hashing |
| `src/lib/tallyLedger.ts` | **Tally-style STOCK ledger only** (not accounting) — `computeTallyLedger`, `fetchTallyTransactions`, `fetchVoucherDocument` over `ims_transactions` + `grns`/`delivery_challans`/`invoices`/`ims_transfers`. Read-only stock display |

### 2.4 Multi-Branch Already Supported

- `branches` table in Supabase, `branch_id` on every invoice, branch selector in invoice creation, per-branch `invoice_settings`, warehouse-level stock in IMS — **3 branches work today from one Supabase**.

### 2.5 Busy / Tally Today

- **Busy Gold** subscription handles e-invoicing + eway on the Busy side (legacy).
- **TallyPrime** — single company, single Windows PC at the main office. This is the target for the bridge.
- Plan: **Prokon becomes sole billing source**; Busy becomes legacy/optional; Tally becomes the single accounting book via the bridge.

---

## 3. Tally vs Busy — Free vs Paid Analysis

### 3.1 TallyPrime — Built-in HTTP/XML Gateway (FREE)

TallyPrime exposes an **XML-over-HTTP gateway** on `localhost:9000` (configurable). This is a first-class, documented feature — not a hack.

**Enable:** `F1 (Help) → Settings → Advanced Configuration → Enable HTTP Server → Port 9000`

| Capability | Detail | Cost |
|---|---|---|
| Push vouchers (Sales, Receipt, Purchase, Journal, Stock Journal) | `TALLYREQUEST=Import Data`, `REPORTNAME=Vouchers`, `VOUCHER VCHTYPE="Sales" ACTION="Create"` | ₹0 |
| Create ledgers / stock items | `LEDGER ACTION="Create"` / `STOCKITEM ACTION="Create"` | ₹0 |
| Export data (vouchers, ledgers, stock items, trial balance, day book) | `TALLYREQUEST=Export Data`, `REPORTNAME=Vouchers/Ledgers/...` | ₹0 |
| ODBC read | Collections marked `IsODBCTable: Yes` | ₹0 |
| Response | `<CREATED>1</CREATED><ERRORS>0</ERRORS>` on success | — |

**What you can push (all free):**

| Voucher Type | Tally XML Tag | Maps From Prokon |
|---|---|---|
| Sales Invoice | `VOUCHER VCHTYPE="Sales" ACTION="Create"` | Invoice header + line items + GST breakup + party ledger + IRN/EWB |
| Sales Return / Credit Note | `VOUCHER VCHTYPE="Credit Note"` | Credit notes |
| Payment Received | `VOUCHER VCHTYPE="Receipt"` | Payment entries from `/sales/payments` |
| Purchase Invoice | `VOUCHER VCHTYPE="Purchase"` | GRN data from procurement |
| Journal | `VOUCHER VCHTYPE="Journal"` | Adjustments, round-off |
| Ledger Creation | `LEDGER ACTION="Create"` | New customer/party ledgers (auto-create) |
| Stock Journal | `VOUCHER VCHTYPE="Stock Journal"` | Inventory adjustments |

### 3.2 Busy — No Free Write Path

| Capability | Availability | Cost |
|---|---|---|
| Read via ODBC | ✅ Built-in, read-only | Free |
| Write via ODBC | ❌ Not supported by design | — |
| Native REST API | ❌ Does not exist | — |
| XML/Excel import of vouchers | ✅ Manual file import (`Import Data → Vouchers`) | Free but manual, no automation |
| BusyNotify API (4 free endpoints for customers/bills/products/ledgers + paid custom) | REST wrapper over Busy DB | **Paid subscription** |
| BizAgent (unified REST for Busy+Tally) | Full read/write | **Paid** (enterprise) |
| Commenda/RootFi on-prem connector (Windows agent + invite link) | Read-focused, write limited | **Paid** |

**Conclusion:** For automated, free, bidirectional sync — **Tally is the only viable target**. Busy requires a paid middleware for programmatic writes.

### 3.3 Decision

**Target: TallyPrime.** Busy stays as legacy during migration, then de-prioritized. This plan builds the Tally bridge; a Busy bridge can be added later if needed (same queue pattern, different XML format).

---

## 4. Architecture Overview

### 4.1 High-Level Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           CLOUD (Vercel + Supabase)                      │
│                                                                          │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────┐       │
│  │  Prokon UI   │───→│  Supabase DB     │←──→│  Supabase        │       │
│  │  (Vercel)    │    │  invoices        │    │  Realtime /      │       │
│  │              │    │  tally_sync_queue│    │  Polling queue   │       │
│  │  Tally Sync  │    │  tally_vouchers  │    │                  │       │
│  │  Dashboard   │    │  tally_ledgers   │    │                  │       │
│  │  (admin-only)│    │  bridge_heartbeat│    │                  │       │
│  └──────────────┘    └────────┬─────────┘    └────────┬─────────┘       │
└───────────────────────────────┼───────────────────────┼─────────────────┘
                                │                       │
                    Supabase Realtime / Polling         │
                                │                       │
┌───────────────────────────────┼───────────────────────┼─────────────────┐
│                    WINDOWS PC (Owner's Office)        │                 │
│                               │                       │                 │
│  ┌────────────────────────────▼───────────────────────▼──────────┐      │
│  │                    BRIDGE AGENT (Node.js)                      │      │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐   │      │
│  │  │ Supabase    │  │ Tally XML    │  │ Sync Engine        │   │      │
│  │  │ Client      │  │ Builder      │  │ (queue processor)  │   │      │
│  │  │ (poll+write)│  │ (sales,rcpt) │  │ (outbound+inbound) │   │      │
│  │  └──────┬──────┘  └──────┬───────┘  └─────────┬──────────┘   │      │
│  │         │                │                     │              │      │
│  └─────────┼────────────────┼─────────────────────┼──────────────┘      │
│            │    HTTP POST (XML)    │                                    │
│  ┌─────────▼───────────────────────▼────────────────────────────────┐   │
│  │              TallyPrime (localhost:9000)                         │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐     │   │
│  │  │ Sales    │  │ Receipt  │  │ Ledger   │  │ Stock Items  │     │   │
│  │  │ Vouchers │  │ Vouchers │  │ Masters  │  │ & Groups     │     │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                         YOUR Mac (dev only)                              │
│  • Develop Prokon + bridge code                                          │
│  • Run mock-tally.js on :9000 for local testing (no Windows needed)      │
│  • npm test, build, push to Vercel                                       │
│  • cross-compile bridge → .exe for Windows via `pkg`                    │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Data Flow — Two Directions, One Queue

| Direction | Trigger | Path |
|---|---|---|
| **Prokon → Tally (push)** | Owner clicks PASS BILL in Prokon web UI (admin-only) | `tally_sync_queue` status `awaiting_pass` → `approved` → bridge picks up → XML → `localhost:9000` → `completed` |
| **Tally → Prokon (pull, phase 2)** | Bridge scheduled export (hourly) or manual trigger | Tally `Export Data` → parse XML → upsert `tally_vouchers` / `tally_ledgers` → Prokon shows Tally mirror |

### 4.3 Key Design Choices

| Choice | Rationale |
|---|---|
| **Cloud queue, not direct POST** | Vercel cannot reach `localhost:9000`; queue decouples web UI from Tally availability |
| **Owner approval gate (not auto-push)** | Mirrors Tally/Busy "Pass Bill" convention; prevents bad data entering books |
| **IRN/EWB gate before pass** | Reuses existing `getInvoiceCompletionStatus()` — bill passable only when `complete` |
| **Branch tag via narration `[Branch A]`** | Zero Tally config; Cost Centres as optional upgrade |
| **Bridge polls, not push** | Works through NAT/firewall; no inbound ports on Windows PC |
| **Single bridge, single Tally company** | Matches your setup (3 branches → 1 Tally company) |

---

## 5. Multi-Branch — 3 Locations, Single Tally Company

### 5.1 How 3 Branches Map

All 3 branches use the **same Prokon cloud + same Supabase**. Each invoice carries `branch_id`. The bridge and Tally are **singletons** on the owner's Windows PC.

```
Branch A (Delhi) ──┐
Branch B (Mumbai) ──┤──→ Supabase (branch_id on every row) → Bridge (one) → Tally (one company)
Branch C (Blr)   ──┘         │                                      │
                             │ branch filter in UI                  │ narration / Cost Centre
                             │ admin sees all                       │ per-voucher branch tag
```

### 5.2 Branch Tag Inside Tally

Every voucher pushed to Tally carries its branch identity. Two options:

| Method | How | Pros | Cons |
|---|---|---|---|
| **Narration prefix (default, zero config)** | `NARRATION: "[Branch A] INV-2026/0001"` | Works immediately, no Tally setup | Harder to filter P&L by branch |
| **Cost Centres (recommended upgrade)** | Enable `F1 → Features → Cost Centres`, create 3 centres, set `<COSTCENTRE>Branch A</COSTCENTRE>` per voucher | Proper per-branch P&L, clean reports | One-time Tally setup |

Default: narration. Upgrade to Cost Centres when you want branch P&L in Tally.

### 5.3 Branch Isolation in Prokon

Already built — `branch_id` filtering:

- Branch A user sees Branch A invoices only; Branch B sees Branch B; **admin sees all**.
- Tally Sync dashboard: admin sees all pending; branch users see only "Awaiting Pass" badge on their own invoices.

### 5.4 Capacity for 3 Branches

| Metric | Estimate | Notes |
|---|---|---|
| Invoices / branch / day | ~20–50 | Typical MSME |
| Total / day (all 3) | ~60–150 | — |
| Tally XML time | ~0.5–2s per voucher | Local HTTP |
| Bridge throughput | ~300–600 vouchers/hour | More than enough |
| Supabase queue | 1000s easily | Indexed Postgres |
| Poll interval | 15s (approved → Tally) | Tunable |

**3 branches is trivial. 10 branches would also be fine.**

---

## 6. Pass Bill Workflow — The Core Loop

### 6.1 States

```
not_synced ──→ awaiting_pass ──→ approved ──→ processing ──→ completed
                  │                 │              │
                  │                 │              └─→ failed ──→ retry ──→ completed
                  │                 │                              └─→ failed (max retries)
                  │                 └─→ (Tally offline: stays approved, bridge retries)
                  └─→ (staff re-edits invoice: re-validates gate, stays awaiting_pass)
```

| Status | Who sets it | Meaning |
|---|---|---|
| `not_synced` | — | Invoice exists but not yet eligible (IRN/EWB incomplete) |
| `awaiting_pass` | `enqueueForTallyPass()` (auto when invoice becomes `complete`) | In queue, waiting for owner approval |
| `approved` | Owner clicks **PASS BILL** | Frozen `payload_json` snapshot, `approved_by/at` set |
| `processing` | Bridge picks it up | XML built, POST in flight |
| `completed` | Tally returns `CREATED=1` | Voucher created, `tally_voucher_id/no` stored |
| `failed` | Tally returns `ERRORS>0` or network error after retries | `error_message` stored, owner can **Retry** or **Create Ledger** |

### 6.2 Step-by-Step — The "Pass Bill Pass Bill Pass Bill" Flow

```
1. STAFF (any branch) creates invoice in Prokon
   → computeTotals + GST, branch_id set
   → invoice saved to Supabase

2. E-INVOICE + EWAY gate
   → getInvoiceCompletionStatus(inv) checks:
     - e_invoice_required? (via computeEInvoiceRequired + GSTIN checksum)
     - e_way_required? (via computeEWayRequired, ≥₹50k)
     - complete = (IRN present when required) && (EWB present when required)
   → if complete → auto-insert into tally_sync_queue (awaiting_pass)
   → if incomplete → invoice stays not_synced, UI shows "e-invoice/eway pending — not passable"

3. OWNER opens Tally Bridge dashboard (Prokon web, admin-only)
   → sees "Awaiting Pass (12)" list
   → each row: invoice_no, branch, amount, IRN✓ EWB✓, [PASS] button
   → also [PASS ALL N] at top

4. OWNER clicks [PASS] (per bill) or [PASS ALL]
   → queue row: awaiting_pass → approved
   → approved_by = owner user id, approved_at = now()
   → payload_json = frozen snapshot of invoice + items at approval time
   → invoice.tally_sync_status = 'approved'

5. BRIDGE AGENT (silent, on Windows PC, polls every 15s)
   → SELECT * FROM tally_sync_queue WHERE status='approved' ORDER BY created_at
   → for each row:
     a. fetch full invoice + items from Supabase (or use payload_json)
     b. buildSalesVoucher(invoice, items, branch) → XML string
     c. if party ledger missing → auto-create via LEDGER ACTION="Create"
     d. POST XML to http://localhost:9000
     e. parse response:
        - CREATED=1, ERRORS=0 → status='completed', store tally_voucher_id/no, set invoice tally_sync_status='synced'
        - ERRORS>0 → status='failed', store error_message, leave for owner retry
        - network error (Tally offline) → stay 'approved' (retry next poll), log heartbeat offline

6. OWNER sees result in dashboard
   → "Passed — waiting Tally (N)" → "Completed ✓ → Tally Voucher 2245"
   → or "Failed ✗  Ledger not found  [Retry] [Create Ledger]"
```

### 6.3 Owner Dashboard Sketch

```
┌─ TALLY BRIDGE ─────────────────────────────────────────────┐
│  Tally: ● Online  ·  Bridge: ● Online  ·  Last sync: 09:04 │
│                                                             │
│  ┌─ Awaiting Pass (12) ────────────────────────────────┐   │
│  │ ☐ INV-2026/0009  Branch B  ₹34,000  IRN✓ EWB✓ [PASS]│   │
│  │ ☐ INV-2026/0010  Branch A  ₹12,800  IRN✓ EWB✓ [PASS]│   │
│  │ ☐ INV-2026/0011  Branch C  ₹91,500  IRN✓ EWB✓ [PASS]│   │
│  │                          [PASS ALL 12]              │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─ Passed — waiting Tally (2) ───────────────────────┐    │
│  │ ⏳ INV-2026/0006  approved 09:04  (bridge running)  │    │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─ Completed (1,248) ────────────────────────────────┐    │
│  │ ✓ INV-2026/0001  Branch A  ₹27,400 → Voucher 2245  │    │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─ Failed (1) ───────────────────────────────────────┐    │
│  │ ✗ INV-2026/0005  Branch A  ₹76,000                 │    │
│  │   Error: Ledger "Customer XYZ" not found          │    │
│  │   [Retry]  [Create Ledger in Tally]               │    │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

Per-invoice badge (in `sales.invoices.index.tsx` + `sales.invoices.$id.tsx`):
- `✓ Synced (Vch 2245)` · `Awaiting Pass` · `Approved — pending Tally` · `Failed` · `Not eligible (IRN pending)`

---

## 7. Database Design — Supabase Migrations

### 7.1 Migration File

**Path:** `supabase/migrations/20260910XXXX_tally_bridge.sql`

```sql
-- ============================================================
-- Tally Bridge — Supabase migration
-- Tables: tally_sync_queue, tally_vouchers, tally_ledgers, bridge_heartbeat
-- Alters: invoices (tally_sync_status)
-- ============================================================

-- 1. Sync queue — one row per invoice awaiting / in-flight / done
CREATE TABLE tally_sync_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  branch_id         UUID REFERENCES branches(id),
  status            TEXT NOT NULL DEFAULT 'awaiting_pass'
      CHECK (status IN ('awaiting_pass','approved','processing','completed','failed','retry')),
  approved_by       UUID REFERENCES auth.users(id),
  approved_at       TIMESTAMPTZ,
  tally_voucher_id  TEXT,
  tally_voucher_no  TEXT,
  error_message     TEXT,
  retry_count       INT NOT NULL DEFAULT 0,
  max_retries       INT NOT NULL DEFAULT 4,
  payload_json      JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  CONSTRAINT uq_tally_queue_invoice UNIQUE (invoice_id)
);

-- 2. Tally voucher mirror (for pull-back / audit, phase 2)
CREATE TABLE tally_vouchers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tally_voucher_id  TEXT UNIQUE,
  voucher_type      TEXT,
  voucher_number    TEXT,
  voucher_date      DATE,
  party_ledger      TEXT,
  branch            TEXT,
  total_amount      NUMERIC,
  reference_no      TEXT,
  raw_xml           TEXT,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Tally ledger cache
CREATE TABLE tally_ledgers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tally_ledger_id  TEXT UNIQUE,
  ledger_name      TEXT NOT NULL,
  group_name       TEXT,
  is_party         BOOLEAN DEFAULT false,
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Bridge heartbeat — so the dashboard can show Online/Offline
CREATE TABLE bridge_heartbeat (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bridge_id        TEXT NOT NULL DEFAULT 'main',
  status           TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online','offline','error')),
  tally_reachable  BOOLEAN NOT NULL DEFAULT false,
  last_seen        TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_message    TEXT,
  version          TEXT
);

-- 5. Invoice sync status column
ALTER TABLE invoices
  ADD COLUMN tally_sync_status TEXT NOT NULL DEFAULT 'not_synced'
  CHECK (tally_sync_status IN ('not_synced','awaiting_pass','approved','synced','failed'));

-- Indexes
CREATE INDEX idx_tally_queue_status    ON tally_sync_queue(status);
CREATE INDEX idx_tally_queue_branch    ON tally_sync_queue(branch_id);
CREATE INDEX idx_tally_vouchers_ref    ON tally_vouchers(reference_no);
CREATE INDEX idx_tally_vouchers_branch ON tally_vouchers(branch);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
ALTER TABLE tally_sync_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_vouchers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tally_ledgers    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bridge_heartbeat ENABLE ROW LEVEL SECURITY;

-- Queue: all authenticated users can read (to show badge on own invoices)
CREATE POLICY "tally_queue_read_all" ON tally_sync_queue
  FOR SELECT TO authenticated USING (true);

-- Queue: insert allowed for authenticated (enqueue is app-level, RLS allows it)
CREATE POLICY "tally_queue_insert" ON tally_sync_queue
  FOR INSERT TO authenticated WITH CHECK (true);

-- Queue: only owner/admin can approve (app enforces role; RLS is permissive,
-- real gate is in tallySync.ts role check — see §18)
CREATE POLICY "tally_queue_update" ON tally_sync_queue
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Vouchers/ledgers/heartbeat: read for all authenticated
CREATE POLICY "tally_vouchers_read" ON tally_vouchers FOR SELECT TO authenticated USING (true);
CREATE POLICY "tally_ledgers_read"  ON tally_ledgers  FOR SELECT TO authenticated USING (true);
CREATE POLICY "bridge_heartbeat_read" ON bridge_heartbeat FOR SELECT TO authenticated USING (true);

-- Bridge service role (service_role key) bypasses RLS for writes — no extra policy needed
```

### 7.2 RLS Note

The real approval gate is **application-level** in `src/lib/tallySync.ts` (`approveForTally` checks `isOwnerOrAdmin(currentUser)` before issuing the UPDATE). RLS is permissive for authenticated reads; the service-role bridge bypasses RLS for its writes. If you want a DB-level owner-only UPDATE, add a helper function checking `auth.jwt() ->> 'role'` or a `user_roles` lookup — but the app gate is sufficient and simpler.

---

## 8. Tally XML Specification

### 8.1 Envelope — Import (Push Voucher)

```xml
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <!-- VOUCHER goes here -->
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
```

### 8.2 Sales Voucher — Key Fields

```xml
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>20260908</DATE>                          <!-- YYYYMMDD -->
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>INV-2026/0001</VOUCHERNUMBER>   <!-- or let Tally auto-number -->
  <PARTYLEDGERNAME>Customer ABC Pvt Ltd</PARTYLEDGERNAME>
  <NARRATION>[Branch A] INV-2026/0001 — Prokon</NARRATION>
  <REFERENCE>INV-2026/0001</REFERENCE>           <!-- links back to Prokon -->
  <!-- E-invoice fields (only when IRN/EWB present) -->
  <IRNNO>a1b2c3d4...64hex...</IRNNO>
  <IRNDATE>08092026</IRNDATE>
  <EWAYBILLNO>123456789012</EWAYBILLNO>

  <!-- Party ledger entry (debit) -->
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Customer ABC Pvt Ltd</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-24500.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>

  <!-- Sales ledger (credit) -->
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Sales</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>20762.71</AMOUNT>
  </ALLLEDGERENTRIES.LIST>

  <!-- GST ledgers — one per rate bucket -->
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>CGST 9%</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>1868.64</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>SGST 9%</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>1868.64</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <!-- Round-off -->
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Round Off</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>0.01</AMOUNT>
  </ALLLEDGERENTRIES.LIST>

  <!-- Inventory allocations per line item -->
  <INVENTORYENTRIES.LIST>
    <ITEMNAME>UPS-600VA</ITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <RATE>5500.00</RATE>
    <QUANTITY>2 NOS</QUANTITY>
    <AMOUNT>11000.00</AMOUNT>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales</LEDGERNAME>
      <AMOUNT>11000.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </INVENTORYENTRIES.LIST>
</VOUCHER>
```

**GST mapping:** Reuse `computeTotals` from `src/lib/gst.ts` for the exact CGST/SGST/IGST split; map each non-zero bucket to a Tally ledger name (`CGST 9%`, `SGST 9%`, `IGST 18%`, `CESS`, etc.). Ledger names must match what exists in Tally — bridge auto-creates missing ones (see §9.4).

**Branch tag:** `NARRATION` prefix `[Branch A]` + optional `<CATEGORYALLOCATIONS>` for Cost Centres when enabled.

### 8.3 Other Voucher Types

| Type | VCHTYPE | Key difference |
|---|---|---|
| Receipt (payment received) | `Receipt` | Party ledger credited, Bank/Cash debited |
| Ledger create | `LEDGER ACTION="Create"` | `NAME`, `PARENT` (group), `GSTIN` |
| Export (pull) | `TALLYREQUEST=Export Data` + `REPORTNAME=Vouchers` + `SVFROMDATE/SVTODATE` | Returns XML list of vouchers in range |

### 8.4 Tally Response

```xml
<ENVELOPE><BODY><DATA>
  <LINE><TALLYRESPONSE>
    <CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS>
  </TALLYRESPONSE></LINE>
</DATA></BODY></ENVELOPE>
```

On error: `<ERRORS>1</ERRORS><LINEERROR>Ledger "Foo" does not exist</LINEERROR>`

Parser extracts `CREATED`, `ERRORS`, `LINEERROR`, and when available `VOUCHERID`/`VOUCHERNUMBER` for dedup.

---

## 9. Bridge Agent — Detailed Design

### 9.1 What It Is

A **standalone Node.js service** that runs on the **Windows PC** (where TallyPrime is). It is **not** part of the Prokon Vite app; it has its own `package.json`. You **build it on your Mac**, ship it to the Windows PC, and it runs silently (optionally auto-start with Windows).

### 9.2 Folder Layout

```
bridge/
├── package.json            # standalone deps: @supabase/supabase-js, node-fetch/undici
├── config.json             # Supabase URL + anon key, Tally host/port/company, poll intervals
├── config.example.json     # template for the owner to fill
├── src/
│   ├── index.ts            # entry — loads config, starts poll loops, handles SIGTERM
│   ├── supabaseClient.ts   # Supabase client (anon key for queue reads, service role for heartbeat)
│   ├── tallyClient.ts      # HTTP client for Tally :9000 — POST XML, parse response, retry
│   ├── tallyXml.ts         # (shared with Prokon) XML builders + response parser — or imported from ../src/lib/tallyXml.ts
│   ├── syncProcessor.ts    # queue processor: fetch approved → build XML → POST → update queue
│   ├── pullSync.ts         # (phase 2) export vouchers/ledgers from Tally → upsert to Supabase
│   └── heartbeat.ts        # periodic bridge_heartbeat upsert + tally reachability check
├── mock-tally.js           # dev-only mock Tally server for Mac testing (see §14)
├── README.md               # setup: where to install, Tally port 9000 config, autostart
└── scripts/
    ├── launch.bat          # Windows: node src/index.js
    └── install-service.ps1 # (optional) install as Windows service via NSSM/PM2
```

### 9.3 Config (`bridge/config.json`)

```json
{
  "supabaseUrl": "https://xxx.supabase.co",
  "supabaseAnonKey": "eyJ...",
  "supabaseServiceRoleKey": "eyJ... (for heartbeat writes, optional)",
  "tally": {
    "host": "localhost",
    "port": 9000,
    "company": "Your Company Name (as in Tally)",
    "timeoutMs": 15000
  },
  "poll": {
    "queueIntervalMs": 15000,
    "heartbeatIntervalMs": 30000,
    "pullIntervalMs": 3600000
  },
  "retry": {
    "maxRetries": 4,
    "backoffMs": [5000, 15000, 60000, 300000]
  }
}
```

`config.example.json` ships with placeholders; the real `config.json` is **never committed** (gitignored). The owner fills it once on the Windows PC.

### 9.4 Sync Processor — Logic

```ts
// Pseudocode for syncProcessor.ts

async function processApprovedQueue() {
  const { data: rows } = await supabase
    .from("tally_sync_queue")
    .select("*")
    .eq("status", "approved")
    .order("approved_at", { ascending: true })
    .limit(10);

  for (const row of rows) {
    // 1. mark processing
    await supabase.from("tally_sync_queue").update({ status: "processing" }).eq("id", row.id);

    try {
      // 2. fetch invoice + items (or use payload_json snapshot)
      const invoice = row.payload_json ?? await fetchInvoice(row.invoice_id);
      const items   = invoice.items;

      // 3. ensure party ledger exists (auto-create if missing)
      await ensureLedgerExists(invoice.buyer_name, invoice.buyer_gstin);

      // 4. ensure GST ledgers exist (CGST/SGST/IGST buckets from computeTotals)
      await ensureGstLedgersExist(invoice);

      // 5. build XML
      const xml = buildSalesVoucher(invoice, items, branchName, invoice.irn, invoice.eway_bill_no);

      // 6. POST to Tally
      const res = await tallyClient.post(xml); // POST http://localhost:9000
      const parsed = parseTallyResponse(res.body);

      if (parsed.created === 1 && parsed.errors === 0) {
        await supabase.from("tally_sync_queue").update({
          status: "completed",
          tally_voucher_id: parsed.voucherId,
          tally_voucher_no: parsed.voucherNo,
          processed_at: new Date().toISOString(),
        }).eq("id", row.id);

        await supabase.from("invoices").update({ tally_sync_status: "synced" }).eq("id", row.invoice_id);

        await supabase.from("tally_vouchers").insert({
          tally_voucher_id: parsed.voucherId,
          voucher_type: "Sales",
          voucher_number: parsed.voucherNo,
          party_ledger: invoice.buyer_name,
          branch: branchName,
          reference_no: invoice.invoice_no,
          raw_xml: xml,
        });
      } else {
        // Tally returned errors
        const nextStatus = row.retry_count + 1 >= row.max_retries ? "failed" : "retry";
        await supabase.from("tally_sync_queue").update({
          status: nextStatus,
          error_message: parsed.lineError ?? `Tally errors=${parsed.errors}`,
          retry_count: row.retry_count + 1,
          processed_at: new Date().toISOString(),
        }).eq("id", row.id);

        if (nextStatus === "failed") {
          await supabase.from("invoices").update({ tally_sync_status: "failed" }).eq("id", row.invoice_id);
        }
      }
    } catch (err) {
      // Network error (Tally offline) — keep as approved so next poll retries
      if (isTallyUnreachable(err)) {
        await supabase.from("tally_sync_queue").update({ status: "approved" }).eq("id", row.id);
        await heartbeat.markTallyOffline(String(err));
        break; // stop processing further rows this cycle
      }
      // Other error — retry with backoff
      const nextStatus = row.retry_count + 1 >= row.max_retries ? "failed" : "retry";
      await supabase.from("tally_sync_queue").update({
        status: nextStatus,
        error_message: String(err),
        retry_count: row.retry_count + 1,
      }).eq("id", row.id);
    }
  }
}

// Heartbeat
async function sendHeartbeat() {
  const tallyOk = await tallyClient.ping(); // lightweight Export Data request
  await supabase.from("bridge_heartbeat").upsert({
    bridge_id: "main",
    status: tallyOk ? "online" : "offline",
    tally_reachable: tallyOk,
    last_seen: new Date().toISOString(),
  }, { onConflict: "bridge_id" });
}
```

**Dedup:** `REFERENCE` field in Tally voucher = Prokon `invoice_no`; bridge checks `tally_vouchers.reference_no` before pushing; `UNIQUE(invoice_id)` in queue prevents double-enqueue.

### 9.5 Tally Client (`tallyClient.ts`)

- `post(xml: string): Promise<{ status: number, body: string }>` — `fetch("http://localhost:9000", { method:"POST", body: xml, headers: { "Content-Type":"application/xml" } })`, timeout via `AbortController`.
- `ping(): Promise<boolean>` — minimal `Export Data` request to test reachability.
- No dependencies beyond `fetch` (Node 18+ has built-in `fetch`).

### 9.6 Running the Bridge (Windows PC)

| Mode | Command |
|---|---|
| Dev (Mac, with mock) | `node bridge/mock-tally.js` in one terminal, `node bridge/src/index.js` in another |
| Prod (Windows, foreground) | `node bridge/src/index.js` or `npm start` |
| Prod (Windows, background) | `pm2 start bridge/src/index.js --name prokon-bridge` or NSSM service |
| Auto-start with Windows | Task Scheduler → trigger on logon → `node C:\prokon-bridge\src\index.js` |
| Packaged .exe (no Node needed) | Build on Mac: `npx pkg bridge/src/index.js --targets node18-win-x64 --output bridge/prokon-bridge.exe`, copy .exe + config.json to Windows |

Node 18+ required on the Windows PC (or use the packaged .exe which bundles Node).

---

## 10. Prokon UI — Owner Dashboard + Invoice Badges

### 10.1 New Route — Owner Dashboard

**Path:** `src/routes/_app/sales.tally-bridge.tsx` → `/_app/sales/tally-bridge`

- **Guard:** `admin` / `owner` role only (via `src/lib/permissions.ts` + `src/lib/account-gate.ts` pattern). Non-admin redirected to `/sales`.
- **Data:** reads `tally_sync_queue` + `bridge_heartbeat` + `invoices` (for display names).
- **Sections:**
  - **Header:** Tally `● Online/○ Offline`, Bridge `● Online/○ Offline`, last sync time.
  - **Awaiting Pass** — filterable by branch, searchable by invoice_no/buyer, checkboxes, `[PASS]` per row + `[PASS ALL N]` bulk. Only shows invoices where `getInvoiceCompletionStatus() === 'complete'`.
  - **Passed — waiting Tally** — `approved`/`processing` rows, spinner, "bridge will push shortly".
  - **Completed** — paginated, shows Tally voucher number, branch, date, link to invoice detail.
  - **Failed** — error_message, `[Retry]` (re-sets to `approved`), `[Create Ledger]` hint.
- **Actions:** `approveForTally(invoiceId)` / `approveAll(ids)` — optimistic UI, toast on success/failure.
- **Realtime (optional):** Supabase Realtime subscription on `tally_sync_queue` so the dashboard updates live as the bridge processes.

### 10.2 Invoice List + Detail Badges

**Modify:** `src/routes/_app/sales.invoices.index.tsx` — add a "Tally" column/badge per row.

**Modify:** `src/routes/_app/sales.invoices.$id.tsx` — add sync badge + `[Pass to Tally]` button (admin-only, only when `complete` and not yet synced). After approval, badge changes to `Approved — pending Tally`.

Badge states (uses `src/lib/tallySync.ts:tallyStatusBadge`):

| Invoice state | Badge |
|---|---|
| No IRN/EWB yet (not complete) | `Not eligible — IRN pending` (grey, tooltip) |
| Complete, not enqueued | `Awaiting Pass` (amber) |
| Enqueued, awaiting owner | `Awaiting Pass` (amber) + admin sees `[Pass]` |
| Approved | `Approved — pending Tally` (blue, spinner) |
| Completed | `✓ Synced (Vch 2245)` (green) |
| Failed | `Failed: <reason> [Retry]` (red) |

### 10.3 UI Stack

- Reuse existing patterns: `DataTable`, `PaginationFooter`, `sonner` toasts, `lucide-react` icons, Tailwind 4.2.
- No new UI dependencies.

---

## 11. Project Structure — Files to Create / Modify

| # | Path | Type | Purpose |
|---|---|---|---|
| 1 | `supabase/migrations/20260910XXXX_tally_bridge.sql` | **NEW** | 4 tables + invoice column + RLS + indexes |
| 2 | `src/lib/tallyXml.ts` | **NEW** | Pure Tally XML builders (Sales/Receipt/Ledger) + `parseTallyResponse` |
| 3 | `src/lib/__tests__/tallyXml.test.ts` | **NEW** | Unit tests — assert exact XML strings (GST split, IRN/EWB, narration, branch) |
| 4 | `src/lib/tallySync.ts` | **NEW** | `enqueueForTallyPass`, `approveForTally`, `approveAll`, `fetchTallyQueue`, `tallyStatusBadge`, `isPassEligible` (gate) |
| 5 | `src/lib/__tests__/tallySync.test.ts` | **NEW** | Unit tests — enqueue/approve/fetch, gate logic, role check |
| 6 | `src/routes/_app/sales.tally-bridge.tsx` | **NEW** | Owner dashboard route (admin-only) |
| 7 | `src/routes/_app/sales.invoices.index.tsx` | **MODIFY** | Add Tally status column/badge |
| 8 | `src/routes/_app/sales.invoices.$id.tsx` | **MODIFY** | Add sync badge + Pass button (admin, when eligible) |
| 9 | `src/lib/sales.ts` | **MODIFY** | Add `tally_sync_status` to `InvoiceRow` type |
| 10 | `bridge/package.json` | **NEW** | Standalone bridge deps + scripts |
| 11 | `bridge/config.json` | **NEW** | Runtime config (gitignored) |
| 12 | `bridge/config.example.json` | **NEW** | Template |
| 13 | `bridge/src/index.ts` | **NEW** | Entry — poll loops, signal handling |
| 14 | `bridge/src/supabaseClient.ts` | **NEW** | Supabase client for queue + heartbeat |
| 15 | `bridge/src/tallyClient.ts` | **NEW** | HTTP client for Tally :9000 |
| 16 | `bridge/src/syncProcessor.ts` | **NEW** | Queue processor (outbound) |
| 17 | `bridge/src/pullSync.ts` | **NEW** | (Phase 2) Export from Tally → Supabase |
| 18 | `bridge/src/heartbeat.ts` | **NEW** | Heartbeat + reachability |
| 19 | `bridge/mock-tally.js` | **NEW** | Dev mock Tally server for Mac |
| 20 | `bridge/README.md` | **NEW** | Setup, Tally port config, autostart, packaging |
| 21 | `bridge/scripts/launch.bat` | **NEW** | Windows launcher |
| 22 | `.gitignore` | **MODIFY** | Add `bridge/config.json` |

---

## 12. Build Plan — Waves & Tasks

### Wave 1 — Database

| Task | Acceptance |
|---|---|
| Write migration `20260910XXXX_tally_bridge.sql` (4 tables + column + RLS + indexes) | File exists, `supabase db push` succeeds, `\d tally_sync_queue` shows all columns, `UNIQUE(invoice_id)` enforced |
| Verify RLS | Staff `SELECT` on queue succeeds; staff `UPDATE queue SET status='approved'` succeeds at RLS level (app gate is the real control); service_role bypasses RLS |

### Wave 2 — Core Library (Pure, Testable)

| Task | Acceptance |
|---|---|
| `src/lib/tallyXml.ts` — `buildSalesVoucher`, `buildReceiptVoucher`, `buildLedgerCreate`, `parseTallyResponse`, `gstLedgerName(rate, type)` | `npm test` — XML contains correct `VOUCHER`, `ALLLEDGERENTRIES`, `INVENTORYENTRIES`, `IRNNO`/`EWAYBILLNO` when present, `NARRATION [Branch]` |
| GST ledger mapping | Intra-state → CGST+SGST split; inter-state → IGST; cess and round-off ledgers when non-zero; ledger names match Tally masters |
| `src/lib/tallySync.ts` — enqueue/approve/fetch/badge/gate | `npm test` — `isPassEligible(invoice)` returns true only when `getInvoiceCompletionStatus()==='complete'`; `enqueue` inserts `awaiting_pass`; `approve` sets `approved` + `approved_by/at` + frozen `payload_json`; non-admin approve throws |

### Wave 3 — UI

| Task | Acceptance |
|---|---|
| `sales.tally-bridge.tsx` owner dashboard | Route renders for admin, redirects non-admin; shows 4 sections; `[PASS]` per row and `[PASS ALL]`; clicking updates queue and shows toast; heartbeat Online/Offline visible |
| Invoice list + detail badges | `sales.invoices.index.tsx` shows Tally column; `sales.invoices.$id.tsx` shows badge + Pass button (admin, when eligible); non-eligible shows grey "IRN pending" |
| `sales.ts` type update | `InvoiceRow` includes `tally_sync_status`; no TS errors |

### Wave 4 — Bridge Agent

| Task | Acceptance |
|---|---|
| `bridge/` scaffold — `package.json`, `config.example.json`, `.gitignore` | `npm install` in `bridge/` succeeds; `config.json` gitignored |
| `tallyClient.ts` + `supabaseClient.ts` | `tallyClient.post(xml)` POSTs to `localhost:9000`; `ping()` returns boolean; Supabase client reads `tally_sync_queue` |
| `syncProcessor.ts` + `heartbeat.ts` + `index.ts` | Bridge polls `approved` rows, builds XML via shared `tallyXml`, POSTs, handles `CREATED`/`ERRORS`/offline, updates queue + `invoices.tally_sync_status`, sends heartbeat |
| `mock-tally.js` | `node mock-tally.js` listens on :9000, logs received XML, returns `CREATED=1` |
| `bridge/README.md` + `launch.bat` | Steps: Tally port 9000 enable, config fill, `node src/index.js`, PM2/NSSM autostart, `pkg` packaging |

### Wave 5 — Integration & Hardening

| Task | Acceptance |
|---|---|
| End-to-end: create invoice → complete IRN+EWB → enqueue → owner PASS → bridge → Tally voucher | Voucher appears in Tally Day Book with correct party, GST breakup, IRN/EWB, `[Branch]` narration |
| Offline: stop Tally, click PASS, verify queue stays `approved`, restart Tally → auto-completes | Queue transitions correctly, no data loss |
| Missing ledger: push invoice for unknown customer → failed with readable error → [Retry] after ledger exists | Error message is human-readable, retry succeeds |
| Branch: create invoices from 3 branches → each voucher has correct `[Branch]` narration | Tally Day Book shows branch tags |
| `npm run build` + `npm test` green | No regressions |

---

## 13. Verification Plan — How We Prove It Works

### 13.1 Automated (CI)

| Check | Command | Must Pass |
|---|---|---|
| Types | `npm run build` (Vite + tsc) | No TS errors |
| Unit tests | `npm test` (`tallyXml.test.ts`, `tallySync.test.ts`, existing `invoiceJsonFix.test.ts`) | All green |
| Lint | `npm run lint` (if configured) | No errors |

### 13.2 Manual — Per-Wave

See Wave 5 table above. Key scenarios:

1. **Happy path:** Branch A invoice → IRN+EWB → Awaiting Pass → owner PASS → Tally voucher with correct GST split + IRN/EWB + `[Branch A]`.
2. **Gate:** Incomplete invoice (no IRN) → not in Awaiting Pass → completes IRN → appears.
3. **Bulk:** 12 pending → PASS ALL → all 12 vouchers in Tally sequentially, no dupes.
4. **Offline:** Tally closed → PASS stays `approved` → open Tally → auto-syncs.
5. **Ledger missing:** Unknown customer → failed → create ledger in Tally → Retry → completed.
6. **Idempotency:** Click PASS twice on same invoice → second is no-op (UNIQUE + reference_no dedup).
7. **Permissions:** Branch user cannot open `/sales/tally-bridge`; admin can; branch user sees only own badge.

---

## 14. Mac Development Setup — How to Build Without Windows

### 14.1 The Separation

| Machine | Role | Runs |
|---|---|---|
| **Your Mac** | Dev only | Prokon code, `npm test`, Vite, mock Tally, bridge build |
| **Windows PC** (owner's office) | Prod | TallyPrime + bridge agent |

You **build on Mac, run on Windows**. No Tally/bridge runs on the Mac in production.

### 14.2 Testing the Tally Connection on Mac (No Windows Needed)

Use the included **mock Tally server** — a 20-line Node.js HTTP server that emulates Tally's `localhost:9000` response:

```js
// bridge/mock-tally.js — run on Mac during dev
const http = require("http");
http.createServer((req, res) => {
  let body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    console.log("=== Mock Tally received XML ===\n", body.slice(0, 2000));
    res.writeHead(200, { "Content-Type": "application/xml" });
    res.end(`<ENVELOPE><BODY><DATA><LINE><TALLYRESPONSE><CREATED>1</CREATED><ERRORS>0</ERRORS></TALLYRESPONSE></LINE></DATA></BODY></ENVELOPE>`);
  });
}).listen(9000, () => console.log("Mock Tally on :9000"));
```

```bash
# Terminal 1 — mock Tally
node bridge/mock-tally.js
# Terminal 2 — bridge (pointed at mock)
node bridge/src/index.js   # with config tally.port=9000 on localhost
# Terminal 3 — verify XML
# Check mock logs for correct GST ledgers, IRNNO, EWAYBILLNO, NARRATION
```

The bridge targets `localhost:9000` regardless — on Mac it hits the mock, on Windows it hits real Tally. **Same code, same XML, verified.**

### 14.3 If You Want Real Tally on Mac (Optional, For Full E2E Testing Only)

| Option | Cost | Notes |
|---|---|---|
| **Parallels Desktop** + Windows 11 ARM VM | Paid | Tally rated "Runs Great" (CodeWeavers); needs 16GB+ RAM, ~80GB free disk; 4 vCPU + 8GB for VM |
| **UTM** + Windows 11 ARM | Free, open-source | Lighter, Apple Silicon native |
| **CrossOver** (CodeWeavers) | Paid | Runs Tally without Windows license; rated "Runs Great" but XML gateway + DSC/token may be flakier |

> These are **only for your own developer testing**. Production still uses the separate Windows PC. The VM's `localhost:9000` works the same way.

### 14.4 Shipping the Bridge to Windows

| Method | Steps |
|---|---|
| **Plain Node (simplest)** | Copy `bridge/` folder to Windows PC → `npm install` → fill `config.json` → `node src/index.js` |
| **Packaged .exe (no Node needed on Windows)** | On Mac: `npx pkg bridge/src/index.js --targets node18-win-x64 --output bridge/prokon-bridge.exe` → copy `.exe` + `config.json` to Windows → double-click or Task Scheduler |

Cross-platform guarantee: bridge uses only `fetch` (Node 18+ built-in) + `@supabase/supabase-js` — no macOS-specific deps.

---

## 15. Cost Analysis

| Component | Cost | Notes |
|---|---|---|
| TallyPrime HTTP/XML gateway | **₹0** | Built-in, no subscription, no API key |
| Bridge agent (Node.js) | **₹0** | Open-source, runs on your own Windows PC |
| Supabase tables (4 tables + column) | **₹0** | Within free tier |
| Vercel hosting (Prokon) | **₹0** | Existing hosting |
| Mock Tally (dev) | **₹0** | 20-line Node script |
| Parallels/Windows (only if you want real Tally on Mac for testing) | Paid, optional | Not needed for production |
| **Total for live system** | **₹0** | — |
| Busy Gold (legacy, during migration) | Existing subscription | Keep during parallel testing, then de-prioritize |

---

## 16. Constraints, Risks & Mitigations

| # | Constraint / Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **Tally must be running** when bridge pushes | PASS stays `approved` until Tally online | Bridge retries every 15s; dashboard shows `○ Tally Offline — waiting`; no data loss |
| 2 | **Bridge PC must be on** | All 3 branches' sync pauses if owner's PC off | Invoices still save in Prokon; queue persists; auto-sync when PC returns |
| 3 | **Ledger names must match** | Tally rejects voucher if party/GST ledger missing | Bridge auto-creates missing party + GST ledgers via `LEDGER ACTION="Create"` before voucher |
| 4 | **GST ledger names** | Must exactly match Tally masters (`CGST 9%` etc.) | `gstLedgerName()` maps from `computeTotals` buckets; mismatch → bridge creates ledger |
| 5 | **Voucher numbering** | Tally auto-numbers; branches don't get separate series | Let Tally auto-number (safest); if you need `A/001` `B/001`, create separate voucher types per branch in Tally |
| 6 | **Duplicate push** | Same invoice pushed twice | `UNIQUE(invoice_id)` in queue + `REFERENCE` dedup check in `tally_vouchers` |
| 7 | **Cloud cannot reach Tally** | Vercel cannot POST to `localhost:9000` | Queue decouples: web UI enqueues, bridge (on same LAN as Tally) dequeues |
| 8 | **Network drop (bridge ↔ Supabase)** | Bridge loses Supabase connection | Exponential backoff retry, local log, heartbeat shows `offline` |
| 9 | **Staff edits after approval** | Invoice changed after owner approved | `payload_json` is frozen at approval time; bridge pushes the snapshot, not live row |
| 10 | **E-invoice/eway changes after pass** | IRN/EWB updated post-sync | Phase 2: allow re-push as `ALTER` voucher; for now, failed/completed is terminal |
| 11 | **Mac cannot run Tally natively** | No Tally on macOS | Mock Tally for dev; optional VM for real-Tally testing; prod is Windows PC |
| 12 | **Busy → Prokon migration** | Staff may still create invoices in Busy | Policy: Prokon is sole billing source; Busy kept for parallel testing only |

---

## 17. Migration & Cutover — From Busy to Tally Bridge

```
Phase 0 (now)         Busy Gold handles e-invoices + some billing
                      Tally has single company, some manual entries
                      Prokon invoicing live for some branches

Phase 1 (build)       Build Tally Bridge (this plan) on Mac with mock Tally
                      No prod impact — all new tables/routes are additive

Phase 2 (shadow)      Deploy Prokon + bridge to Windows PC
                      Shadow mode: create test invoices in Prokon, PASS to Tally,
                      verify GST ledgers, IRN/EWB, branch narration in Tally Day Book
                      Keep Busy running — compare outputs

Phase 3 (cutover)     Standardize: ALL invoicing on Prokon at all 3 branches
                      Every bill goes through PASS BILL → Tally
                      Staff stop creating invoices directly in Tally/Busy

Phase 4 (steady)      Tally = single accounting book (GST filing, P&L, ledger)
                      Prokon = operational system (CRM, inventory, invoicing, e-invoice, eway)
                      Busy = legacy/optional, de-prioritized
                      Optional: add Cost Centres in Tally for per-branch P&L
                      Optional: add bridge pull-sync (Tally → Prokon mirror)
```

---

## 18. Security & Permissions

| Concern | Handling |
|---|---|
| **Who can PASS bills** | `approveForTally()` checks `isOwnerOrAdmin(currentUser)` via `src/lib/permissions.ts` + `src/lib/account-gate.ts` pattern; non-admin gets 403/toast. RLS on queue is permissive for reads; app gate is the real control |
| **Who can see Tally Bridge dashboard** | Route guard in `sales.tally-bridge.tsx` — non-admin redirected to `/sales` |
| **Who can see Tally status on invoices** | All staff see badge on own branch invoices; admin sees all |
| **Bridge credentials** | `config.json` holds Supabase anon key + service-role key (for heartbeat) + Tally company name. **Never committed** — `bridge/config.json` gitignored, `config.example.json` committed as template |
| **Supabase keys on Windows PC** | Use a scoped anon key for queue reads + a minimal service-role key for heartbeat writes; rotate periodically |
| **Tally access** | Bridge only talks to `localhost:9000` on the Windows PC; no inbound ports opened; no internet-exposed Tally |
| **Payload freeze** | `payload_json` snapshot at approval time prevents post-approval tampering |

---

## Appendix A — Reference File Map

| Path | Role |
|---|---|
| `src/lib/sales.ts` | Invoice/Branch/Payment types, SALES_TYPES |
| `src/lib/gst.ts` | GST computation (`computeTotals`, `hsnSummary`) |
| `src/lib/invoiceJson.ts` | NIC v1.03 + eway JSON builders (pure) |
| `src/lib/einvoice.ts` | `getInvoiceCompletionStatus` (e-invoice/eway gate) |
| `src/lib/transport.ts` | `computeEInvoiceRequired`, `computeEWayRequired`, TransportDetails |
| `src/lib/india.ts` | GSTIN/PIN/vehicle validation |
| `src/lib/money.ts` | `r2` rounding |
| `src/lib/tallyLedger.ts` | Stock ledger (read-only, not accounting — not reused for bridge) |
| `src/routes/_app/sales.invoices.new.tsx` | Invoice creation (enqueue hook added) |
| `src/routes/_app/sales.invoices.index.tsx` | List (badge added) |
| `src/routes/_app/sales.invoices.$id.tsx` | Detail + Compliance Cockpit (Pass button added) |
| `src/routes/_app/sales.eway.index.tsx` | E-way registry |
| `src/routes/_app/sales.payments.*` | Payments (future: receipt vouchers) |
| `src/lib/permissions.ts` | Role checks |
| `supabase/migrations/*.sql` | Existing migrations — new one added here |
| `src/integrations/supabase/client.ts` | Browser Supabase client |
| `src/integrations/supabase/client.server.ts` | Service-role client (server only) |
| `src/server.ts` | SSR entry — no custom API routes |

---

## Appendix B — Tally XML Examples

### B.1 Sales Voucher (Minimal Intra-State, 1 Item, With IRN/EWB)

```xml
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
            <DATE>20260908</DATE>
            <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
            <PARTYLEDGERNAME>Acme Traders Pvt Ltd</PARTYLEDGERNAME>
            <NARRATION>[Branch A] INV-2026/0042 — Prokon</NARRATION>
            <REFERENCE>INV-2026/0042</REFERENCE>
            <IRNNO>e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855</IRNNO>
            <IRNDATE>08092026</IRNDATE>
            <EWAYBILLNO>123456789012</EWAYBILLNO>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Acme Traders Pvt Ltd</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
              <AMOUNT>-11800.00</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>Sales</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>10000.00</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>CGST 9%</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>900.00</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>SGST 9%</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>900.00</AMOUNT>
            </ALLLEDGERENTRIES.LIST>
            <INVENTORYENTRIES.LIST>
              <ITEMNAME>UPS-600VA</ITEMNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <RATE>5000.00</RATE>
              <QUANTITY>2 NOS</QUANTITY>
              <AMOUNT>10000.00</AMOUNT>
              <ACCOUNTINGALLOCATIONS.LIST>
                <LEDGERNAME>Sales</LEDGERNAME>
                <AMOUNT>10000.00</AMOUNT>
              </ACCOUNTINGALLOCATIONS.LIST>
            </INVENTORYENTRIES.LIST>
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
```

### B.2 Inter-State (IGST Only)

Same structure, but GST ledgers become a single `IGST 18%` entry (e.g., `1800.00`) instead of CGST+SGST pair. `is_interstate` from Prokon determines the split.

### B.3 Ledger Auto-Create

```xml
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <LEDGER NAME="New Customer Pvt Ltd" ACTION="Create">
            <NAME>New Customer Pvt Ltd</NAME>
            <PARENT>Sundry Debtors</PARENT>
            <GSTIN>09ABCDE1234F1Z5</GSTIN>
            <LEDGERMOBILE>9876543210</LEDGERMOBILE>
          </LEDGER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
```

### B.4 Export (Pull Vouchers from Tally — Phase 2)

```xml
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Day Book</REPORTNAME>
        <STATICVARIABLES>
          <SVFROMDATE>20260901</SVFROMDATE>
          <SVTODATE>20260908</SVTODATE>
          <SVCURRENTCOMPANY>Your Company Name</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>
```

### B.5 Tally Success / Error Responses

```xml
<!-- Success -->
<ENVELOPE><BODY><DATA><LINE><TALLYRESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS></TALLYRESPONSE></LINE></DATA></BODY></ENVELOPE>

<!-- Error -->
<ENVELOPE><BODY><DATA><LINE><TALLYRESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS></TALLYRESPONSE></LINE><LINEERROR>Ledger "Foo" does not exist</LINEERROR></DATA></BODY></ENVELOPE>
```

---

## Appendix C — Bridge Config Reference

| Key | Default | Description |
|---|---|---|
| `supabaseUrl` | — | Supabase project URL |
| `supabaseAnonKey` | — | Anon key (queue reads) |
| `supabaseServiceRoleKey` | — | Service role key (heartbeat writes, optional) |
| `tally.host` | `localhost` | Tally host |
| `tally.port` | `9000` | Tally HTTP port |
| `tally.company` | — | Company name as in Tally |
| `tally.timeoutMs` | `15000` | POST timeout |
| `poll.queueIntervalMs` | `15000` | Queue poll interval |
| `poll.heartbeatIntervalMs` | `30000` | Heartbeat interval |
| `poll.pullIntervalMs` | `3600000` | Pull-sync interval (phase 2) |
| `retry.maxRetries` | `4` | Max retries before `failed` |
| `retry.backoffMs` | `[5s,15s,60s,300s]` | Backoff schedule |

---

## Appendix D — Glossary

| Term | Meaning |
|---|---|
| **Tally Bridge** | The overall integration: Prokon queue + bridge agent + Tally XML gateway |
| **Bridge agent** | Standalone Node.js service on the Windows PC that moves approved bills to Tally |
| **Pass Bill** | Owner approval action — moves queue row from `awaiting_pass` → `approved` |
| **Gate / Complete** | `getInvoiceCompletionStatus() === 'complete'` — IRN present when B2B, EWB present when ≥₹50k |
| **Mock Tally** | Dev-only Node.js HTTP server on Mac that emulates Tally's `:9000` response |
| **Cost Centre** | Tally feature for per-branch P&L (optional upgrade from narration prefix) |
| **IRN / EWB** | E-invoice reference number (64-hex) / E-way bill number (12-digit), generated in Prokon |
| **NIC JSON** | National Informatics Centre e-invoice JSON format (v1.03) built by `invoiceJson.ts` |
| **GSP** | GST Suvidha Provider — not used; Prokon builds NIC JSON for manual upload |
| **RLS** | Row Level Security (Supabase Postgres) |

---

*End of plan. This file is the single source of truth for the Tally Bridge build. When build mode executes, waves are implemented in order: DB → lib (XML + sync) → UI → bridge → integration.*
