# Sales Document Flow: Quote → Sales Order → Delivery Challan → Invoice

Each document keeps its own snapshot; parent references are stored but never used to hydrate the child at read time. Existing Invoice numbering, payments, GST engine, ProductPicker, and CustomerPicker are reused untouched.

## 1. Database (single migration)

**New table** `public.sales_orders` — mirrors the shape of `quotations`/`invoices` for a consistent snapshot:

```text
id, so_no (auto), so_date, valid_until, expected_delivery,
branch_id, customer_id,
seller/buyer name, gstin, state, state_code, address,
billing_address, shipping_address, place_of_supply(_code), is_interstate,
salesperson, payment_terms, delivery_timeline,
subtotal, discount, taxable_value, cgst, sgst, igst, cess, round_off, total, total_in_words,
status ('draft'|'confirmed'|'partial'|'delivered'|'invoiced'|'cancelled'),
notes, terms,
linked_quote_id (uuid, FK quotations),
items jsonb,
created_by, created_at, updated_at
```

- `so_no` generator = new trigger `set_so_no` using an `sales_order_settings` row (`PHS/SO/<FY>/<seq>`, FY-reset like quote/invoice).
- `updated_at` trigger via existing `touch_updated_at`.
- GRANTs + RLS: authenticated CRUD, service_role all — matching the existing sales tables.

**Parent references added to existing tables**:

- `quotations`: `converted_to_so_id uuid`, `converted_at timestamptz`.
- `delivery_challans`: `sales_order_id uuid`, `quotation_id uuid` (nullable; existing `sales_order_no` text stays untouched).
- `invoices`: `sales_order_id uuid` (existing `linked_quote_id` and `linked_dc_ids` remain the source of truth for those links — no rename).

No CHECK constraints on times; use triggers where needed. No data mutation of existing rows.

## 2. Pure conversion engine

New `src/lib/documentFlow.ts` exports pure functions:

- `quoteToSalesOrder(quote)` → `NewSalesOrder` payload (deep copy of items, addresses, taxes, terms, salesperson, GST metadata).
- `salesOrderToDeliveryChallan(so)` → `NewDeliveryChallan` (party snapshot, items with qty, addresses; `sales_order_no` populated from `so.so_no`).
- `salesOrderToInvoice(so, opts?)` → `NewInvoice` (full items + tax snapshot; `linked_quote_id` propagated).
- `deliveryChallanToInvoice(dc, opts?)` → `NewInvoice` (items snapshot; `linked_dc_ids: [dc.id]`).
- Helper `mergeInvoiceFromDCs(dcs)` for combining multiple DCs into one invoice.

All helpers are pure — no Supabase calls — so unit-testable and reusable by any surface.

## 3. Server-safe writers

`src/lib/documentFlow.writers.ts` (client module, uses browser `supabase`):

- `convertQuoteToSO(quoteId)` → inserts SO, sets `quotations.converted_to_so_id`, returns new SO row.
- `convertSOToDC(soId)` → inserts DC with `sales_order_id` + `sales_order_no`, bumps SO status to `partial`/`delivered` based on qty coverage.
- `convertSOToInvoice(soId)` / `convertDCToInvoice(dcId)` → inserts invoice; existing invoice trigger keeps numbering intact.

Each writer is wrapped in a single Supabase call sequence with idempotency guard (skip if child already exists) so re-clicks don't duplicate.

## 4. UI

- **New route** `src/routes/_app/sales.orders.tsx` (list) and `sales.orders.$id.tsx` (edit) — modelled on the quotation form; reuses `CustomerPicker`, `ProductPicker`, `computeInvoiceTotals`.
- **Add tab** "Sales Orders" under `sales.tsx` (or `crm.tsx` matching current placement of Quotations/Invoices — I'll confirm and put it next to Quotations & Invoices).
- **Conversion buttons**:
  - `crm.quotations.$id.tsx` → "Convert to Sales Order".
  - `sales.orders.$id.tsx` → "Create Delivery Challan" and "Create Invoice".
  - `challan.$id.tsx` → "Create Invoice from DC".
  - Invoice screen shows read-only "From: SO / DC / Quote" chips linking back.
- Each button confirms, calls the writer, then navigates to the new document. Disabled + tooltipped when already converted.

## 5. Status separation

Every stage carries its own `status` — none overrides another. Parent status auto-advances only through explicit triggers on convert (never silently by trigger on child updates), keeping the audit trail clean.

## 6. Out of scope (per your notes)

- Invoice numbering unchanged.
- Payment tables / flows untouched.
- No refactor of GST engine or PDF templates — existing `computeInvoiceTotals`, `invoicePdf.ts`, `purchaseOrderPdf.ts` continue as-is.
- Existing `linked_quote_id` / `linked_dc_ids` columns on invoices are kept for backward compat.

## Technical notes

- Snapshots live in each document's own columns/`items` JSON — no join needed to render historical data.
- Parent references are UUID FKs with `ON DELETE SET NULL` so deleting a parent never orphans a child's data.
- Idempotency: writers check `quotations.converted_to_so_id`, `sales_orders.status = 'invoiced'`, and `invoices.linked_dc_ids` before inserting; a second click surfaces a toast rather than creating a duplicate.
- `sales_orders.items` mirrors `invoice_items` fields (product_id, description, hsn, qty, unit, rate, discount_pct, taxable_value, gst_rate, cgst, sgst, igst, cess, line_total) so `computeInvoiceTotals` can consume it directly.
- Delivery Challan already stores items as jsonb — SO→DC copy reshapes to the DC item shape without hitting inventory serials (DC remains stock-neutral, matching current behaviour).
- All new writes use the authenticated browser client and rely on existing RLS on those tables; the new `sales_orders` table uses the same policy shape as `quotations`.
