# Standalone Invoice Module — Plan & Context

> Branch: `invoice-module` · Goal: end-to-end standalone Invoice module
> that is the **source of truth for bill generation**, outputs a **GST e-invoice
> JSON** you hand to the GST portal, records the **IRN / QR / e-Way Bill number**
> you paste back, and provides a **Tally (CSV/Excel) export** for manual entry.

---

## 0. How the existing module works today

The current invoicing feature lives inside the **`sales`** permission module
("Sales & Invoicing") under the **Sales** group in the sidebar.

### Routes
| Route | File | Purpose |
|-------|------|---------|
| `/sales/invoices` | `src/routes/_app/sales.invoices.index.tsx` | List — search by invoice#, customer, GSTIN; filter by status; paginated table with total/paid/due + IRN indicator |
| `/sales/invoices/new` | `src/routes/_app/sales.invoices.new.tsx` (704 lines) | Full invoice creation form |
| `/sales/invoices/$id` | `src/routes/_app/sales.invoices.$id.tsx` (322 lines) | Read-only detail + operations |

### Data model (Postgres — `supabase/setup_new_supabase.sql`)
- **`invoices`** — header table. Seller/buyer snapshots, GST money fields
  (subtotal, discount, taxable_value, cgst, sgst, igst, cess, round_off, total,
  total_paid), `status` (draft|issued|partial|paid|cancelled), e-invoice fields
  (`irn`, `ack_no`, `qr_payload`, `einvoice_status`, `einvoice_error`), e-way
  fields (`ewaybill_no`, `ewaybill_date`, `ewaybill_valid_till`), notes/terms,
  `is_deleted` soft delete.
- **`invoice_items`** — line items: HSN, qty, rate, discount %, tax rates,
  warehouse_id, serial_numbers[]. `invoice_no` is generated **server-side by
  the `set_invoice_no()` trigger** on INSERT (can't be forged client-side).
- **`eway_bills`** — e-way bill records.
- RLS + `has_permission('sales', …)` governs read/write.

### Form (`sales.invoices.new.tsx`)
- Branch/seller picker (validates branch GSTIN), customer picker, invoice/due
  date, PO number/date, billing vs shipping address with "same as billing".
- **GST engine** (`src/lib/gst.ts`): seller state (from branch GSTIN) vs buyer
  state → auto CGST+SGST (intra-state) vs IGST (inter-state); header-discount
  apportionment, round-off, amount-in-words, HSN summary. This GSTR-1-correct
  logic is the real strength.
- Line items: product picker autofills HSN/unit/GST/serial-flag, per-warehouse,
  per-line GST rate, serial-number multi-picker, bundle expansion,
  negative-stock guard with admin override.
- Prefill from General DC; flips the linked DC to "Converted".

### Detail page (`sales.invoices.$id.tsx`)
- **Issue** (draft → issued), **Generate IRN**, **e-Way Bill** (only when total
  ≥ ₹50k — mock only), **Record Payment** (links to payments module), **Print** +
  **Download PDF** (`src/lib/invoicePdf.ts`, jsPDF + autotable + qrcode),
  **Cancel** with reason (serials auto-released by DB trigger).

---

## 1. The critical gap (what you asked to build)

From `src/lib/gst.ts` (lines 288-289):

> *"Mock e-Invoice IRN + QR payload generator. Real GSP integration plugs in later
> through the same interface (see docstring in `einvoice.ts`)."*

**`einvoice.ts` does not exist.** Today the module **fakes the entire
e-invoice / e-way flow**:

- **IRN** — `mockIrnPayload()` just hashes invoice_no+date+total into a fake
  64-hex IRN and a fake QR string. It is **never** sent to the GSTN IRP — there
  is no real IRN, no real `SignedQRCode`, no real Ack No from the portal.
- **e-Way Bill** — the detail page fabricates a mock EWB number with 24h
  validity; not generated from GSTN.
- **Tally export** — **does not exist**. Only generic CSV/Excel/PDF via
  `src/lib/exports.ts`.
- The **GST e-invoice JSON** a user would hand to the portal / Tally is **not
  generated anywhere**.

Net: the module is a complete **GST invoice computation + PDF** tool with
**mocked** e-invoice numbers. The end-to-end link to the real portal and Tally
is the missing piece.

---

## 2. Confirmed decisions

| Decision | Choice |
|----------|--------|
| GST portal flow | **Generate JSON + manual upload** — build the GSTN e-invoice JSON, let you download/copy it and paste back the portal response (real IRN / QR / EWB) to record. No live GSP credentials. |
| Tally export | **CSV/Excel for manual Tally entry** (reuse `src/lib/exports.ts` readers). |
| Module placement | **New standalone group + nav item** — dedicated "Billing" sidebar group, own `invoices` app_module key, own routes, separate from the `sales` group. |

---

## 3. Implementation plan

### Phase 0 — DB migration: register module + capture columns

**New migration** `supabase/migrations/20260830000003_invoice_module.sql`:

```sql
-- Register the standalone invoice module in the permissions system
INSERT INTO public.app_modules (key, label, sort_order, supports_import, is_active)
VALUES ('invoices', 'Invoices (Billing)', 27, false, true)
ON CONFLICT (key) DO NOTHING;

-- Capture columns for the REAL portal data (existing irn/qr_payload were mock)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS gst_invoice_json JSONB,   -- GSTN e-invoice JSON delivered/validated
  ADD COLUMN IF NOT EXISTS signed_qr   TEXT,          -- SignedQRCode from IRP response (base64)
  ADD COLUMN IF NOT EXISTS irn_ack_no  TEXT,          -- Ack No from IRP
  ADD COLUMN IF NOT EXISTS irn_status  TEXT,          -- null | pending | generated | cancelled | failed
  ADD COLUMN IF NOT EXISTS ew_status   TEXT;          -- e-way status
```

**Also** mirror the key into `src/lib/permissions.ts` `FALLBACK_MODULES`:
```ts
{ key: "invoices", label: "Invoices (Billing)" },
```

**Permission note:**
- Writes keep using the existing **`sales`** RLS policies (so current role
  config keeps working with zero breakage).
- The **new UI** is gated on the **`invoices`** module key
  (`PermButton` / `ModuleGate`), and admin can enable it per role under
  Masters → Users & Roles.

### Phase 1 — Navigation & standalone shell

1. **`src/lib/navigation.ts`**
   - Add `"Billing"` to `GROUP_ORDER`.
   - New nav items:
     ```ts
     { to: "/invoices",      label: "Invoices",    icon: Receipt, module: "invoices", group: "Billing", excludeActive: ["/invoices/new"] },
     { to: "/invoices/new",   label: "New Invoice", icon: Plus,    module: "invoices", group: "Billing" },
     ```
   - Add quick action: `{ label: "New Invoice", to: "/invoices/new", module: "invoices", icon: Receipt }`.
2. **Route shell** `src/routes/_app/invoices._layout.tsx` — pathless layout
   (modeled on `src/routes/_app/ims.tsx`) with tabs **Dashboard | Invoices |
   New Invoice | GST / e-Invoice | e-Way | Export (Tally)**, wrapping
   `<Outlet />` in `<ModuleGate module="invoices">`.

Planned route files (resolved by the TanStack router plugin from names):
- `invoices._layout.tsx` — group shell
- `invoices.index.tsx` — `/invoices` list
- `invoices.new.tsx` — `/invoices/new` create
- `invoices.$id.tsx` — `/invoices/$id` detail + operations (core of e2e flow)
- `invoices.einvoice.tsx` — `/invoices/e-invoice` registry + manual upload
- `invoices.eway.tsx` — `/invoices/e-way` registry
- `invoices.export.tsx` — `/invoices/export` batch export screen

### Phase 2 — Core shared logic (new libs, reuse existing)

- **`src/lib/invoiceJson.ts`** *(new)* — `buildGstInvoiceJson(invoice, items)`
  emits **GSTN e-invoice JSON v1.03**: `Version`, `TranDtls` (SuppType, DocTyp,
  DocNo, DocDt, buyer/seller GSTIN, POS, tax scheme), `DocDtls`, `SellerDtls`
  (branch snapshot), `BuyerDtls`, `ShipDtls`, `ItemList[]` (HSN, Qty, UnitPrice,
  TotAmt, Discount, AssAmt, GstRt, CgstAmt, SgstAmt, IgstAmt, CesRt, CesAmt),
  `ValDtls` (TotAssVal, CgstVal, SgstVal, IgstVal, CesVal, TotInvVal,
  RoundOffAmt, TotInvValFc), `PayDtls`, `AddnlDocDtls` (PO), `EwbDtls` (e-way
  if present).
- **`src/lib/invoiceJson.test.ts`** — unit tests validating required keys, IGST
  vs CGST+SGST correctness, totals reconcile with `computeTotals`, HSN summary.
- **`src/lib/tallyExport.ts`** *(new)* — `buildTallyRows(invoices[])` → per
  line-item rows (Date, Voucher Type=Sales, Party Ledger, GSTIN, Place of
  Supply/State, HSN, Item, Qty, Rate, Taxable, CGST/SGST/IGST, Total, Payment
  mode/ref, Invoice #, DocNum, IRN). Writes via existing `exportCSV` /
  `exportExcel`.
- **`src/lib/gst.ts`** — keep `computeTotals`, `hsnSummary`, `amountInWords`,
  `upiPaymentUri` untouched. Stop calling `mockIrnPayload` in the new flow.
  Add `parseGstPortalResponse(json)` — ingest the pasted-back IRP response and
  extract IRN, AckNo, `SignedQRCode`, EWB no/validity.

### Phase 3 — The new routes

- **`invoices.index.tsx`** — list. Reuse `sales.invoices.index.tsx` logic, query
  for the `invoices` module, show e-invoice status + e-way columns, link each row
  to `/invoices/$id`.
- **`invoices.new.tsx`** — create form. **Reuse** `sales.invoices.new.tsx` logic
  (correct GST engine). On save → insert `invoices` + `invoice_items` (with the
  existing compensating rollback), then navigate to `/invoices/$id`. Gate with
  `PermButton module="invoices"`.
- **`invoices.$id.tsx`** — detail + operations (heart of the e2e flow). Reuse
  `sales.invoices.$id.tsx` layout, **replace mock actions** with:
  - **Generate GST Invoice JSON** → `buildGstInvoiceJson()` → modal with:
    copyable raw JSON, "Download .json", and a textarea to **paste back the
    portal response** (IRP success payload with IRN, AckNo, SignedQRCode).
    On save → `parseGstPortalResponse()` → persist `irn`, `ack_no`,
    `signed_qr`, `qr payload`, `einvoice_status='generated'`,
    `gst_invoice_json`.
  - **Generate e-Way JSON** → `buildEwayJson()` (Doc Details, Transporter,
    Vehicle, Distance, Mode) when transport data is present; record returned
    EWB no / valid-till when pasted back.
  - **QR display** — render `signed_qr` (or stored QR payload) as a scannable QR
    on screen and on the PDF (reuse `qrcode`, already a dependency).
  - **Export dropdown** → Tally CSV / Tally Excel (`tallyExport`) + existing
    CSV / Excel / PDF.
  - Keep: Issue, Record Payment, Cancel, Print/PDF.
- **`invoices.einvoice.tsx`** — status/registry: all invoices grouped by
  `einvoice_status` (not generated / JSON ready / IRN generated / failed) with
  the manual upload flow.
- **`invoices.eway.tsx`** — e-way registry (style of `sales.eway.index.tsx`),
  filterable by no / validity.
- **`invoices.export.tsx`** — batch export: date range / status filter → Export
  Tally CSV, Export Tally Excel, Export GST invoice JSONs (per-file or .zip).

### Phase 4 — Wire-up & cleanup

- `groupForPath` in `navigation.ts` is path-based → works automatically.
- **Do NOT delete** the old `/sales/invoices` routes during transition — keep
  them live to avoid breakage. Optionally re-point the old "Invoices" nav item
  to the new module later; leave the `sales` module intact.
- Add `invoices` key to `FALLBACK_MODULES` and (if desired) RLS write policies.
- **Verification before completion**: `bun run build`, `bun run lint`,
  `bun test` — especially the new `invoiceJson.test.ts` and `tallyExport` tests.

---

## 4. Open decisions before building

1. **Write permission** — new `invoices` key only drives UI gating + reporting;
   DB writes keep the existing `sales` RLS (zero role breakage). *(Recommended.)*
2. **GST JSON schema version** — target GSTN **e-invoice v1.03** (current
   standard). Confirm no legacy schema needed.
3. **Tally granularity** — one row per **line-item** (for HSN-wise entry) vs one
   row per invoice. *(Recommended: per line-item.)*

---

## 5. Reference file map

- Existing module: `src/routes/_app/sales.invoices.{index,new,$id}.tsx`
- GST engine: `src/lib/gst.ts` (mock → replace e-invoice part)
- PDF: `src/lib/invoicePdf.ts`
- CSV/Excel/PDF export readers: `src/lib/exports.ts`
- Permissions: `src/lib/permissions.ts` (+ `FALLBACK_MODULES`),
  `src/lib/usePermissions.ts`, `src/lib/useModules.ts`
- Gating components: `src/components/ModuleGate.tsx`, `src/components/PermGate.tsx`
- Nav: `src/lib/navigation.ts`, app shell: `src/routes/_app.tsx`
- DB schema: `supabase/setup_new_supabase.sql` (invoices ~line 3128; module
  registration ~line 3432 is the `sales` example to mirror)
- Standalone-module template: `src/routes/_app/ims.{tsx,index.tsx}` (group shell
  with tabs) and the `general_dc` module for a recent standalone example
