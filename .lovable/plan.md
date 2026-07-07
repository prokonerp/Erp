
# HEAD SALES — GST Accounting & Invoicing Module

Large module. Building end-to-end in one pass per your choice. Splitting into clear layers so each is testable. External APIs (IRN, e-Way) stay stubbed with a clean provider interface — flip a switch + secrets later to go live.

## 1. Data model (single migration)

New tables (all with RLS, GRANTs, updated_at triggers):

- `company_branches_gst` — extends existing `branches`: adds `gstin`, `state_code`, `state_name`, `pan`, `cin`, `bank_name`, `bank_account`, `bank_ifsc`, `upi_id`, `invoice_footer`, `logo_url`. (If cleaner, add columns to `branches` instead — decision at implementation.)
- `invoice_settings` — per branch: `prefix`, `suffix`, `fy_reset` (bool), `next_seq`, `terms_default`, `notes_default`, `place_of_supply_default`.
- `invoices` — header: `invoice_no` (unique), `invoice_date`, `branch_id` (seller), `customer_id`, `billing_addr`, `shipping_addr`, `place_of_supply`, `is_interstate`, `reverse_charge`, `linked_quote_id`, `linked_dc_ids[]`, `subtotal`, `discount`, `taxable_value`, `cgst`, `sgst`, `igst`, `cess`, `round_off`, `total`, `total_in_words`, `status` (draft/issued/paid/partial/cancelled), `irn`, `ack_no`, `ack_date`, `qr_payload`, `ewaybill_no`, `ewaybill_date`, `notes`, `terms`, `pdf_url`.
- `invoice_items` — `invoice_id`, `product_id`, `description`, `hsn`, `qty`, `unit`, `rate`, `discount_pct`, `taxable_value`, `gst_rate`, `cgst`, `sgst`, `igst`, `cess`.
- `payments_received` — `payment_no`, `date`, `customer_id`, `mode` (bank/cash/upi/cheque/neft), `reference`, `amount`, `notes`.
- `payment_allocations` — `payment_id`, `invoice_id`, `amount` (many-to-many; supports part-payments and over-allocation prevention via trigger).
- `eway_bills` — `invoice_id`, `transporter_name`, `transporter_id`, `vehicle_no`, `distance_km`, `mode`, `doc_type`, `ewb_no`, `ewb_date`, `valid_till`, `status`, `payload`, `response`.
- `hsn_summary` view — GSTR-1 style HSN roll-up per invoice.

Sequence functions per branch (mirrors existing `set_amc_agreement_no` pattern) using `invoice_settings.prefix` + FY or YYYY.

Reuses:
- `customers` (has `gst`, `gst_status`, state) — add `state_code` if missing.
- `products` (has `hsn`, GST rate — verify; add `gst_rate` if not present).
- `delivery_challans`, `quotations` — link via FKs.

## 2. GST engine (`src/lib/gst.ts`)

- `stateFromGSTIN`, `isValidGSTIN` (extend `src/lib/india.ts`).
- `computeInvoiceTotals({sellerStateCode, buyerStateCode, items[], discount, roundOff})` → line-level + header totals; picks CGST+SGST vs IGST; handles cess.
- `amountInWords(n)` — Indian numbering (lakh/crore).
- `hsnSummary(items[])` — for invoice PDF + GSTR-1.
- Pure functions, unit-testable.

## 3. Provider interface (stubs, API-ready)

`src/lib/einvoice.ts` and `src/lib/eway.ts` — provider-agnostic:

```ts
export interface EInvoiceProvider {
  generateIrn(invoice): Promise<{irn, ackNo, ackDate, qrPayload}>;
  cancelIrn(irn, reason): Promise<void>;
}
```

Ships with `MockProvider` that fills fake IRN/AckNo/QR so the flow is end-to-end demoable. Real providers (ClearTax/NIC) drop in later behind the same interface with credentials via `add_secret`.

Server functions in `src/lib/einvoice.functions.ts` / `eway.functions.ts` — `requireSupabaseAuth`, callable from the UI.

## 4. Sales module UI

New route tree under `_app/sales/`:

```
sales.tsx                 — layout w/ sub-nav
sales.index.tsx           — HEAD SALES dashboard
sales.quotations.*        — reuses existing /crm/quotations, adds "Convert to Invoice"
sales.invoices.index.tsx  — list w/ filters (status, customer, date, branch)
sales.invoices.new.tsx    — fast entry form (keyboard-first)
sales.invoices.$id.tsx    — view/edit/print/IRN/e-Way actions
sales.payments.index.tsx  — payments list
sales.payments.new.tsx    — record payment + allocate to invoices
sales.eway.index.tsx      — e-Way bills list + generator
sales.settings.tsx        — per-branch invoice settings, prefix, bank/UPI, GSTIN
```

Existing modules linked:
- `/challan` gets "Convert to Invoice" action + "Pending invoicing" filter.
- `/crm/quotations/$id` gets "Convert to Invoice".

### Invoice entry UX
- Branch picker (defaults to user's branch) → drives seller GSTIN + state.
- Customer picker (existing `CustomerPicker`) → auto-fills billing/shipping, buyer state, GSTIN.
- Item rows via `ProductMasterPicker` → auto HSN, rate, GST%.
- Live tax panel: shows CGST+SGST vs IGST based on state comparison.
- Keyboard: Enter = next field, Ctrl+S = save, Ctrl+P = print.

## 5. HEAD SALES Dashboard

`sales.index.tsx`:
- KPIs (today/MTD): Total Sales, Outstanding Receivables, Total Invoices, Pending Payments, e-Invoices generated.
- Quick actions: New Quote, New Invoice, Record Payment, Generate e-Way.
- Recent invoices, top customers by outstanding, aging bucket (0-30/31-60/61-90/90+).

Also surfaces as a widget on the main `/dashboard` respecting `sales` module permission.

## 6. Invoice PDF (BUSY-style)

`src/lib/invoicePdf.ts` using existing jsPDF stack:
- Header: company logo, name, GSTIN, address, CIN.
- Buyer + Ship-to blocks with GSTIN, State + code.
- Items table: Sr, Description, HSN, Qty, Unit, Rate, Disc, Taxable, GST%, CGST/SGST or IGST, Amount.
- HSN summary table.
- Tax summary block.
- Total in words.
- Bank details + IFSC + UPI ID.
- Two QRs: GST e-Invoice QR (from `qr_payload`) and UPI Payment QR (`upi://pay?pa=…&pn=…&am=…&tn=INV/…`).
- Terms + signature block.

Uses `qrcode` npm package (add via `bun add qrcode`).

## 7. Inventory linkage

On invoice `issued`:
- Trigger deducts stock from `ims_stock_items` (serial-tracked) or `inventory` (qty-tracked) based on product type.
- On invoice cancel → reverse.
- Low-stock alert query already exists in IMS module; reuse.

## 8. Reports

`sales.reports.tsx` with tabs:
- Sales Register (date range, branch, customer).
- GSTR-1 (invoice-wise + HSN-wise + rate-wise; CSV export in GSTN offline-tool format).
- Outstanding / Aging.
- Payments Received.
- Item Ledger (from IMS).
- Stock Summary (from IMS).

Exports: CSV + PDF using existing `src/lib/exports.ts`.

## 9. Validations

- GSTIN regex + checksum (extend `src/lib/india.ts`).
- HSN mandatory on every line where GST > 0.
- Invoice number unique (DB constraint + pre-save check).
- Invoice date not in future beyond FY end; not before branch creation.
- Prevent editing after `issued` unless admin; require Credit Note flow for corrections (Phase 1.1 — noted).
- Prevent duplicate submission (idempotency key on server fn).
- Tax mismatch guard: server recomputes totals from items, rejects if client total differs by >₹1.

## 10. Permissions

Adds `sales` module to `app_modules` with actions: read, create, edit, delete, export. Sub-permissions handled via existing `role_module_permissions` custom flags (`can_issue_invoice`, `can_generate_irn`, `can_record_payment`, `can_cancel_invoice`).

## 11. Rollout order (single build, staged commits)

1. Migration: tables, RLS, GRANTs, sequences, triggers.
2. GST engine + India helpers.
3. Server functions (invoices CRUD, totals recompute, payments allocation, IRN/e-Way stub providers).
4. Sales module routes + layout + sidebar entry.
5. Invoice entry form + live tax panel.
6. Payments form + allocation.
7. Invoice PDF + QR codes.
8. e-Invoice & e-Way stubs wired in.
9. Reports (Sales register, GSTR-1, Outstanding).
10. HEAD SALES dashboard KPIs.
11. Inventory deduction hooks.
12. Permissions module registration.

## Out of scope (call out)

- **Credit Notes / Debit Notes**: not in your spec; needed for real GSTR-1. I'll leave hooks but not build UI unless you confirm.
- **Purchases / Purchase invoices / GSTR-2/3B**: your spec says "future-ready" for purchases — I won't build the purchase UI now.
- **Real GSP integration**: stubs only. To go live: pick a GSP, share sandbox credentials, ~1–2 days per API.
- **Bank statement reconciliation import**: manual payment entry only.
- **Multi-currency / export invoices with LUT**: domestic INR only.
- **TCS/TDS**: not included.
- **Recurring invoices, subscriptions**: not included.

## Risks

- Scope is very large. If we hit build time limits, phases 8–11 may land in a follow-up commit. Everything in phases 1–7 is fully usable on its own.
- `products.gst_rate` column may not exist yet — I'll verify and add in the migration.
- Stock deduction interacts with existing IMS serial flow; I'll gate it behind a per-product `track_stock_on_invoice` flag to avoid breaking service tickets that already move stock.

Reply "go" to build. Any "not this / skip that / add this" adjustments before I start save a lot of rework.
