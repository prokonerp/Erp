## Goal
One shared A4 print/PDF template that renders both Quotation and Purchase Order, driven by document type + a common view-model. Reuse existing Company Master, Customer Master, Product Master, numbering series, and the existing Customer notes & terms fields. Add only what's genuinely missing (bank details, accent color, warranty rendering, Payment/Delivery terms on PO if absent).

## Approach
Single React component `<DocumentPrintView type="quotation" | "po" data={...} />` used by both route pages inside their existing hidden `print:block` block. `window.print()` (already wired) becomes the "PDF" path — no jsPDF divergence. The existing PO jsPDF renderer (`purchaseOrderPdf.ts`) is retired for the on-screen print, but kept only as `Download PDF` if desired (rendered from the same DOM via `docPdf.ts`).

## Schema additions (single migration)
- `company_profile`:
  - `registered_office_address text` (fallback: existing `regd_address` stays as the sales office / current address; if only one address exists, treat as both).
  - `accent_color text default '#1f3864'`
  - `bank_name`, `bank_account_name`, `bank_account_number`, `bank_ifsc`, `bank_branch` — all `text`.
- `customers`: ensure `gst text` exists (already present as `gst`).
- `purchase_orders`: `payment_terms` exists; add `delivery_terms text` if not present.
- No new tables. No numbering-series changes — reuse `invoice_settings`/`quotation` seq for Quote (already `PHS/FY/####`) and `po_settings` for PO (already `PROKON/PO/FY/####`).

## New / edited files
- `src/components/DocumentPrintView.tsx` (NEW) — shared A4 template. Props: `type`, `title` ("Quotation" | "Purchase Order"), `refNo`, `date`, `validUntil`, `company`, `bank`, `billTo`, `shipTo` (optional), `placeOfSupply`, `salesPerson`, `paymentTerms`, `deliveryTerms`, `items[]` (each has product name, description, warranty text, hsn, qty, rate, gstPct, amount), `isInterstate`, `terms`, `customerNotes`, `preparedBy`, `oemLogos` (Quotation only).
- `src/lib/companyProfile.ts` — extend `CompanyProfile` type with bank fields, `registered_office_address`, `accent_color`.
- `src/components/CompanyProfileSettings.tsx` — add Bank Details section + Accent Color picker + Registered Office field.
- `src/routes/_app/crm.quotations.$id.tsx` — replace the current inline `hidden print:block` block with `<DocumentPrintView type="quotation" ... />`. Auto-fill `salesperson` with `getCurrentUserName()` on new-quote create only (no overwrite of saved value).
- `src/routes/_app/po.$id.tsx` — add the same hidden print block using `<DocumentPrintView type="po" ... />`, and switch the "Print" button to `window.print()` for the shared template. `purchaseOrderPdf.ts` stays only for legacy download (or is deleted if you prefer — see decision point).
- `src/lib/sales.ts` / quotation item mapping — when building print items, join Product Master to include `warranty_duration` + `warranty_unit`, formatted as "24 M" / "2 Y" / "—".
- Purchase Order line items — same warranty resolution via `product_id` join (already loaded).

## Rendering rules (both docs)
- Header left: logo, company name, Sales Office address, Regd. Office address (only if distinct from sales office — no orphan label), GSTIN, Phone, Email, Website. Address built with `[a, b, c].filter(Boolean).join(", ")` — no dangling commas.
- Header right (under title): document title, Ref No, Date, Valid Until.
- Bill To / Ship To: navy header bars using `company.accent_color`. Contact person/phone/email only on Bill To. Suppress "Attn:" line if `contact_name` is blank. No "Mr. Sir" placeholder ever.
- Extra info row: Place of Supply + Sales Person (left) / Payment Terms + Delivery Terms (right).
- Items table columns exactly: `#  Item/Desc  Warranty  HSN  Qty  Rate  [CGST% CGST Amt SGST% SGST Amt] | [IGST% IGST Amt]  Amount`. Tax pair chosen once per document from `isInterstate = customerStateCode !== companyStateCode` (computed from Place of Supply vs company state); the other set of columns is not rendered.
- Totals: Subtotal / CGST+SGST OR IGST / Grand Total — same conditional.
- Bank Details block below totals, sourced once from Company Master.
- Terms & Conditions (bottom-left) from existing `q.terms` / `po.terms` (already the same "Customer notes & terms" screen). Internal remarks never rendered.
- Prepared By (bottom-right): logged-in user name + their app_users phone/email. Same as Sales Person.
- Signature block right-aligned: "For {company.name}" / "Authorized Signatory".
- Print CSS: `@page { size: A4; margin: 12mm; }`, `thead { display: table-header-group }` for repeat headers, `tr { page-break-inside: avoid }`.

## Data / performance
- One fetch each: Company Master (incl. bank + accent), Customer, Product rows joined for items already loaded on the page. No per-row API call.
- Sales Person auto-fill only on document creation (empty field), never on re-open.

## Decision points to confirm before build
1. Retire `purchaseOrderPdf.ts` (jsPDF) entirely and use `window.print()` for both docs? Or keep it as a "Download PDF" fallback rendered from the shared DOM via `docPdf.ts` (html2canvas → jsPDF)?
2. Company Master currently has a single `regd_address`. Do you want a separate `sales_office_address` field added, or should the existing field stay as "Sales Office" and we add `registered_office_address` as the second one?
3. Accent color: single global setting on Company Master (simple), or per-document-type override? I recommend single global.

## Done when
- Same `<DocumentPrintView>` renders a Quotation and a PO with only `type` + data changing.
- Same-state doc: only CGST+SGST columns render; inter-state: only IGST. Verified against one of each.
- Warranty, Sales Person, Bank Details, Terms & Notes all come from existing data; no new notes/terms input added.
- No orphan commas, no "Mr. Sir", no empty contact lines.
- Prints cleanly on A4, header row repeats on page 2.
