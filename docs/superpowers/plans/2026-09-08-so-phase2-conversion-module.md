# Sales Order → Conversion Module (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a robust SO-to-Conversion system supporting Tax Invoice, General DC, and Proforma Invoice from Sales Orders, with full partial-delivery support (qty reservation, carry-forward, and lineage tracking).

**Architecture:** Pure mapping layer (`documentFlow.ts` style) + DB writers (`documentFlow.writers.ts` style) + new DB migrations + new UI buttons. All conversions auto-populate from SO fields (editable), stock affected for Tax Invoice and General DC only, Proforma is read-only.

**Tech Stack:** TypeScript/React (TanStack Router), Supabase (PostgreSQL + RLS), React Query, existing GST engine, existing IMS stock triggers.

**Spec:** This document.

---

## Global Constraints

- No Vercel deployment into Prokon accounts
- No GitHub push/merge until explicitly told
- Strict project isolation: never touch `sewadar-attendance`
- All new tables must have RLS policies matching existing patterns
- Stock posting must use existing IMS trigger architecture (`ims_stock_items`, `ims_transactions`)
- Proforma Invoice must NOT affect any stock whatsoever
- Partial deliveries must carry-forward remaining qty and reference prior fulfilled qty
- Existing tests in `src/lib/__tests__/documentFlow.test.ts` must keep passing

---

## Current Architecture Summary

### Document Flow Chain (existing)
```
Quotation → Sales Order → Delivery Challan → Invoice
```
- `src/lib/documentFlow.ts` — pure mapping functions (no DB calls)
- `src/lib/documentFlow.writers.ts` — Supabase writers (hydrate parties, compute GST, persist)
- `src/lib/salesOrders.ts` — SO types + fetch helpers
- `src/lib/sales.ts` — Invoice types + helpers
- `src/lib/challan.ts` — Delivery Challan types
- `src/lib/generalDc.ts` — General DC types + GDC→Invoice prefill

### Stock System (existing)
- `src/lib/ims.ts` — IMS stock items, transactions, reservations, warehouses
- Stock posted via **triggers** on `invoice_items` and `general_delivery_challans`
- `ims_stock_items`: `stock_status` (available/issued/reserved/etc), `warehouse_id`
- `ims_transactions`: `good_out`/`good_in` entries for every stock movement
- Serial tracking via `serial_numbers[]` JSONB on invoice_items

### Key DB Tables
- `sales_orders` — `items JSONB`, `status`, `so_no`, `linked_quote_id`, `branch_id`, `customer_id`
- `invoices` — `invoice_items[]`, `sales_order_id`, `linked_dc_ids`, `skip_stock_posting`, `source_general_dc_id`, `allow_negative_stock`
- `delivery_challans` — `items ChallanItem[]`, `sales_order_id`, `status`
- `general_delivery_challans` — `items GeneralDcItem[]`, `status`, `converted_invoice_id`, `allow_negative_stock`

### Stock Posting Logic
- **Invoice**: Trigger `invoice_item_sync_serials_strict()` on `invoice_items` — moves serials from `available` → `issued`, creates `good_out` txn
- **Invoice**: `skip_stock_posting=true` + `source_general_dc_id` bypasses stock deduction (GDC stock already left)
- **General DC**: Trigger on `general_delivery_challans` — posts stock when status = "Issued"
- **Delivery Challan**: Trigger posts stock when "Challan Generated"/"Submitted"

---

## Phase 1: Database Schema & Migrations

### Task 1.1: Add `sales_order_items_reserved` tracking + `conversion_ledger` table

**Files:** `supabase/migrations/20260910000001_so_conversion_schema.sql`

**Rationale:** Track partial deliveries. When a SO has 20 qty and 17 are invoiced, the remaining 3 must be tracked and the lineage preserved.

```sql
-- Track qty fulfilled per SO line item
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS 
  delivered_qty JSONB DEFAULT '{}'::jsonb;
-- Key: item index, Value: { qty_invoiced: N, qty_dc: M, qty_proforma: P }

-- Conversion ledger — full audit trail of every conversion
CREATE TABLE IF NOT EXISTS public.so_conversion_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  source_doc_type TEXT NOT NULL, -- 'quotation' | 'sales_order' | 'general_dc'
  source_doc_id UUID,
  conversion_type TEXT NOT NULL, -- 'tax_invoice' | 'general_dc' | 'proforma_invoice'
  target_doc_id UUID, -- invoice_id or dc_id or proforma_id
  items JSONB NOT NULL, -- [{item_index, qty, description, ...}]
  delivered_qty JSONB NOT NULL, -- cumulative fulfilled qty after this conversion
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conv_ledger_so ON public.so_conversion_ledger(sales_order_id);
CREATE INDEX idx_conv_ledger_type ON public.so_conversion_ledger(conversion_type);

-- Proforma invoices table (read-only, no stock)
CREATE TABLE IF NOT EXISTS public.proforma_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_no TEXT UNIQUE,
  proforma_date DATE NOT NULL DEFAULT CURRENT_DATE,
  branch_id UUID REFERENCES public.branches(id),
  customer_id UUID REFERENCES public.customers(id),
  sales_order_id UUID REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  source_doc_type TEXT, -- 'sales_order' | 'quotation'
  source_doc_id UUID,
  
  -- Party snapshots (same shape as invoices)
  seller_name TEXT, seller_gstin TEXT, seller_state TEXT, seller_state_code TEXT,
  seller_address TEXT,
  buyer_name TEXT, buyer_gstin TEXT, buyer_state TEXT, buyer_state_code TEXT,
  billing_address TEXT, shipping_address TEXT, place_of_supply TEXT, place_of_supply_code TEXT,
  is_interstate BOOLEAN DEFAULT false, reverse_charge BOOLEAN DEFAULT false,
  
  -- Money
  subtotal NUMERIC(14,2) DEFAULT 0, discount NUMERIC(14,2) DEFAULT 0,
  taxable_value NUMERIC(14,2) DEFAULT 0, cgst NUMERIC(14,2) DEFAULT 0,
  sgst NUMERIC(14,2) DEFAULT 0, igst NUMERIC(14,2) DEFAULT 0, cess NUMERIC(14,2) DEFAULT 0,
  round_off NUMERIC(14,2) DEFAULT 0, total NUMERIC(14,2) DEFAULT 0, total_in_words TEXT,
  
  -- Item details (same as invoice_items shape but stored inline)
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Delivery tracking
  delivered_qty JSONB DEFAULT '{}'::jsonb,
  is_delivered BOOLEAN DEFAULT false,
  
  status TEXT NOT NULL DEFAULT 'draft', -- draft | issued | cancelled | delivered
  notes TEXT, terms TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_proforma_so ON public.proforma_invoices(sales_order_id);
CREATE INDEX idx_proforma_customer ON public.proforma_invoices(customer_id);
```

### Task 1.2: Update `invoices` table for partial delivery lineage

**Files:** `supabase/migrations/20260910000002_invoice_partial_lineage.sql`

```sql
-- Track how much of the SO was already fulfilled before this invoice
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS 
  prior_fulfilled_qty JSONB DEFAULT '{}'::jsonb;
-- Key: item index, Value: { qty_already_invoiced, qty_already_dc, qty_already_proforma }

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS 
  so_line_qtys JSONB DEFAULT '{}'::jsonb;
-- Key: item index, Value: { ordered_qty, delivered_qty, remaining_qty }

-- Link invoices back to their proforma source if applicable
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS 
  linked_proforma_id UUID REFERENCES public.proforma_invoices(id);

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS 
  conversion_source TEXT DEFAULT 'direct'; -- 'direct' | 'from_proforma' | 'from_dc'
```

### Task 1.3: Add `proforma_invoice_settings` & auto-number sequence

**Files:** `supabase/migrations/20260910000003_proforma_numbering.sql`

```sql
CREATE TABLE IF NOT EXISTS public.proforma_invoice_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID,
  prefix TEXT NOT NULL DEFAULT 'PHS/PI/',
  fy_reset BOOLEAN NOT NULL DEFAULT true,
  current_fy TEXT,
  next_seq INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_id)
);
-- Same pattern as sales_order_settings / po_settings

CREATE OR REPLACE FUNCTION public.set_proforma_no()
RETURNS trigger ... -- identical pattern to set_so_no()
```

### Task 1.4: Add RLS policies for new tables

```sql
-- proforma_invoices policies
-- Follow exact pattern from invoices (read/insert/update/delete)
-- so_conversion_ledger policies (select + insert)
```

---

## Phase 2: Core Conversion Engine (Pure Functions)

### Task 2.1: Extend `documentFlow.ts` with new conversion types & partial support

**Files:** `src/lib/documentFlow.ts` (modify), `src/lib/__tests__/documentFlow.test.ts` (modify/add)

**New types to add:**

```typescript
// ── Conversion Types ──
export type ConversionType = "tax_invoice" | "general_dc" | "proforma_invoice";

export type SoItemConversion = {
  item_index: number;
  original_qty: number;
  qty_to_convert: number;  // partial qty being converted NOW
  qty_already_invoice: number;
  qty_already_dc: number;
  qty_already_proforma: number;
  description: string;
  product_id: string | null;
  hsn: string | null;
  rate: number;
  discount_pct: number;
  gst_rate: number;
  cess_rate?: number;
  unit: string | null;
  warehouse_id: string | null;
  serial_numbers?: string[];
  is_serialized?: boolean;
  part_model_no?: string | null;
  part_name?: string | null;
};

export type ConversionSummary = {
  total_items: number;
  total_ordered_qty: number;
  total_already_fulfilled_qty: number;
  total_new_qty: number;
  items: SoItemConversion[];
  can_convert: boolean;  // false if trying to convert more than remaining
};

// ── New pure functions ──

/**
 * Compute conversion summary for a Sales Order.
 * Returns per-item remaining qty and whether the requested conversion is valid.
 * 
 * @param so - The SalesOrder
 * @param conversionType - tax_invoice | general_dc | proforma_invoice
 * @param requestedQtys - Map of item_index → qty to convert (or null for all remaining)
 */
export function computeSOConversion(
  so: SalesOrder,
  conversionType: ConversionType,
  requestedQtys?: Record<number, number>
): ConversionSummary;

/**
 * Build partial-delivery aware line items for a new document.
 * Each item gets only the qty being converted now (not the full qty).
 * 
 * @param so - Source SO
 * @param itemConversions - Array of per-item conversion specs
 * @param conversionType - affects tax treatment and stock behavior
 */
export function buildConversionItems(
  so: SalesOrder,
  itemConversions: SoItemConversion[],
  conversionType: ConversionType
): SoItem[];

/**
 * Compute cumulative delivered qty for a SO across all documents.
 * Reads from delivered_qty JSONB on the SO + existing invoices/DCs/proformas.
 */
export function computeDeliveredQtys(so: SalesOrder): Record<number, {
  qty_invoiced: number;
  qty_dc: number;
  qty_proforma: number;
  remaining: number;
}>;

/**
 * Build a Proforma Invoice payload (read-only, no stock).
 * Structure mirrors salesOrderToInvoice but marks as proforma.
 */
export function salesOrderToProformaInvoice(
  so: SalesOrder,
  itemConversions: SoItemConversion[],
  priorFulfilled: Record<number, { qty_already_invoice: number; qty_already_dc: number; qty_already_proforma: number }>
): ProformaInvoicePayload;

// New payload type
export type ProformaInvoicePayload = {
  branch_id: string | null;
  customer_id: string | null;
  proforma_date: string;
  // ... all party/snapshot fields (same as invoice)
  items: SoItem[];
  sales_order_id: string;
  source_doc_type: string;
  source_doc_id: string | null;
  delivered_qty: Record<number, number>;  // cumulative fulfilled after this proforma
  // Financial fields
  subtotal: number; discount: number; taxable_value: number;
  cgst: number; sgst: number; igst: number; cess: number;
  round_off: number; total: number; total_in_words: string | null;
  notes: string | null; terms: string | null;
};
```

### Task 2.2: Implement `documentFlow.writers.ts` new writers

**Files:** `src/lib/documentFlow.writers.ts` (modify), `src/lib/__tests__/documentFlow.test.ts` (add)

**New writer functions:**

```typescript
/**
 * Convert SO → Tax Invoice (affects stock).
 * 
 * Business rules:
 * - Auto-populate ALL fields from SO (editable by user)
 * - Deduct stock via existing invoice_item trigger
 * - Set prior_fulfilled_qty and so_line_qtys on the invoice
 * - Update SO.delivered_qty JSONB
 * - Insert into so_conversion_ledger
 * - Idempotent: same SO + same items won't create duplicate invoice
 * 
 * @param so - Source SalesOrder
 * @param itemConversions - Per-item qty breakdown (partial support)
 * @param overrideFields - Editable overrides (billing_addr, notes, etc.)
 */
export async function createTaxInvoiceFromSO(
  so: SalesOrder,
  itemConversions: SoItemConversion[],
  overrideFields?: Partial<NewInvoicePayload>
): Promise<{ id: string; invoice_no: string | null; ledgerId: string }>;

/**
 * Convert SO → General DC (affects stock, same as tax invoice).
 * 
 * Business rules:
 * - Uses General DC trigger (posts stock on "Issued")
 * - Set so_line_qtys tracking
 * - Insert into so_conversion_ledger
 * 
 * @param so - Source SalesOrder
 * @param itemConversions - Per-item qty breakdown
 * @param overrideFields - Editable overrides
 */
export async function createGeneralDCFromSO(
  so: SalesOrder,
  itemConversions: SoItemConversion[],
  overrideFields?: Partial<GeneralDcRow>
): Promise<{ id: string; dc_no: string | null; ledgerId: string }>;

/**
 * Convert SO → Proforma Invoice (read-only, NO stock).
 * 
 * Business rules:
 * - Does NOT trigger any stock movement
 * - Marks as read-only document (no status change on SO to "invoiced")
 * - Sets SO.status to "confirmed" (or keeps as-is)
 * - Stores delivered_qty tracking
 * - Insert into so_conversion_ledger
 * 
 * @param so - Source SalesOrder
 * @param itemConversions - Per-item qty breakdown
 * @param overrideFields - Editable overrides
 */
export async function createProformaInvoiceFromSO(
  so: SalesOrder,
  itemConversions: SoItemConversion[],
  overrideFields?: Partial<ProformaInvoicePayload>
): Promise<{ id: string; proforma_no: string | null; ledgerId: string }>;

/**
 * Helper: Update SO delivered_qty after a successful conversion.
 */
export async function updateSODeliveredQty(
  soId: string,
  itemConversions: SoItemConversion[],
  conversionType: ConversionType
): Promise<void>;
```

**Idempotency guards:** Same pattern as `createInvoiceFromSalesOrder` — check for existing invoice/DC/proforma linked to SO with same items before inserting.

---

## Phase 3: SO Detail Page UI — Conversion Buttons & Modal

### Task 3.1: Add conversion action buttons to `sales.orders.$id.tsx`

**Files:** `src/routes/_app/sales.orders.$id.tsx` (modify)

**Changes:**
- Add three buttons: "Convert to Tax Invoice", "Convert to General DC", "Convert to Proforma Invoice"
- Each opens a `ConversionModal` component (new)
- Buttons disabled based on SO status (only "confirmed"/"draft" SOs can convert)
- Show remaining qty badge on each button (e.g., "17/20 remaining")

### Task 3.2: Build `ConversionModal` component

**Files:** `src/components/conversion/ConversionModal.tsx` (new), `src/components/conversion/index.ts` (new)

**UI Design:**
1. **Step 1: Select conversion type** — radio/segmented control (Tax Invoice / General DC / Proforma Invoice)
2. **Step 2: Review & edit line items** — table showing each SO item with:
   - Description, HSN, Rate, GST %
   - **Ordered Qty** (from SO)
   - **Already Fulfilled** (computed)
   - **Remaining Qty** (= Ordered − Fulfilled)
   - **Qty to Convert** (editable, defaults to Remaining)
   - Validation: cannot exceed remaining qty
3. **Step 3: Review header fields** — all SO header fields auto-populated, editable:
   - Party details (buyer name, address, GSTIN)
   - Place of supply
   - Payment terms
   - Notes/Terms
   - Shipping address
   - Discount, shipping charges
4. **Step 4: Confirm** — shows summary, totals, stock impact warning if applicable

**Visual behavior by type:**
- **Tax Invoice**: Shows "⚠️ This will deduct stock" badge. All fields editable.
- **General DC**: Shows "⚠️ This will deduct stock" badge. All fields editable.
- **Proforma Invoice**: Shows "📄 Read-only document — no stock impact" badge. All fields editable.

### Task 3.3: Add `useSOConversion` hook

**Files:** `src/lib/useSOConversion.ts` (new)

```typescript
export function useSOConversion(so: SalesOrder | null) {
  // Compute delivered qtys across all documents
  const deliveredQtys = computeDeliveredQtys(so);
  
  // Validate a conversion before submitting
  const validateConversion = (type: ConversionType, qtys: Record<number, number>) => {
    // Each item qty <= remaining qty
  };
  
  // Execute the conversion
  const convert = async (type: ConversionType, itemConversions: SoItemConversion[], overrides?: ...) => {
    switch(type) {
      case 'tax_invoice': return createTaxInvoiceFromSO(...);
      case 'general_dc': return createGeneralDCFromSO(...);
      case 'proforma_invoice': return createProformaInvoiceFromSO(...);
    }
  };
  
  return { deliveredQtys, validateConversion, convert, isLoading };
}
```

---

## Phase 4: Existing System Integration

### Task 4.1: Update SO status transitions

**Files:** `src/lib/documentFlow.writers.ts`, `src/lib/salesOrders.ts`

**Status rules after conversion:**
- SO status stays "confirmed" (or "partial") after any conversion
- After Tax Invoice → SO.status becomes "invoiced" (or "partial" if not all qty converted)
- After General DC → SO.status becomes "partial" (DC is a delivery step)
- After Proforma → SO.status unchanged (read-only doc)
- If all qty fulfilled → SO.status becomes "delivered" or "invoiced"

### Task 4.2: Update `findInvoiceForSalesOrder` and idempotency

**Files:** `src/lib/documentFlow.writers.ts`

**Changes:**
- When checking for existing invoice from SO, also check `so_conversion_ledger` to prevent double-conversion of the same partial qty
- If invoice exists with `linked_proforma_id`, treat as a second conversion (not duplicate)

### Task 4.3: Update invoice list page to show proforma linkage

**Files:** `src/routes/_app/sales.invoices.$id.tsx` (if exists), invoice list components

- Show "From Proforma: PI/26-27/0001" badge if `linked_proforma_id` is set
- Show "Partial Delivery" badge if `prior_fulfilled_qty` indicates previous conversions

### Task 4.4: Update existing `createInvoiceFromSalesOrder` to handle partial

**Files:** `src/lib/documentFlow.writers.ts`

- The existing `createInvoiceFromSalesOrder` must now:
  - Check SO.delivered_qty and subtract already fulfilled
  - Default qty per item = remaining qty (not full SO qty)
  - Set `prior_fulfilled_qty` and `so_line_qtys` on the new invoice
  - Record in `so_conversion_ledger`

---

## Phase 5: Tests & Verification

### Task 5.1: Unit tests for pure functions

**Files:** `src/lib/__tests__/documentFlow.test.ts` (modify)

```typescript
// NEW TESTS:
describe("computeSOConversion", () => {
  it("returns correct remaining qty for full SO");
  it("returns partial remaining after prior invoice converted 17/20");
  it("throws when requested qty exceeds remaining");
});

describe("buildConversionItems", () => {
  it("creates items with only converted qty");
  it("preserves all financial fields from SO");
  it("handles serialized items correctly");
});

describe("computeDeliveredQtys", () => {
  it("returns zeros for fresh SO");
  it("accumulates delivered qty across invoice + DC + proforma");
});

describe("salesOrderToProformaInvoice", () => {
  it("creates proforma with all SO fields");
  it("does NOT include stock fields");
  it("includes prior fulfilled qty in delivered_qty");
});

describe("createTaxInvoiceFromSO", () => {
  it("creates invoice with partial qty");
  it("sets prior_fulfilled_qty correctly");
  it("records in so_conversion_ledger");
});
```

### Task 5.2: Integration tests

**Files:** `src/lib/__tests__/soConversion.integration.test.ts` (new)

- Full flow: SO → partial Tax Invoice → partial Proforma → General DC → final Invoice
- Verify stock counts at each step
- Verify ledger entries
- Verify idempotency (double-click protection)

---

## Phase 6: Documentation

### Task 6.1: Update standalone-module.md

Add section documenting the SO → Conversion flow with partial delivery.

### Task 6.2: Migration notes for operations team

Explain that:
- New `so_conversion_ledger` provides full audit trail
- Proforma invoices don't affect stock
- Partial delivery is the default behavior (not just full conversion)

---

## Risk Assessment & Mitigations

| Risk | Mitigation |
|------|-----------|
| Double-conversion of same qty | Idempotency via `so_conversion_ledger` + advisory locks |
| Stock oversell on partial conversion | Trigger-level guard on `ims_stock_items.available >= qty` |
| Race condition on concurrent conversions | `pg_advisory_xact_lock` on SO row (existing pattern) |
| Proforma accidentally affecting stock | Separate table + separate trigger path + `skip_stock_posting` equivalent |
| Existing `createInvoiceFromSalesOrder` breaks | Wrap in backward-compatible function; add new functions alongside |
| JSONB `delivered_qty` schema drift | Validate with check constraint or trigger |

---

## Task Dependencies & Execution Order

```
Phase 1 (DB) → Phase 2 (Core Engine) → Phase 3 (UI) → Phase 4 (Integration) → Phase 5 (Tests) → Phase 6 (Docs)
```

Phase 2 tasks 2.1 and 2.2 can be parallelized within their sub-dependencies.
Phase 3.1/3.2/3.3 can all be parallelized.
Phase 4 depends on Phase 2 being complete.
Phase 5 depends on everything above.
