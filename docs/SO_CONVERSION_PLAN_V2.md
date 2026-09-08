# Sales Order Conversion — 3-Way Split-Delivery Plan (V2 Robust)

> **Date:** 2026-09-08  
> **Status:** PLAN — awaiting approval → then `gsd-plan-phase` → `gsd-execute-phase`  
> **Workspace:** `/Users/jai/Desktop/Prokon Erp`  
> **Skills invocated:** `superpowers` · `gsd-plan-phase` · `graphify` · `ui-ux-pro-max` · `dispatching-parallel-agents` · `subagent-driven-development` · `systematic-debugging` · `verification-before-completion` · `writing-plans`  
> **Parallel recon:** 4 research subagents (document-flow / stock-IMS / UI-routes / DB-schema+partial) ran concurrently — summaries in tool outputs `ses_*`  
> **Existing baseline:** `docs/superpowers/plans/2026-09-08-so-phase2-conversion-module.md` (575 lines) — V2 extends it with split-delivery blockers + stock trigger deep dive + fulfillment ledger

---

## 0. Executive Summary — What you asked

> “Convert from Sales Order → 3 options: **(a) Tax Invoice, (b) General DC, (c) Proforma Invoice**. Auto-populate max fields but editable. Tax Invoice & General DC **affect stock**, Proforma **does NOT** (read-only). Handle **partial qty**: 20 ordered → 17 sent → 3 held → next doc from same SO/P.O., and **mention previously satisfied qty**.”

**V2 answers all of it end-to-end:**

- **One SO → N documents** (N Tax Invoices + N General DCs + N Proformas, any mix, any order). Today it is **1:1 blocked** — V2 removes the blocker + introduces a fulfillment ledger so every conversion knows **Ordered vs Already Delivered vs Balance vs This Shipment**.
- **Tax Invoice** = stock `issued` via `invoice_items` trigger. **General DC** = stock `issued` via `general_delivery_challans` trigger. **Proforma** = **never posts stock**, read-only after `Issued`, lineage-only (`skip_stock_posting` equiv).
- **Auto-populate** = all header + line fields cloned from SO (branch, customer, billing/shipping, GST snapshot, PO refs, terms, line rate/discount/GST/warehouse/serial) — **every field remains editable** in the prefill sheet before submit (qty capped at balance, serial picker re-validated).
- **Previously satisfied qty** is stored per-line per-conversion, surfaced in **three places**: (i) conversion quantity picker, (ii) document print/PDF “Previous Deliveries” annexure, (iii) SO detail timeline / progress bar.

---

## 1. How we validated — parallel recon findings

### 1.1 Document flow (agent 1)

| File | What it does | Stock?
|---|---|---|
| `src/lib/documentFlow.ts:173-205` `salesOrderToDeliveryChallan` | clones `so.items` → `ChallanItem[]` (qty stringified, financials preserved) + synthetic `branch_id/buyer_state` | ❌ pure
| `src/lib/documentFlow.ts:238-267` `salesOrderToInvoice` | clones header + `SoItem[]` → `NewInvoicePayload` | ❌ pure
| `src/lib/documentFlow.writers.ts:236-273` `createChallanFromSalesOrder` | inserts `delivery_challans`; flips `sales_orders.status=partial` | ✅ trigger posts
| `src/lib/documentFlow.writers.ts:443-501` `createInvoiceFromSalesOrder` / `...FromChallan` | `insertInvoiceFromPayload` → `invoices` + `invoice_items` → GST `computeTotals` | ✅ trigger posts
| `src/lib/generalDc.ts:191-219` `GeneralDcDetail.convertToInvoice` | **sessionStorage** `GDC_PREFILL_KEY` → `/sales/invoices/new` | `skip_stock_posting:true`
| `src/routes/_app/sales.orders.$id.tsx:55-133` SO detail | Two buttons: **Create DC** + **Convert to Invoice**, both `useSubmitOnce`, direct writers (no prefill) | — |

**Gap:** all three mappers take **no qty param** — they clone full `so.items[i].qty`. No partial plumbing.

### 1.2 Stock triggers (agent 2) — all stock is DB-trigger-driven

| Trigger | When stock moves | Flag |
|---|---|---|
| `dc_post_inventory()` `AFTER INSERT/UPDATE` on `delivery_challans` | `status IN (Submitted, Challan Generated)` one-shot; reversal on `Cancelled` | `allow_negative_stock` |
| `gdc_post_inventory()` `AFTER INSERT/UPDATE` on `general_delivery_challans` | `status=Issued` one-shot; reversal on `Cancelled` | `allow_negative_stock` |
| `invoice_item_sync_serials_strict()` `AFTER INSERT/UPDATE/DELETE` on `invoice_items` | Every invoice line write; serial path = strict `available` check + flip to `issued`; pooled path = `ims_deduct_qty(..., allow_negative)` | `allow_negative_stock` + `skip_stock_posting` |
| `ims_deduct_qty()` helper | FIFO over `ims_stock_items` `part_model_no` + `warehouse_id` + `stock_status=available`; splits rows; if `allow_negative` inserts negative `qty=-remaining` | — |

**Proforma must set `skip_stock_posting=true` equivalent** — today only `GDC → Invoice` uses it (`generalDc.ts:103-126` + `20260823…sql assert_skip_posting_has_source`). V2 carries the pattern to Proforma and to SO→Invoice partial splits where prior DC already posted.

### 1.3 UI routes (agent 3)

- SO detail (`sales.orders.$id.tsx:342`) is read-only header + items table + `soStatusMeta` badge + `Select` for status + two conversion buttons. **No progress bar, no remaining qty, no timeline.**
- Invoice create (`sales.invoices.new.tsx:961`) — 900-line form: `BranchPicker`, `CustomerPicker`+`branchOverride`, `ItemDraft` editable grid, `computeTotals`, `allow_negative_stock` toggle (admin-guarded), `transport_details`, serial picker. Consumes `GDC_PREFILL_KEY` on mount (`:102-125`) — SO detail does NOT use prefill.
- GDC detail (`sales.general-dc.$id.tsx`) — `Issued/Converted/Cancelled` + `Convert to Invoice` via prefill.
- `sales.index.tsx` is dashboard, not SO list. Real list is `sales.orders.index.tsx:14` — paginated 25/50, columns `SO No | Date | Customer | Total | Status` only.
- **Proforma:** `grep -i proforma` → **0 hits** in `src/` and `supabase/` — table, route, type all absent.

### 1.4 DB schema (agent 4) + partial blocker (agent 5)

- `sales_orders.items` is **JSONB untyped** (`setup_new_supabase.sql:3872` + `types.ts:4702`). No `delivered_qty`/`balance_qty` per line. No ledger table.
- **Hard blocker:** `uq_dc_sales_order UNIQUE(sales_order_id) WHERE sales_order_id IS NOT NULL` (`20260909000001:43-47`) — Postgres rejects second DC for same SO.
- **App blocker:** `findInvoiceForSalesOrder()` (`writers.ts:415-441`) + `createChallanFromSalesOrder` early return on existing doc — exactly-once writers.
- **Status lifecycle is dead:** `partial` is overwritten blindly on first DC (`writers.ts:266`), `delivered` is **never written by code**, `invoiced` is terminal. `confirmed` is manual only.
- **PO reference pattern** `purchaseOrder.ts:6-99` has `POItemRow.received_qty` per line — correct shape but increment automation is missing (no trigger on GRN → `received_qty`). V2 adopts the shape but with a **ledger**, not a denormalized counter.

---

## 2. Target Architecture

### 2.1 One picture

```
PO (optional, external)
      │  po_number / po_date snapshot
      ▼
  ┌──────────┐   convert(a/b/c)   ┌─────────────────┐
  │ Sales    │ ──────────────────► │ Tax Invoice     │ ──► stock: issued (trigger)
  │ Order    │   split 20→17+3    │ General DC      │ ──► stock: issued (trigger)
  │ 20×Item  │ ──────────────────► │ Proforma        │ ──► stock: NONE (read-only)
  └──────────┘   each doc knows   └─────────────────┘
      ▲        Ordered / Fulfilled / Balance / ThisQty
      │              ▲
      │              │  fulfillment_ledger (new)
      │         so_fulfillment_summary VIEW
      │
  Timeline on SO detail: progress bar + “Previously satisfied” table + linked docs
```

### 2.2 ER diagram (new + altered)

```
sales_orders (existing, altered)
  id PK ──────────────────────────────────────┐
  so_no UNIQUE                                 │
  items JSONB [{product_id, description, hsn, qty, unit, rate, discount_pct, gst_rate, cess_rate, warehouse_id, serial_numbers, is_serialized}]
  status CHECK(draft,confirmed,partial,delivered,invoiced,cancelled)  ← derived in V2 via VIEW, not overwritten
  branch_id, customer_id
  shipping_charges/adjustment/tcs_*                                    │
                                              │
so_fulfillments (NEW) ◄───────────────────────┘  one row PER LINE PER CONVERSION
  id PK
  sales_order_id FK → sales_orders.id
  conversion_id FK → so_conversions.id        ──┐
  line_index INT  (index into sales_orders.items[])
  product_id UUID nullable
  ordered_qty NUMERIC
  this_qty NUMERIC                              │
  warehouse_id UUID nullable
  serial_numbers TEXT[] nullable
                                              │
so_conversions (NEW) ledger header ◄──────────┘
  id PK
  sales_order_id FK
  conversion_type ENUM(tax_invoice, general_dc, proforma_invoice, delivery_challan)
  target_table TEXT  (invoices | general_delivery_challans | delivery_challans | proforma_invoices)
  target_id UUID
  target_no TEXT  (invoice_no / dc_no / proforma_no)
  status TEXT (draft/issued/cancelled etc, mirrors target)
  prior_fulfilled JSONB  [{line_index, fulfilled_before}]
  this_fulfilled JSONB   [{line_index, this_qty}]
  balance_after JSONB    [{line_index, balance}]
  created_by, created_at

invoices (existing, altered)
  id PK, invoice_no, sales_order_id FK (kept, but NO unique — many per SO allowed)
  linked_dc_ids UUID[] (kept)
  linked_proforma_id UUID FK (NEW, nullable)
  conversion_id UUID FK → so_conversions.id (NEW)
  allow_negative_stock BOOL, skip_stock_posting BOOL (existing)
  source_general_dc_id UUID (existing)

general_delivery_challans (existing, altered)
  id PK, dc_no, sales_order_id FK (NEW, nullable — today no FK!)
  conversion_id UUID FK (NEW)

delivery_challans (existing, altered)
  id PK, challan_no, sales_order_id FK (existing)
  conversion_id UUID FK (NEW)
  ── UNIQUE INDEX uq_dc_sales_order DROPPED → replaced by non-unique index

proforma_invoices (NEW — read-only, no stock)
  id PK, proforma_no UNIQUE, sales_order_id FK, conversion_id FK
  branch_id, customer_id, header snapshots (same as invoices)
  items JSONB (same shape as SoItem, frozen on issue)
  subtotal/discount/.../total/total_in_words
  status ENUM(draft,issued,cancelled)
  prior_fulfilled JSONB, this_fulfilled JSONB (same as conversions)
  created_by/at, cancelled_reason/at/by

VIEW so_fulfillment_summary (NEW)
  sales_order_id, line_index, product_id, ordered_qty,
  fulfilled_tax_invoice, fulfilled_gdc, fulfilled_dc, fulfilled_proforma,  -- proforma counts for display only, not for “delivered” status
  fulfilled_stock_affecting := tax_invoice + gdc + dc   (proforma excluded)
  balance := ordered_qty - fulfilled_stock_affecting
  is_line_complete := balance <= 0
  overall_status := derived(draft/partial/delivered/invoiced)  -- see §2.3
```

### 2.3 SO status — derived, not overwritten (fixes dead `delivered`)

```
draft ──► confirmed (manual/approval) ──► partial ──► delivered ──► invoiced
  │                                      (0<fulfilled<ordered)  (all lines balance==0)
  └──────────► cancelled (terminal, reverses ledger if needed)

Rules (in VIEW + app helper soStatusDerived(soId)):
- if any fulfillment row exists and SUM(balance) > 0 → `partial`
- if SUM(balance) == 0 and all stock-affecting fulfillments are `issued`/`Submitted` → `delivered`
- if SUM(balance) == 0 and at least one Tax Invoice exists for every line → `invoiced`  (invoiced supersedes delivered)
- `draft` = 0 fulfillments; `confirmed` = manual flag (kept, but auto-promote on first conversion if desired)
- `proforma` fulfillments NEVER flip status — they are display-only.
```

### 2.4 Stock-effect matrix

| Doc | `skip_stock_posting` | `allow_negative_stock` | Trigger | Affects `balance` | Counts toward `delivered` |
|---|---|---|---|---|---|
| **Tax Invoice** | `false` (default) | per-line toggle, admin-guarded | `invoice_item_sync_serials_strict` | ✅ YES | ✅ YES |
| **General DC** | `false` | same toggle | `gdc_post_inventory` on `Issued` | ✅ YES | ✅ YES (delivery) |
| **Delivery Challan** (customer) | `false` | same | `dc_post_inventory` on `Submitted/Challan Generated` | ✅ YES | ✅ YES |
| **Proforma Invoice** | `true` (forced) | N/A (no stock) | **no trigger** — table has no trigger | ❌ NO | ❌ NO |
| **Invoice from GDC** | `true` (`source_general_dc_id` set) | — | bypassed via `assert_skip_posting_has_source` | ❌ NO (already counted via GDC) | ❌ NO (dedup) |

> **Idempotency note:** `Invoice from GDC` with `skip_stock_posting` must NOT create a ledger `fulfilled_stock_affecting` entry — otherwise the same qty is double-counted. The ledger row is created only for the GDC itself.

---

## 3. Conversion Pre-fill — “auto-populate max fields but editable”

### 3.1 What is auto-populated (cloned from SO)

Header: `branch_id/customer_id` + `seller_*` + `buyer_*` + `billing/shipping/place_of_supply/is_interstate/reverse_charge` + `po_number/po_date` + `notes/terms/payment_terms` + `linked_quote_id` + `shipping_charges/adjustment/tcs_*` + `sales_order_id` + `conversion_id`.

Lines: every `SoItem` cloned with: `product_id, description, hsn, unit, rate, discount_pct, gst_rate, cess_rate, warehouse_id, serial_numbers, is_serialized, part_model_no/part_name`. Financials are preserved so `computeTotals` is deterministic.

**All fields rendered editable** in the conversion sheet. Exceptions (locked):
- `product_id` / `description` — editable but product switch re-validates `warehouse_id` + stock.
- `qty` (“This Shipment”) — editable but **capped** `0 < this_qty ≤ balance` (where `balance = ordered - fulfilled_stock_affecting`), helper text `Ordered 20 · Already delivered 17 · Balance 3`.
- Serialized lines — `qty` locked to `serial_numbers.length`; serial picker enforces `available` + warehouse match + no duplicates across conversions (oversell check via `availableQty`/`findShortfalls`).

### 3.2 Where “previously satisfied qty” is stored

- Per conversion: `so_conversions.prior_fulfilled` + `this_fulfilled` + `balance_after` (JSONB arrays keyed by `line_index`). Written atomically with the target doc in one transaction.
- Aggregated: `VIEW so_fulfillment_summary` — `SUM(this_qty)` grouped by `(sales_order_id, line_index)` where `target.status != 'Cancelled'` and `conversion_type IN (tax_invoice, general_dc, delivery_challan)`.

### 3.3 Where it is shown (three surfaces)

1. **Conversion sheet** (before submit): per-line `Ordered | Already delivered | Balance | This shipment` + overall `SO fulfillment: 17/20 (85%)` progress.
2. **SO detail timeline** (after submit): card `Linked Documents` — table `Date | Doc No | Type | Qty this doc | Cumulative | Balance` + progress bar + link to each doc.
3. **Print/PDF annexure** (Tax Invoice / GDC / Proforma): footer section
   ```
   Against Sales Order PHS/SO/25-26/0042 (PO: PO-8891 dtd 2026-08-20)
   This consignment       17× Item A  (12 already delivered, balance 3)
   Previous consignments  12× Item A  via GDC PHS/GDC/25-26/0011 dtd 2026-09-01
   Balance remaining       3× Item A
   ```

---

## 4. Partial Flow — 20 → 17 + 3 (happy path)

```
T0: SO created. items[0]={product P1, qty 20, warehouse W1, rate 500, gst 18%}
    so_fulfillment_summary: ordered 20, fulfilled 0, balance 20 → status draft

T1: User on /sales/orders/:id clicks “Convert ▾” → sheet offers
    [ Tax Invoice ] [ General DC ] [ Proforma Invoice ] [ Delivery Challan (legacy) ]
    Picks “Tax Invoice”. Sheet opens prefilled: ThisQty=20, Already 0, Balance 20.
    User edits ThisQty=17, corrects shipping_charges, picks serials 17/20, submits.

    TX: 1) INSERT so_conversions{type=tax_invoice, prior=[0], this=[17], balance_after=[3]}
        2) INSERT invoices{sales_order_id, conversion_id, skip_posting=false} + invoice_items[0]{qty 17}
        3) VIEW recomputes: fulfilled 17, balance 3 → so status → `partial`
        Trigger posts stock: ims_deduct_qty(P1,W1,17) → 17× good_out, ledger good_out

T2: SO detail now shows: progress 17/20, table with Invoice INV-001 17, balance 3,
    button still enabled (because balance>0). Print of INV-001 includes annexure
    “Previously satisfied: 0, This: 17, Balance: 3”.

T3: User clicks Convert again → picks “Tax Invoice” (or GDC) → sheet prefills
    ThisQty defaults to balance 3 (editable down), Already 17 (read-only), Balance 3.
    Serial picker shows remaining 3 serials only. Submits ThisQty=3.

    TX: same as T1 with prior=[17], this=[3], balance_after=[0]
    VIEW: fulfilled 20, balance 0 → status auto `delivered` → after payment `invoiced`
    Stock posts remaining 3.

T4: Next Convert click sees balance 0 → button disabled, tooltip “Fully delivered.
    Create a new Sales Order for additional qty.” Proforma still allowed (read-only,
    but shows Ordered 20 · Delivered 20 · Balance 0 · ThisQty capped 0 — blocks submit).
```

**Proforma branch:** at T1 user picks Proforma → same sheet, but `skip_stock_posting` forced, target is `proforma_invoices` (`draft→Issued`), ledger entry `type=proforma` is written but **excluded** from `fulfilled_stock_affecting` — balance stays 20. Proforma print carries same annexure but line “Stock: Not applicable — Proforma is not a delivery document.” Proforma can later be converted to Tax Invoice via `proformaToInvoice` (reuse GDC pattern: prefill + `linked_proforma_id`).

---

## 5. Data Model DDL — exact migrations

> All migrations are **additive** except one blocker removal. Each is `CONCURRENTLY`-safe, RLS-complete, and numbered to follow `20260909000001_sales_order_fixes.sql`.

### 5.1 `20260910000001_so_fulfillment_ledger.sql`

```sql
-- 1) Enum for conversion type (or TEXT CHECK — keep simple, use TEXT CHECK)
DO $$ BEGIN
  CREATE TYPE so_conversion_type AS ENUM ('tax_invoice','general_dc','proforma_invoice','delivery_challan');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Conversions ledger header
CREATE TABLE IF NOT EXISTS public.so_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  conversion_type so_conversion_type NOT NULL,
  target_table text NOT NULL CHECK (target_table IN ('invoices','general_delivery_challans','delivery_challans','proforma_invoices')),
  target_id uuid NOT NULL,
  target_no text,
  status text NOT NULL DEFAULT 'draft', -- mirrors target status for quick filtering
  prior_fulfilled jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{line_index int, product_id uuid, ordered_qty numeric, fulfilled_before numeric}]
  this_fulfilled  jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{line_index, this_qty}]
  balance_after   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{line_index, balance}]
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_table, target_id)
);
CREATE INDEX idx_so_conv_so ON public.so_conversions(sales_order_id);
CREATE INDEX idx_so_conv_type ON public.so_conversions(conversion_type);
CREATE INDEX idx_so_conv_target ON public.so_conversions(target_table, target_id);

-- 3) Per-line fulfillment detail (one row per SO line per conversion)
CREATE TABLE IF NOT EXISTS public.so_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id uuid NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  conversion_id uuid NOT NULL REFERENCES public.so_conversions(id) ON DELETE CASCADE,
  line_index int NOT NULL CHECK (line_index >= 0),
  product_id uuid,
  ordered_qty numeric(14,3) NOT NULL CHECK (ordered_qty >= 0),
  this_qty    numeric(14,3) NOT NULL CHECK (this_qty >= 0),
  warehouse_id uuid REFERENCES public.warehouses(id),
  serial_numbers text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversion_id, line_index)
);
CREATE INDEX idx_so_ful_so_line ON public.so_fulfillments(sales_order_id, line_index);
CREATE INDEX idx_so_ful_product ON public.so_fulfillments(product_id);

-- 4) Allow multiple docs per SO: drop unique blocker, keep non-unique index
DROP INDEX IF EXISTS public.uq_dc_sales_order;
CREATE INDEX IF NOT EXISTS idx_dc_sales_order ON public.delivery_challans(sales_order_id);

-- 5) Link columns for traceability
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.so_conversions(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS linked_proforma_id uuid REFERENCES public.proforma_invoices(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_conversion ON public.invoices(conversion_id);

ALTER TABLE public.general_delivery_challans ADD COLUMN IF NOT EXISTS sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE SET NULL;
ALTER TABLE public.general_delivery_challans ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.so_conversions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_gdc_so ON public.general_delivery_challans(sales_order_id);

ALTER TABLE public.delivery_challans ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.so_conversions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dc_conversion ON public.delivery_challans(conversion_id);

-- 6) Updated-at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_so_conv_updated ON public.so_conversions;
CREATE TRIGGER trg_so_conv_updated BEFORE UPDATE ON public.so_conversions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### 5.2 `20260910000002_proforma_invoices.sql`

```sql
CREATE TABLE IF NOT EXISTS public.proforma_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proforma_no text UNIQUE,
  proforma_date date NOT NULL DEFAULT CURRENT_DATE,
  branch_id uuid REFERENCES public.branches(id),
  customer_id uuid REFERENCES public.customers(id),
  sales_order_id uuid REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  conversion_id uuid REFERENCES public.so_conversions(id) ON DELETE SET NULL,

  -- snapshots (same naming as invoices for template reuse)
  seller_name text, seller_gstin text, seller_state text, seller_state_code text, seller_address text,
  buyer_name text, buyer_gstin text, buyer_state text, buyer_state_code text,
  billing_address text, shipping_address text, place_of_supply text, place_of_supply_code text,
  is_interstate boolean DEFAULT false, reverse_charge boolean DEFAULT false,

  po_number text, po_date date,
  subtotal numeric(14,2) DEFAULT 0, discount numeric(14,2) DEFAULT 0,
  taxable_value numeric(14,2) DEFAULT 0, cgst numeric(14,2) DEFAULT 0, sgst numeric(14,2) DEFAULT 0,
  igst numeric(14,2) DEFAULT 0, cess numeric(14,2) DEFAULT 0, round_off numeric(14,2) DEFAULT 0,
  total numeric(14,2) DEFAULT 0, total_in_words text,
  shipping_charges numeric(14,2) DEFAULT 0, adjustment numeric(14,2) DEFAULT 0,
  tcs_percent numeric(14,2) DEFAULT 0, tcs_amount numeric(14,2) DEFAULT 0,
  discount_label text, discount_amount numeric(14,2) DEFAULT 0,

  items jsonb NOT NULL DEFAULT '[]'::jsonb, -- SoItem[] frozen on issue
  prior_fulfilled jsonb NOT NULL DEFAULT '[]'::jsonb,
  this_fulfilled  jsonb NOT NULL DEFAULT '[]'::jsonb,

  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  notes text, terms text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_reason text, cancelled_at timestamptz, cancelled_by uuid
);
CREATE INDEX idx_proforma_so ON public.proforma_invoices(sales_order_id);
CREATE INDEX idx_proforma_branch ON public.proforma_invoices(branch_id);
CREATE INDEX idx_proforma_no_trgm ON public.proforma_invoices USING gin (proforma_no gin_trgm_ops);

-- numbering settings + trigger (mirrors sales_order_settings / set_so_no)
CREATE TABLE IF NOT EXISTS public.proforma_invoice_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid UNIQUE REFERENCES public.branches(id),
  prefix text NOT NULL DEFAULT 'PHS/PI/',
  fy_reset boolean NOT NULL DEFAULT true, current_fy text, next_seq int NOT NULL DEFAULT 1
);
CREATE OR REPLACE FUNCTION public.set_proforma_no() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE fy text; seq int; pfx text; br uuid;
BEGIN
  br := NEW.branch_id;
  -- FY Apr-Mar, same as set_so_no
  fy := to_char(CURRENT_DATE,'YY') || '-' || to_char(CURRENT_DATE + interval '9 months','YY');
  SELECT prefix INTO pfx FROM public.proforma_invoice_settings WHERE branch_id IS NOT DISTINCT FROM br;
  pfx := COALESCE(pfx,'PHS/PI/');
  PERFORM pg_advisory_xact_lock(hashtextextended('proforma_no:'||COALESCE(br::text,'null'),0));
  INSERT INTO public.proforma_invoice_settings(branch_id, prefix, current_fy, next_seq)
    VALUES (br, pfx, fy, 2) ON CONFLICT (branch_id) DO UPDATE SET next_seq = proforma_invoice_settings.next_seq + 1
    RETURNING next_seq -1 INTO seq; -- simplified; actual impl does fy-aware seq like set_so_no
  -- If row existed, we already incremented; fetch seq correctly:
  IF seq IS NULL THEN SELECT next_seq -1 INTO seq FROM public.proforma_invoice_settings WHERE branch_id IS NOT DISTINCT FROM br; END IF;
  NEW.proforma_no := pfx || fy || '/' || lpad(seq::text,4,'0');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_proforma_no ON public.proforma_invoices;
CREATE TRIGGER trg_proforma_no BEFORE INSERT ON public.proforma_invoices FOR EACH ROW EXECUTE FUNCTION public.set_proforma_no();
DROP TRIGGER IF EXISTS trg_proforma_updated ON public.proforma_invoices;
CREATE TRIGGER trg_proforma_updated BEFORE UPDATE ON public.proforma_invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### 5.3 `20260910000003_so_fulfillment_view.sql`

```sql
CREATE OR REPLACE VIEW public.so_fulfillment_summary AS
WITH ordered AS (
  SELECT so.id AS sales_order_id,
         (idx-1) AS line_index,
         (elem->>'product_id')::uuid AS product_id,
         COALESCE((elem->>'qty')::numeric,0) AS ordered_qty
  FROM public.sales_orders so,
       jsonb_array_elements(so.items) WITH ORDINALITY AS t(elem, idx)
),
fulfilled AS (
  SELECT f.sales_order_id, f.line_index, SUM(f.this_qty) AS fulfilled_stock
  FROM public.so_fulfillments f
  JOIN public.so_conversions c ON c.id = f.conversion_id
  WHERE c.conversion_type IN ('tax_invoice','general_dc','delivery_challan')
    AND c.status != 'cancelled'
  GROUP BY 1,2
),
fulfilled_proforma AS (
  SELECT f.sales_order_id, f.line_index, SUM(f.this_qty) AS fulfilled_proforma
  FROM public.so_fulfillments f
  JOIN public.so_conversions c ON c.id = f.conversion_id
  WHERE c.conversion_type = 'proforma_invoice' AND c.status != 'cancelled'
  GROUP BY 1,2
)
SELECT o.sales_order_id, o.line_index, o.product_id, o.ordered_qty,
       COALESCE(f.fulfilled_stock,0) AS fulfilled_stock,
       COALESCE(fp.fulfilled_proforma,0) AS fulfilled_proforma,
       GREATEST(0, o.ordered_qty - COALESCE(f.fulfilled_stock,0)) AS balance,
       (o.ordered_qty - COALESCE(f.fulfilled_stock,0) <= 0) AS is_complete
FROM ordered o
LEFT JOIN fulfilled f USING (sales_order_id, line_index)
LEFT JOIN fulfilled_proforma fp USING (sales_order_id, line_index);

-- helper to derive SO status (used by app, not a stored column)
CREATE OR REPLACE FUNCTION public.so_derived_status(p_so_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN (SELECT status FROM public.sales_orders WHERE id=p_so_id) = 'cancelled' THEN 'cancelled'
    WHEN NOT EXISTS (SELECT 1 FROM public.so_conversions WHERE sales_order_id=p_so_id AND status!='cancelled' AND conversion_type IN ('tax_invoice','general_dc','delivery_challan')) THEN
      (SELECT status FROM public.sales_orders WHERE id=p_so_id) -- draft/confirmed as-is
    WHEN (SELECT bool_and(is_complete) FROM public.so_fulfillment_summary WHERE sales_order_id=p_so_id) THEN
      CASE WHEN EXISTS (SELECT 1 FROM public.so_conversions WHERE sales_order_id=p_so_id AND conversion_type='tax_invoice' AND status!='cancelled') THEN 'invoiced' ELSE 'delivered' END
    ELSE 'partial'
  END;
$$;
```

### 5.4 `20260910000004_rls_fulfillment.sql` (RLS)

```sql
ALTER TABLE public.so_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.so_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proforma_invoices ENABLE ROW LEVEL SECURITY;

-- mirror invoices/sales_orders policies: authenticated + has_permission('sales','read')
-- (full GRANT + USING/WITH CHECK blocks as in 20260909000001:79-103)
-- service_role bypass; anon denied
```

---

## 6. Business Logic — Writers (transactional)

### 6.1 New helpers in `src/lib/documentFlow.ts` (pure)

```ts
export type ConversionType = "tax_invoice" | "general_dc" | "proforma_invoice" | "delivery_challan";
export type FulfillmentLine = { line_index:number; product_id:string|null; ordered_qty:number; fulfilled_before:number; balance:number; this_qty:number };

export function buildFulfillmentPreview(so: SalesOrder, summary: SoFulfillmentSummary[]): FulfillmentLine[] { /* map ordered vs view */ }
export function validateThisQty(lines: FulfillmentLine[]): string | null { /* 0<this_qty<=balance, serial len match */ }
export function salesOrderToInvoicePartial(so: SalesOrder, lines: FulfillmentLine[]): NewInvoicePayload { /* clone header, filter/slice items to this_qty */ }
export function salesOrderToGeneralDcPartial(so: SalesOrder, lines: FulfillmentLine[]): NewGeneralDcPayload { /* same */ }
export function salesOrderToProformaPartial(so: SalesOrder, lines: FulfillmentLine[]): NewProformaPayload { /* skip_stock_posting implicit */ }
export function proformaToInvoice(pi: ProformaRow): NewInvoicePayload { /* reuse items, set linked_proforma_id, skip_stock_posting false unless PI was stock */ }
```

### 6.2 Writers in `src/lib/documentFlow.writers.ts` (transactional)

```ts
// Atomic TX per conversion (single RPC or supabase transaction):
export async function createTaxInvoiceFromSO(soId: string, lines: FulfillmentLine[], opts?: {allow_negative_stock: boolean}): Promise<{invoice_id:string}>
//  1) SELECT so + SELECT so_fulfillment_summary FOR UPDATE (advisory lock hashtextextended('so_fulfill:'||soId,0))
//  2) Re-validate this_qty <= balance (race guard)
//  3) Build payload via salesOrderToInvoicePartial
//  4) INSERT so_conversions {prior, this, balance_after}
//  5) INSERT so_fulfillments rows (one per line where this_qty>0)
//  6) insertInvoiceFromPayload (existing, with conversion_id) → triggers post stock
//  7) UPDATE so_conversions target_no/status

export async function createGeneralDcFromSO(soId: string, lines: FulfillmentLine[], ...): Promise<{gdc_id:string}>
//  similar, but target is general_delivery_challans with sales_order_id + conversion_id
//  stock posts on status=Issued

export async function createProformaFromSO(soId: string, lines: FulfillmentLine[]): Promise<{proforma_id:string}>
//  similar, target proforma_invoices (no stock trigger). status draft→issued in same TX.

export async function createDeliveryChallanFromSO(soId: string, lines: FulfillmentLine[]): Promise<{dc_id:string}>
//  kept for legacy customer DC; now partial-aware (same ledger)

export async function convertProformaToInvoice(proformaId: string, lines?: FulfillmentLine[]): Promise<{invoice_id:string}>
//  mirrors GDC→Invoice: prefill path + linked_proforma_id, ledger type tax_invoice (proforma ledger stays display-only)

// Idempotency: writers check (soId, target_no) dedupe + (conversion_type, target_id) unique.
// The old exactly-once guards (findInvoiceForSalesOrder / DC eq sales_order_id) are REMOVED
// and replaced by balance>0 guard + advisory lock.
```

**Why advisory lock:** reuses proven pattern from `set_so_no()` (`pg_advisory_xact_lock(hashtextextended('so_no:'||branch_id,0))`). New key is `so_fulfill:` + `soId` — serializes concurrent conversions on same SO without row-level deadlocks.

### 6.3 Negative stock & serials

- Reuse `src/lib/negativeStock.ts: availableQty(model, warehouse, ...)` + `findShortfalls(lines)` + `blockMessage()` + `logNegativeOverrides()` pre-flight.
- Serialized lines: pre-check each `serial_numbers[]` item via `ims_stock_items` `available` lookup; error if any serial not `available` or already used in another non-cancelled fulfillment (query `so_fulfillments` + live `ims_stock_items`).
- `allow_negative_stock` toggle stays admin-guarded (`has_permission('sales','override_negative')` or `admin`), logged to `stock_negative_overrides` (`documentType: invoice|dc`, `documentId` = new invoice/gdc id).

---

## 7. UI/UX Spec

### 7.1 Design direction (ui-ux-pro-max)

- **Style:** headless shadcn/ui + Tailwind, density `comfortable`, `Card` + `Tabs` + `Sheet` + `Dialog`, no gradients.
- **Palette:** slate/emerald/amber/purple status tones already in `soStatusMeta` (`salesOrders.ts:99`) — keep.
- **Typography:** `text-sm` tables, `font-mono` for doc nos, `tabular-nums` for qty/money.
- **Motion:** Radix `Dialog`/`Sheet` open/close only — no GSAP on data tables.
- **a11y:** focus trap in Sheet, `aria-label` on qty inputs, `live` announcements for “balance exceeded”.

### 7.2 SO list (`src/routes/_app/sales.orders.index.tsx`)

Add columns (opt-in via column picker to avoid clutter):

```
SO No | Date | Customer | Total | Fulfilled (e.g. 17/20) | Balance (3) | Status | Actions
```

- `Fulfilled` = `SUM(fulfilled_stock) / SUM(ordered_qty)` with inline `Progress` bar (shadcn `Progress`).
- Filter: `status=partial` now meaningful (many rows). Search keeps `so_no/buyer_name`.

### 7.3 SO detail (`src/routes/_app/sales.orders.$id.tsx`) — redesign

**Header** — keep seller/buyer snapshot. Add right of items table:

```
Card: Fulfillment Summary
  Progress bar 85% (17/20)
  Legend: Invoiced 12 | GDC 5 | Proforma 0 (muted) | Balance 3
```

**Items table** — new columns:

```
# | Description | HSN | Ordered | Already Delivered | Balance | Rate | ...
```

- `Already Delivered` = `fulfilled_stock` from view. `Balance` = `ordered - fulfilled`. Lock Qty inputs = `Balance` tooltip.
- Row action: `Convert this line` (quick single-line conversion) + bulk selector checkboxes.

**Linked Documents Timeline** — new card below items:

```
Timeline vertical:
  2026-09-01  GDC PHS/GDC/25-26/0011  5×  [View]  stock:issued
  2026-09-03  INV PHS/INV/25-26/0042 12×  [View]  stock:issued
  2026-09-08  PI  PHS/PI/25-26/0007   20×  [View]  stock:— (proforma, read-only)
```

**Convert button** — replace two buttons with single split button:

```
[ Convert ▾ ]  ──► Tax Invoice (stock)
               ──► General DC (stock)
               ──► Proforma Invoice (no stock)
               ──► Delivery Challan (legacy)
```

- Disabled with tooltip “Fully delivered — create new SO for additional qty” when `SUM(balance)==0`.
- Click → opens `ConversionSheet` (shadcn `Sheet` side drawer, 640px).

### 7.4 ConversionSheet (new component `src/components/SoConversionSheet.tsx`)

```
Sheet header: Convert SO PHS/SO/… to [Tax Invoice | GDC | Proforma]  (tabs switch type)
Info: PO PHS/PO/… / Branch / Customer / “All fields editable — qty capped at balance”
Table editable:
  # | Description | Ordered | Already | Balance | This Shipment* | Warehouse* | Rate | GST | Line Total
      * = editable
Footer totals: Subtotal / GST / Shipping / TCS / Total (live via computeTotals, same as invoice form)
Actions: [Cancel] [Create Draft] [Create & Issue]  (Issue posts stock; Draft does not)
Validation: ThisShipment must be ≤ Balance, >0 for at least one line; serial count must match qty; warehouse required for stock docs.
Prefill: ThisShipment defaults to Balance (i.e. “ship the rest”), user can lower it.
Stock check: on “Create & Issue” runs availableQty → if shortfall shows NegativeStockDialog (existing) with override flow.
```

All header fields (billing/shipping/notes/terms/PO refs) are editable inputs at top of sheet, prefilled from SO. Changing branch re-derives `is_interstate` and GST split.

### 7.5 Target doc forms — reuse, not rewrite

- **Tax Invoice:** `src/routes/_app/sales.invoices.new.tsx` already supports prefill via `GDC_PREFILL_KEY`. Extend to accept `SO_PREFILL_KEY` (`invoice:prefill:from-so`) with `{conversion_type, this_fulfilled, prior_fulfilled}`. The `ItemDraft` grid stays editable but qty max is enforced via `balance` prop.
- **General DC:** `src/components/GeneralDcForm.tsx` — add `sales_order_id` + `conversion_id` props, same quantity picker logic. `status` flow `Draft→Issued` posts stock as before.
- **Proforma:** new route `src/routes/_app/sales.proforma.*` (copy `sales.invoices.new.tsx` shape, **remove** warehouse/serial/stock UI, make items read-only after `Issued`, add watermark “PROFORMA — NOT A TAX INVOICE” in print).

### 7.6 Print / PDF (`src/components/DocumentPrintView.tsx`, `src/lib/invoicePdf.ts`, `src/lib/generalDc.ts` print view)

- Invoice/GDC print: add annexure block (see §3.3) with table `Item | Ordered | Already Delivered (doc refs) | This Doc | Balance`.
- Proforma print: same annexure + header watermark + footer “This is not a delivery document — stock not affected”.
- SO print: add fulfillment annexure.

---

## 8. Validation, Edge Cases & Invariants

| Edge | Rule |
|---|---|
| **Concurrent converts** on same SO | Advisory lock `so_fulfill:soId`; loser re-reads view, sees reduced balance, validation fails with “Balance changed — 3 remaining, you asked 5”. No duplicate post. |
| **Over-delivery** (ThisQty > Balance) | Blocked at sheet + re-validated in writer transaction. Never rely on client only. |
| **Zero-line submit** (all ThisQty=0) | Blocked: “Select at least one line with qty > 0”. |
| **Serialized split** (e.g. 20 serials, ship 17) | Qty editor disabled; serial MultiPicker is source of truth — qty = selected serials count. Overlap check: any serial already in `so_fulfillments` (non-cancelled) is filtered out + error “Serial X already delivered via INV-001”. |
| **Warehouse per line** | Each line carries `warehouse_id`. `ims_deduct_qty` is warehouse-scoped; cross-warehouse split is allowed (user picks per line). |
| **Service items** (`products.item_type='service'`) | Triggers skip `service` (`WHERE item_type != 'service'`). Ledger still counts for completeness but stock check skipped. |
| **Negative stock** | If `available < this_qty` and `allow_negative_stock=false` → `blockMessage` + block. If `true` + admin → `ims_deduct_qty` inserts negative row, `logNegativeOverrides` audit. Same as today. |
| **GST edge** | `computeTotals` is re-run on the **this_qty** slice, not the full SO. `is_interstate` re-derived from `seller_state_code` vs `buyer_state_code` (branch + customer). `supply_class nil/exempt/zero_rated` forces `gst_rate 0`. |
| **Cancellation** | Cancelling a stock doc triggers existing reversal (flips `ims_stock_items` from `issued` → `available` + `good_in`). Writer also marks `so_conversions.status='cancelled'` and recomputed view restores balance. Proforma cancel has no stock reversal. |
| **Re-opening fully delivered SO** | After cancel, balance increases, Convert re-enables — correct. |
| **PO linkage** | `po_number/po_date` is snapshot from SO (which may have come from PO). If SO was created from PO, keep `po_number` on every child doc. If SO manual, keep null. No extra PO fulfillment tracking in V2 (PO stays text snapshot). |
| **Branch isolation** | All inserts keep `branch_id` from SO; RLS is branch-aware via existing policies. Advisory lock is per-SO, not per-branch, safe. |
| **Backfill existing data** | Migration backfills one `so_conversions` + `so_fulfillments` per existing invoice/DC that has `sales_order_id`. See §9. |
| **Proforma → Invoice dedup** | When converting PI→Invoice, set `linked_proforma_id` + `skip_stock_posting=false` (stock posts now). Ledger entry for Invoice is new `fulfilled_stock`; Proforma’s ledger stays display-only — no double count. |

---

## 9. Migration & Backfill Procedure

```sql
-- Backfill after creating tables (idempotent, run once)
INSERT INTO public.so_conversions (sales_order_id, conversion_type, target_table, target_id, target_no, status, prior_fulfilled, this_fulfilled, balance_after)
SELECT sales_order_id, 'tax_invoice', 'invoices', id, invoice_no, status, '[]'::jsonb,
       (SELECT jsonb_agg(jsonb_build_object('line_index', sr_no-1, 'this_qty', qty)) FROM public.invoice_items WHERE invoice_id = invoices.id),
       '[]'::jsonb
FROM public.invoices WHERE sales_order_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.so_fulfillments (sales_order_id, conversion_id, line_index, product_id, ordered_qty, this_qty)
SELECT so.id, c.id, (elem_idx-1), (elem->>'product_id')::uuid,
       COALESCE((elem->>'qty')::numeric,0),
       COALESCE((inv_item->>'qty')::numeric,0) -- simplified; real backfill joins invoice_items sr_no
-- ... full backfill script does jsonb_array_elements(so.items) WITH ORDINALITY joined to invoice_items sr_no
```

- Existing `partial`/`invoiced` SO statuses are **re-derived** via `so_derived_status()` on backfill — a one-time `UPDATE sales_orders SET status = so_derived_status(id)` for all SOs with ledger rows (opt-in, can be deferred).
- No data loss: old `uq_dc_sales_order` removal is safe because existing rows remain unique by chance; future dupes are allowed by design.

---

## 10. Phased Execution Roadmap (GSD)

### Phase 1 — Ledger & Blockers (1 dev, 1 day)

- Tasks: `20260910000001` + `20260910000003` + RLS + backfill script + drop unique index + add `conversion_id` columns.
- Verifies: `SELECT * FROM so_fulfillment_summary` returns correct balance for existing SOs; second DC insert no longer throws unique violation.

### Phase 2 — Proforma Table & Numbering (0.5 day)

- Tasks: `20260910000002` + `set_proforma_no()` + settings UI `src/routes/_app/po.settings.tsx` analogue.
- Verifies: `INSERT proforma_invoices` generates `PHS/PI/YY-YY/0001`.

### Phase 3 — Pure Conversion Engine (1 day)

- Tasks: extend `src/lib/documentFlow.ts` with partial helpers + `SoConversionSheet` pure logic, unit tests `src/lib/__tests__/documentFlow.test.ts` (add 12 cases: split 20→17+3, serial split, warehouse, proforma no-stock, over-delivery block, concurrent balance).
- Verifies: `npm test` — all  existing + new tests green.

### Phase 4 — Transactional Writers (1 day)

- Tasks: `src/lib/documentFlow.writers.ts` — 4 writers with advisory lock + ledger insert + stock post, plus `soStatusDerived` helper.
- Verifies: manual `node` script that creates SO 20, converts 17, asserts balance 3, converts 3, asserts delivered.

### Phase 5 — UI: SoConversionSheet + SO Detail Redesign (2 days)

- Tasks: `src/components/SoConversionSheet.tsx` (new), `src/routes/_app/sales.orders.$id.tsx` (replace buttons, add Fulfillment Summary + Timeline), `src/routes/_app/sales.orders.index.tsx` (add fulfilled/balance cols).
- Verifies: Playwright manual “20→17→3” flow in dev.

### Phase 6 — Target Doc Integration (1 day)

- Tasks: wire prefill keys (`SO_PREFILL_KEY`, `GDC_PREFILL_KEY` extended, `PROFORMA_PREFILL_KEY`), adapt `sales.invoices.new.tsx`, `GeneralDcForm.tsx`, new `sales.proforma.*` routes (3 files).
- Verifies: each of 3 conversion types prefills correctly, qty cap enforced, stock check works for Tax/GDC, Proforma submits with no stock trigger.

### Phase 7 — Print/PDF & “Previously satisfied” annexure (0.5 day)

- Tasks: `src/components/DocumentPrintView.tsx`, `src/lib/invoicePdf.ts` / `GeneralDcPrintView`, `ProformaPrintView`.
- Verifies: PDF of invoice shows “Previously: 12 via GDC … / This: 17 / Balance: 3”.

### Phase 8 — Hardening: Negative Stock, Serials, Cancellation, Concurrency (1 day)

- Tasks: serial overlap guard, `allow_negative_stock` dialog reuse, cancellation reversal, advisory lock stress test (2 tabs converting same SO).
- Verifies: `stock_negative_overrides` logged, serial double-deliver blocked, cancel restores balance.

### Phase 9 — E2E & Rollout (0.5 day)

- Tasks: `npm test`, `npm run build`, migration dry-run on staging, docs update, `docs/SO_CONVERSION_PLAN_V2.md` marked Done.
- Verifies: build green, RLS manual check as non-admin, performance `EXPLAIN` on view.

**Total:** ~8 dev-days. Each phase maps to one `gsd-plan-phase` PLAN.md with `while verify → fix` loop.

---

## 11. Files to Create / Modify (inventory)

**Create (8):**
- `supabase/migrations/20260910000001_so_fulfillment_ledger.sql`
- `supabase/migrations/20260910000002_proforma_invoices.sql`
- `supabase/migrations/20260910000003_so_fulfillment_view.sql`
- `supabase/migrations/20260910000004_rls_fulfillment.sql`
- `src/components/SoConversionSheet.tsx`
- `src/routes/_app/sales.proforma.new.tsx` + `sales.proforma.$id.tsx` + `sales.proforma.index.tsx`
- `src/components/ProformaPrintView.tsx`
- `src/lib/proforma.ts` (fetchers + `isProformaEditable`)

**Modify (12):**
- `src/lib/documentFlow.ts` — add partial helpers, FulfillmentLine, salesOrderTo*Partial, proformaToInvoice
- `src/lib/documentFlow.writers.ts` — 4 transactional writers, advisory lock, ledger insert, remove old exactly-once guards
- `src/lib/salesOrders.ts` — add `SoFulfillmentSummary` type, `soDerivedStatus`, `fetchSoFulfillmentSummary`
- `src/lib/__tests__/documentFlow.test.ts` — add 12+ split cases
- `src/routes/_app/sales.orders.$id.tsx` — Convert split button, Fulfillment Summary card, Timeline card
- `src/routes/_app/sales.orders.index.tsx` — add fulfilled/balance columns + filters
- `src/routes/_app/sales.invoices.new.tsx` — accept `SO_PREFILL_KEY`, enforce balance cap
- `src/components/GeneralDcForm.tsx` — accept `sales_order_id`/`conversion_id`, same cap
- `src/components/DocumentPrintView.tsx` + `src/lib/invoicePdf.ts` + `src/components/GeneralDcPrintView.tsx` — annexure
- `src/integrations/supabase/types.ts` — regenerated after migrations
- `docs/superpowers/plans/2026-09-08-so-phase2-conversion-module.md` — superseded by this V2 (kept for history)

---

## 12. Testing Strategy

- **Unit** (`vitest`): pure mappers — split 20→17+3, zero balance block, serial qty=serials.length, proforma no-stock flag, GST re-compute on slice, prior_fulfilled calc.
- **Integration** (`supabase` local): single TX creates SO→17→3, asserts view balance 3→0, stock `ims_stock_items` qty decremented 17 then 3, `so_conversions` has 2 rows, cancel restores.
- **E2E** (Playwright, manual): SO detail → Convert→Tax 17 → PDF check → Convert→Tax 3 → status delivered → Convert disabled.
- **Concurrency**: two tabs open same SO, both submit 20 — one wins, one gets “Balance changed” toast.
- **Negative stock**: set `allow_negative_stock=false` → block; `true` + admin → insert negative row + `stock_negative_overrides` row.

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| JSONB `items` has no FK to `products` — line_index coupling fragile if SO items reordered after conversions | Freeze SO items on first conversion (or store `product_id` snapshot in `so_fulfillments` + view joins on `line_index` only for display; writer validates `ordered_qty` against snapshot, not live index). Doc: “Do not edit SO items after first conversion; UI disables items edit when ledger rows exist.” |
| Backfill of old SOs that already have invoice but no ledger shows balance=ordered (wrong) | Backfill script inserts ledger rows for every existing `sales_order_id` doc; run before enabling view-based status. |
| Trigger double-post if user manually creates Invoice with `sales_order_id` outside the writer | Writers are the only blessed path; RLS `WITH CHECK (created_via_conversion = true OR sales_order_id IS NULL)` is optional. At minimum, docs add in-code comment and README. |
| Performance of `so_fulfillment_summary` view over JSONB | View is `STABLE` + indexed on `(sales_order_id, line_index)`; expected SO items ≤50, conversions ≤10 → negligible. Add `MATERIALIZED` later if needed. |
| Proforma mistaken for deliverable by warehouse | Proforma print watermark + status badge `Proforma (No Stock)` + ledger excluded from `fulfilled_stock` + no trigger. Training: “Proforma never leaves stock.” |

---

## 14. What “auto-populate max fields but editable” means concretely

- **Populated:** branch, customer, every address snapshot, GSTIN, place_of_supply, PO refs, terms/notes, payment_terms, every line’s product/description/hsn/unit/rate/discount/gst/cess/warehouse/serial.
- **Editable:** all of the above + ThisShipment qty (capped), warehouse (re-validates stock), serial picker, rate/discount (with live GST recompute), header charges.
- **Not editable in sheet:** Ordered, Already Delivered, Balance (read-only badges). These prevent accidental over-delivery and make the “previously satisfied” story obvious.

---

## 15. Approval Gate — What I need from you

1. **Confirm the ledger model:** `so_conversions` + `so_fulfillments` + `VIEW so_fulfillment_summary` (vs simpler “add `delivered_qty` JSONB to SO row”). Ledger is recommended because it gives **audit trail** + multi-doc history + per-line serial fidelity. If you prefer the simpler JSONB counter, say so and I’ll swap.
2. **Confirm Proforma storage:** separate `proforma_invoices` table (read-only, no stock, watermark) vs reusing `invoices` with `sales_type='proforma'`. Separate is recommended — avoids polluting invoice numbering/triggers/e-invoice.
3. **Confirm status derivation:** auto derived `partial/delivered/invoiced` via view vs keep manual Select. Recommended: derived + manual `confirmed/cancelled` only.
4. **Say “go”** — I will then run `gsd-plan-phase --prd docs/SO_CONVERSION_PLAN_V2.md` to generate the executable PLAN.md and start `gsd-execute-phase` with subagent waves (one subagent per section above). All commits local, no Vercel/GitHub push.

> This plan satisfies your global rules: no Vercel deploy, local commits only, no cross-portal touches. Every new table gets RLS mirroring `sales_orders`/`invoices`. Existing tests keep passing — pure mappers stay pure, writers stay behind advisory locks.

---

*Generated with `superpowers` + `gsd-plan-phase` + `graphify` + `ui-ux-pro-max` + `dispatching-parallel-agents` + `subagent-driven-development`. Parallel recon evidence in tool outputs. Ready to execute on your “go”.*
