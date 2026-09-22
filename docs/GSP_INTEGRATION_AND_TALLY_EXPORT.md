# GSP Integration + Tally Export — Design & Build Plan

> **Prokon ERP**: wiring live e-Invoicing / E-Way Bill through the Masters India GSP, and
> generating the Tally accounting export from CRM data.

- **Project:** Prokon ERP (`/Users/jai/Desktop/Prokon Erp`)
- **Date:** 2026-09-21
- **Source documents analysed:**
  - `data/gsp-pdfs/einvoice-api-spec.pdf` — *Einvoice API Document : Enterprise Solution*, Masters India (60 pp)
  - `data/gsp-pdfs/ewb-api-spec.pdf` — *EWay Bill API Document - Enterprise Solution*, Masters India (59 pp)
  - `data/gsp-pdfs/sales-proposal-gaurav-arora.pdf` — *Sale Proposal for GSP APIs* (5 pp)
- **Derived references (generated, source-verified):**
  - `docs/gsp-einvoice-api-reference.md` (1,391 lines)
  - `docs/gsp-ewb-api-reference.md` (1,763 lines)
- **Status:** design complete; Tally export **built, tested and run against live data** (51 tests green)

---

## 0. Read this first — the two asks are two different systems

The request combined two things that are easy to conflate because both touch invoices:

| | **A. GSP API** (the 3 PDFs) | **B. Tally export** |
|---|---|---|
| Question it answers | *How do I get a legal IRN + E-Way Bill number?* | *How do I get my books into TallyPrime?* |
| Direction | Prokon → Government (IRP/NIC) | Prokon → Tally (on your Windows PC) |
| Transport | HTTPS REST, JSON | Tally XML (file or HTTP gateway :9000) |
| Legal status | **Statutory** — an invoice has no legal validity without an IRN once e-invoicing applies | **Bookkeeping** — convenience, no statutory deadline |
| Cost | ₹25,000 + 18% GST / year (4,000 calls) | ₹0 (Tally's gateway is built in) |
| Status today | **Not built** — manual JSON upload + paste-back | **Export built this session**; push-to-Tally runner not yet written |

They share one thing: **both must agree, to the paisa, with the stored invoice header.**
That is why this design routes both through the same GST engine (`src/lib/gst.ts`).

---

## 1. The commercial terms (from the proposal)

| Term | Value |
|---|---|
| Price | **₹25,000 / year + 18% GST** (₹29,500 gross) |
| Included volume | **4,000 API calls** — E-Invoicing + E-Way Bill + GSTIN verification bundled |
| Volume note | ~11 calls/day. An invoice with an E-Way Bill costs **2 calls** (1 IRN + 1 EWB) → ~2,000 invoices/year |
| On-boarding & support | **FOC (free) one-time** |
| Support SLA | Call / chat / email, **10:00–19:00 Mon–Fri**; dedicated engagement manager |
| Notice period | **60 days** termination |
| Payment | **100% in advance** |
| Quote validity | **7 days** from the proposal date |
| Functional support | **Not included**; "No code or logic will be provided" |
| Scope offered | E-Invoice: auth, generate IRN, cancel IRN, get details. EWB: generate, cancel, "all functions government provides". Plus **GSTIN verification** |

### 1.1 The volume number is the decision-critical figure

**4,000 calls/year is roughly 2,000 e-invoiced despatches.** Before signing, confirm your
actual annual invoice+EWB count. If Prokon issues more than ~2,000 invoices a year that need
an E-Way Bill, this tier runs out and the overage rate is **not stated in the proposal**.
Ask for (a) the per-call overage rate, and (b) the price of the next tier. This is the single
biggest commercial risk in the pack.

Also confirm: does GSTIN verification draw from the same 4,000 pool? If yes, a verification
-per-customer workflow can silently eat the e-invoice budget.

### 1.2 Sandbox-first is contractually supported

Sandbox and production are **separate deliverables**, each priced into the bundle. Insist that
the sandbox is provisioned first and that production credentials are released only after your
integration passes sandbox — that sequencing is already in the proposal's deliverables table,
so it costs nothing to require.

---

## 2. What Prokon already has (this matters — most of the work is done)

The CRM is **far closer to live GSP than it looks.** Current state, verified in code:

| Asset | Path | Lines | What it gives us |
|---|---|---|---|
| NIC e-Invoice v1.03 + EWB v1.0 builders | `src/lib/invoiceJson.ts` | 1,297 | **Pure, deterministic** JSON builders + validators + response parsers |
| e-Invoice façade | `src/lib/einvoice.ts` | 222 | `getInvoiceCompletionStatus`, re-exports |
| GST engine | `src/lib/gst.ts` | 536 | `computeTotals`, `hsnSummary`, per-SalesType logic |
| Transport (25-field Tally parity) | `src/lib/transport.ts` | — | `computeEInvoiceRequired`, `computeEWayRequired` (≥₹50k) |
| GSTIN checksum + state codes | `src/lib/india.ts` | — | mod-36 checksum validation, states 01–38 |
| Manual staged flow | `src/routes/_app/sales.invoices.$id.tsx` | — | Download JSON → upload to portal → paste back |
| DB columns | `invoices` | — | `irn, ack_no, ack_date, qr_payload, einvoice_status, einvoice_error, ewaybill_no, ewaybill_date, ewaybill_valid_till` |
| EWB table | `eway_bills` | — | `ewb_no, ewb_date, valid_till, status, payload, response, error` |
| Compliance view | `v_invoices_compliance` | — | `is_complete` flag |
| Server-secret pattern | `src/lib/server-secrets.ts` | 41 | Where GSP credentials belong |
| Server-fn pattern | `*.functions.ts` (10 files) | — | `createServerFn` — where the GSP client belongs |

**The existing flow is a three-step manual dance:** build JSON → user downloads and uploads it to
`einvoice1.gst.gov.in` → user pastes the response back, which `parseGstPortalIrnResponse` validates
and persists. The GSP work replaces **only the middle step** with an HTTPS call. The builders,
validators, parsers and DB columns stay exactly as they are.

---

## 3. GSP integration architecture

```
Browser (authenticated admin)
   │  createServerFn  — NEVER exposes GSP credentials
   ▼
src/lib/gsp.functions.ts            server-only
   ├── gsp.functions.ts → token cache (module-scope, per-process)
   └── gspClient.ts                pure-ish HTTP client (injectable fetch)
          │
          │  Authorization: JWT <token>
          ▼
https://sandb-api.mastersindia.co/api/v1/...   (sandbox — prod host TBD, see §7)
          │
   ┌──────┴───────┐
   ▼              ▼
POST /einvoice/   POST /ewayBillsGenerate/
   │              │
   └──────┬───────┘
          ▼
   IRP / NIC portal
          ▼
results.{message|errorMessage}  →  parse → persist to invoices / eway_bills
```

### 3.1 New files

| File | Purpose |
|---|---|
| `src/lib/gspClient.ts` | Endpoint wrappers, auth, retry, timeouts, error mapping. No Supabase. |
| `src/lib/gsp.functions.ts` | `createServerFn` entry points the UI calls. Reads creds, calls client, persists. |
| `src/lib/gspPayload.ts` | **The transformer** — Prokon/NIC shape → GSP request body (§3.3). |
| `src/lib/__tests__/gspPayload.test.ts` | Golden-file tests for the transformer. |

### 3.2 Authentication — get this right or nothing works

From the docs (verified in source, 10 instances, **zero** occurrences of "Bearer"):

```http
POST https://sandb-api.mastersindia.co/api/v1/token-auth/
Content-Type: application/json

{ "username": "<gsp username>", "password": "<gsp password>" }
```
→ `{ "token": "<JWT>" }`  *(unwrapped — NOT inside `results`)*

Every subsequent call:
```http
Authorization: JWT <token>
```

**Three traps:**
1. The scheme is **`JWT`**, not `Bearer`. Using `Bearer` returns an opaque auth failure.
2. The token response is **not** wrapped in the `results` envelope that every other call uses.
3. **Token lifetime is undocumented.** Only the sample JWT's `exp`/`orig_iat` implies ~20–24 h.
   **Do not hard-code a TTL.** Cache in memory and refresh on HTTP 401 (see §3.6).

Bad credentials return a **flat** `{"error":"Unable to login with provided credential"}` — a
third, distinct failure shape.

### 3.3 The transformer is mandatory — the shapes do not match

This is the most important engineering finding of this session.

`buildGstInvoiceJson()` produces the **NIC IRP schema** (PascalCase, flat):

```json
{ "Version":"1.03", "TranDtls":{...}, "DocDtls":{...}, "SellerDtls":{...},
  "BuyerDtls":{...}, "ItemList":[...], "ValDtls":{...}, "EwbDtls":{...} }
```

The GSP `POST /einvoice/` endpoint expects a **different, lowercase snake_case wrapper**:

```json
{ "user_gstin": "09AAAPG7885R002",
  "data_source": "erp",
  "transaction_details": { "supply_type": "B2B", "charge_type": "Y",
                           "igst_on_intra": "N", "ecommerce_gstin": "" },
  "document_details":    { "document_type": "INV", "document_number": "...", "document_date": "dd/mm/yyyy" },
  "seller_details":      { "gstin","legal_name","trade_name","address1","address2","location","pincode","state_code","phone_number","email" },
  "buyer_details":       { ...same..., "place_of_supply" },
  "dispatch_details":    { "company_name","address1","address2","location","pincode","state_code" },
  "ship_details":        { ... },
  "export_details":      { "ship_bill_number","ship_bill_date","country_code","foreign_currency","refund_claim","port_code","export_duty" },
  "payment_details":     { "bank_account_number","paid_balance_amount","credit_days","credit_transfer","direct_debit","branch_or_ifsc","payment_mode","payee_name","outstanding_amount","payment_instruction","payment_term" },
  "reference_details":   { "invoice_remarks","document_period_details":{...},"preceding_document_details":[...],"contract_details":[...] },
  "additional_document_details": [ { "supporting_document_url","supporting_document","additional_information" } ],
  "ewaybill_details":    { "transporter_id","transporter_name","transportation_mode","transportation_distance","transporter_document_number","transporter_document_date","vehicle_number","vehicle_type" },
  "value_details":       { "total_assessable_value","total_cgst_value","total_sgst_value","total_igst_value","total_cess_value","total_cess_value_of_state","total_discount","total_other_charge","total_invoice_value","round_off_amount","total_invoice_value_additional_currency" },
  "item_list":           [ { "item_serial_number","product_description","is_service","hsn_code","bar_code","quantity","free_quantity","unit","unit_price","total_amount","pre_tax_value","discount","other_charge","assessable_value","gst_rate","igst_amount","cgst_amount","sgst_amount","cess_rate","cess_amount","cess_nonadvol_amount","state_cess_rate","state_cess_amount","state_cess_nonadvol_amount","total_item_value","country_origin","order_line_reference","product_serial_number","batch_details":{...} } ]
}
```

So `gspPayload.ts` must map **field-by-field**. Field-name correspondence:

| Prokon / NIC | GSP | Notes |
|---|---|---|
| — | `user_gstin` | From branch/company GSTIN. Not in NIC JSON. |
| — | `data_source` | Literal `"erp"` |
| `TranDtls.SupTyp` | `transaction_details.supply_type` | `B2B`/`B2C`/`SEZWP`/`SEZWOP`/`EXPWP`/`EXPWOP` — `getSupTypForSalesType()` already computes this |
| `TranDtls.RegRev` | `transaction_details.charge_type` | `Y`/`N` |
| `TranDtls.IGSTOnIntra` | `transaction_details.igst_on_intra` | `Y`/`N` |
| `DocDtls.Typ` | `document_details.document_type` | NIC `INV` — confirm GSP accepts the same enum |
| `DocDtls.No` | `document_details.document_number` | NIC caps at 16; see sanitisation note |
| `DocDtls.Dt` | `document_details.document_date` | **`dd/mm/yyyy`** — `gstDateDDMMYYYY()` already exists |
| `SellerDtls.*` | `seller_details.*` | `LglNm`→`legal_name`, `TrdNm`→`trade_name`, `Addr1`→`address1`, `Loc`→`location`, `Pin`→`pincode`, `Stcd`→`state_code`, `Ph`→`phone_number`, `Em`→`email` |
| `BuyerDtls.*` | `buyer_details.*` | plus `Pos`→`place_of_supply` |
| `DispDtls.*` | `dispatch_details.*` | |
| `ShipDtls.*` | `ship_details.*` | |
| `ExpDtls.*` | `export_details.*` | `ShipBNo`→`ship_bill_number`, `CntCode`→`country_code`, `ForCur`→`foreign_currency`, `RefClm`→`refund_claim`, `Port`→`port_code`, `ExpDuty`→`export_duty` |
| `PayDtls.*` | `payment_details.*` | **Prokon currently has no source for most of these** (see gap G2) |
| `RefDtls.*` | `reference_details.*` | |
| `AddlDocDtls[]` | `additional_document_details[]` | `Url`→`supporting_document_url`, `Docs`→`supporting_document`, `Info`→`additional_information` |
| `EwbDtls.*` | `ewaybill_details.*` | `TransId`→`transporter_id`, `TransName`→`transporter_name`, `TransMode`→`transportation_mode`, `Distance`→`transportation_distance`, `TransDocNo`→`transporter_document_number`, `TransDocDt`→`transporter_document_date`, `VehNo`→`vehicle_number`, `VehType`→`vehicle_type` |
| `ValDtls.*` | `value_details.*` | `AssVal`→`total_assessable_value`, `CgstVal`→`total_cgst_value`, `SgstVal`→`total_sgst_value`, `IgstVal`→`total_igst_value`, `CesVal`→`total_cess_value`, `StCesVal`→`total_cess_value_of_state`, `Discount`→`total_discount`, `OthChrg`→`total_other_charge`, `TotInvVal`→`total_invoice_value`, `RndOffAmt`→`round_off_amount` |
| `ItemList[]` | `item_list[]` | `SlNo`→`item_serial_number`, `PrdDesc`→`product_description`, `IsServc`→`is_service`, `HsnCd`→`hsn_code`, `Barcde`→`bar_code`, `Qty`→`quantity`, `FreeQty`→`free_quantity`, `Unit`→`unit`, `UnitPrice`→`unit_price`, `TotAmt`→`total_amount`, `PreTaxVal`→`pre_tax_value`, `AssAmt`→`assessable_value`, `GstRt`→`gst_rate`, `IgstAmt`→`igst_amount`, `CgstAmt`→`cgst_amount`, `SgstAmt`→`sgst_amount`, `CesRt`→`cess_rate`, `CesAmt`→`cess_amount`, `CesNonAdvlAmt`→`cess_nonadvol_amount`, `StateCesRt`→`state_cess_rate`, `StateCesAmt`→`state_cess_amount`, `StateCesNonAdvlAmt`→`state_cess_nonadvol_amount`, `TotItemVal`→`total_item_value`, `OrdLineRef`→`order_line_reference`, `PrdSlNo`→`product_serial_number` |

**Design rule:** keep `buildGstInvoiceJson()` as the single source of truth for the *values*, and
make `gspPayload.ts` a **shape transform only** — it must never re-derive a tax figure. That way
the NIC JSON you archive and the GSP request you send can never disagree.

### 3.4 Endpoints to implement (e-Invoice)

| # | Purpose | Method | Path |
|---|---|---|---|
| 1 | Auth token | POST | `/api/v1/token-auth/` |
| 2 | **Generate IRN** | POST | `/api/v1/einvoice/` |
| 3 | Cancel IRN | POST | `/api/v1/einvoice/cancel-einvoice/` |
| 4 | Generate EWB by IRN | POST | `/api/v1/einvoice/gen-ewb-by-irn/` |
| 5 | Get e-Invoice by IRN | GET | `/api/v1/einvoice/get-einvoice-details` (`gstin=`) |
| 6 | Get e-Invoice by doc | GET | `/api/v1/einvoice/get-einvoice-details-by-doc` (`user_gstin=`) |
| 7 | Get EWB by IRN | GET | `/api/v1/einvoice/get-ewb-details-by-irn` |
| 8 | Get GSTIN details | GET | `/api/v1/einvoice/get-gstin-details` |
| 9 | Sync GSTIN from CP | GET | `/api/v1/einvoice/sync-gstin-details` |
| 10 | Bulk generate | POST | `/api/v1/einvoice/einvoiceGenerateInBulk/` |
| 10A | Bulk poll | GET | `/api/v1/einvoice/getBulkEinvoiceResponse?request_id=…` |

> ⚠️ **Query-param inconsistency:** `#5` uses `gstin=`, while `#6`–`#9` use `user_gstin=`.
> And `#4` renames `transportation_distance` → `distance` and flattens `ewaybill_details` to top
> level. These are per-endpoint quirks copied from the source doc, not typos in this plan.

### 3.5 Response parsing — three envelopes, never branch on `status`

Success (`HTTP 200`):
```json
{ "results": { "message": { "Irn": "...64hex...", "AckNo": "...", "AckDt": "...",
                            "SignedInvoice": "...", "SignedQRCode": "...", "Status": "ACT",
                            "EwbNo": 471008880909, "EwbDt": "...", "EwbValidTill": "...",
                            "QRCodeUrl": "...", "EinvoicePdf": "...", "EwaybillPdf": "...",
                            "error": false },
               "errorMessage": "", "InfoDtls": "", "status": "Success", "code": 200,
               "requestId": "..." } }
```

Failure:
```json
{ "results": { "message": "", "errorMessage": "3038: Seller details Details:Pincode-101301 does not exists",
               "InfoDtls": "", "status": "Failed", "code": 204, "requestId": "..." } }
```

**Rules:**
1. **There is no numeric error-code field.** The code is the **leading integer of the
   `errorMessage` string** (`"3038: ..."`). Parse it with a regex, don't expect a field.
2. **Never branch on `status`.** A bulk poll record can report
   `status:"Success", code:200, error:false` **with a valid `Irn` while `EwbNo` is `null`**.
   The only signal for the EWB failure is the JSON string in `InfoDtls`
   (`InfCd:"EWBERR"` → `Desc[].ErrorCode`/`ErrorMessage`). **Branch on `EwbNo == null`.**
3. **Key sets differ per endpoint.** `#5`/`#6` return no `QRCodeUrl`/`EinvoicePdf`/`EwaybillPdf`;
   `#3` returns only `Irn` + `CancelDate`; `#7` uses a capital-A `Alert` and adds `GenGstin`.
   Do **not** share one response TypeScript interface across all endpoints.
4. Codes seen in examples: `3038` (bad pincode), `2143` (not your GSTIN), `2302` (IRN not active),
   `2148` (IRN data unavailable), `2154` (IRN not found), `4005` (EWB not found), `3001` (data
   unavailable), `5001` (auth app error), `4013` (distance too high/low).

### 3.6 Auth/retry policy

```
getToken():
  if cachedToken && !expiredSoon: return cachedToken
  POST token-auth  →  { token }
  cache in module scope with an opaque expiry (do NOT hard-code 24h;
  re-authenticate reactively on 401 and proactively every ~15 min of use)

callGsp(op):
  attempt up to 3 times
    on HTTP 401 → clear token, re-auth once, retry   (never retry a 401 blindly)
    on HTTP 5xx / network error / timeout → exponential backoff (250ms, 1s, 4s)
    on business error (results.status === "Failed") → DO NOT RETRY
        → persist errorMessage + code, surface to the user
```

**A generate-IRN call is not idempotent by accident** — retrying a request that actually
succeeded creates a duplicate-IRN condition. The safe pattern is: on timeout, **query
`get-einvoice-details-by-doc` before retrying**, and only re-generate if the first attempt
genuinely did not register. This is the single most important safety rule in the integration.

### 3.7 E-Way Bill specifics

- Dates are **`dd/mm/yyyy`**; transport document date must be **≥ document date**, and document
  date **≤ today**.
- Amounts `Decimal(18,2)`, tax rates `Decimal(6,3)`, quantity `Decimal(8,2)`.
- **Distance**: max 4000, must be within **±10%** of the PIN-database distance; `0` means "use DB
  distance"; same-PIN moves capped at 100 km (300 km for "Line Sales").
- **Max 250 items per invoice.**
- **Cancel only by the generator, within 24 hours.**
- Extend validity only **8 h before to 8 h after** expiry.
- `DIS` status after 15 days for Part-A-only bills.
- Σ value fields may exceed the invoice value by at most **₹2.00** grace.
- **EWB generation for e-invoice-enabled suppliers is blocked** for B2B/Export "Tax Invoice" with
  document date ≥ 01/10/2020 — those **must** go through the IRN path (`gen-ewb-by-irn`).
  So the correct order is always: **IRN first, then EWB by IRN.**
- No consolidated error-code table exists; there is no code for duplicate EWB, invalid GSTIN or
  invalid vehicle. **Duplicate protection is partly alert-based** — you must read
  `message.alert` on the *success* path.
- Known doc defects to code around: `#14 Get Transporter Details` reuses `#13`'s URL *and*
  `action=GetGSTINDetails`; `transportation_mode` vs `mode_of_transport`;
  `cessNonAdvol` vs `cessAdvol`; `requestId` vs `request_id`; response array misspelled
  `VehiclListDetails`; `hsn_code`/`pincode` drift between string and number.

---

## 4. Database additions (migration — author, do not execute)

Two concerns: GSP credentials/config, and export idempotency.

```sql
-- 20260930000001_gsp_integration.sql  (AUTHOR ONLY — apply via Supabase dashboard)

-- GSP credentials live in environment variables, NOT in the DB.
-- The DB holds only non-secret routing config.
create table if not exists public.gsp_settings (
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid references public.branches(id) on delete cascade,
  user_gstin         text not null,
  environment        text not null default 'sandbox' check (environment in ('sandbox','production')),
  base_url           text not null default 'https://sandb-api.mastersindia.co',
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_gstin, environment)
);

-- Every GSP attempt, success or failure — the audit trail for statutory documents.
create table if not exists public.gsp_api_log (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid references public.invoices(id) on delete cascade,
  operation     text not null,           -- auth | generate_irn | cancel_irn | gen_ewb_by_irn | get_* | bulk
  endpoint      text not null,
  http_status   int,
  ok            boolean not null default false,
  gsp_code      text,                    -- leading integer of errorMessage
  error_message text,
  request_id    text,
  request_body  jsonb,
  response_body jsonb,
  duration_ms   int,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists gsp_api_log_invoice_idx on public.gsp_api_log (invoice_id, created_at desc);
create index if not exists gsp_api_log_op_idx      on public.gsp_api_log (operation, created_at desc);

-- Retry-safety: one successful IRN per invoice, enforced by the DB.
create unique index if not exists invoices_irn_unique
  on public.invoices (irn) where irn is not null;
```

> **Never log the token, password, or `SignedInvoice`/`SignedQRCode` blobs** in `gsp_api_log`.
> Redact before insert. The QR payload is a signed legal artifact — store it on `invoices.qr_payload`
> only, not in a general-purpose log table.

**Note on existing columns:** `invoices.qr_payload` and the `eway_bills` table already exist, so no
destructive change is needed. `eway_bills.ewb_no` is `TEXT` — the GSP returns `EwbNo` as a
**number**; store as text to avoid precision loss and to match `EWB_REGEX` (12-digit) validation.

---

## 5. Tally export — what was built

**Delivered this session:** `src/lib/tallyExport.ts` (pure, ~560 lines) + 41 passing tests.

| Export | Function | Output |
|---|---|---|
| Sales voucher | `buildSalesVoucher()` | Ledger entries + inventory entries, Tally deemed-positive signs |
| Receipt voucher | `buildReceiptVoucher()` | Party credit / bank-cash debit |
| XML voucher | `voucherXml()` | `<VOUCHER VCHTYPE="Sales">` with IRNNO/EWAYBILLNO |
| Import envelope | `tallyImportEnvelope()` | `<ENVELOPE><TALLYREQUEST>Import Data</TALLYREQUEST>` |
| Ledger master | `ledgerMasterXml()` | `LEDGER ACTION="Create"` for the auto-create path |
| Response parse | `parseTallyResponse()` | `CREATED`/`ALTERED`/`ERRORS`/`LINEERROR` |
| Batch export | `buildSalesExport()` | XML + balance report + drift report |
| CSV fallback | `salesCsv()` | One row per ledger entry |

### 5.1 Safety properties (why this won't silently corrupt your books)

1. **Balance guard.** Tally signs amounts by *deemed positivity* — a party debit is **negative**.
   `assertVoucherBalances()` verifies Σ(signed) === 0 **and** that the party debit equals
   `invoices.total`; vouchers failing either land in `result.unbalanced` instead of being exported.
2. **Per-rate GST buckets.** Tally needs one ledger line per tax rate, so 5% + 18% cannot be
   collapsed. `gstBuckets()` emits one entry per distinct rate and drops zero buckets.
3. **Drift detector.** `buildSalesExport()` recomputes tax from the lines via the shared GST engine
   and reports any line/header disagreement in `result.drift`. **The export posts the STORED header**
   (that is what the IRN was generated against and what the customer holds) — drift is a warning to
   investigate, never something the exporter silently "corrects".
4. **Cancelled invoices skipped**, counted in `skippedCancelled`.
5. **Dates fail loudly.** `tallyDate()` throws on an unparseable date rather than emitting a
   plausible-looking wrong `YYYYMMDD` that Tally would happily post.
6. **XML escaping** on every interpolated value (party names with `&`, `<` are common in India).
7. **GUID stamping** — each voucher carries `<GUID>` = invoice UUID, which is how you make repeated
   exports idempotent at the Tally end.
8. **Header discount is credited GROSS.** `invoices.taxable_value` is stored *net* of discount, so
   Sales is credited `taxable_value + discount` and `Discount Allowed` is debited as a contra.
   Crediting net *and* also debiting the discount leaves the voucher short by exactly the discount
   — a real bug caught and fixed during this session (see §5.2).
9. **Fabricated statutory references are blocked.** `looksFabricatedIrn()` and
   `detectReferenceWarnings()` refuse to write mock IRNs or malformed E-Way Bill numbers into Tally.
   This fired on live data — see §12.
10. **`--allow-fake-references` still strips, never writes.** The escape hatch emits the vouchers but
    removes the untrustworthy IRN/EWB fields, so a fabricated identifier can never reach Tally.

### 5.2 A real bug the tests initially missed

The first version of `buildSalesVoucher` credited Sales with the stored (net) `taxable_value` **and**
debited `Discount Allowed` by the discount. Because `taxable_value` is already net of discount, the
discount was counted twice and the voucher came out unbalanced by exactly the discount amount
(reproduced with taxable 900 / discount 100 / CGST 81 / SGST 81 / total 1062 → Σ = −82 instead of 0).

An independent edge-case balance probe caught it; the unit suite had not, because every fixture had
`discount: 0`. It is now fixed and covered by a dedicated test. **Lesson:** a balance check on every
voucher, not just on well-behaved fixtures, is what makes this export safe.

### 5.3 A real finding from the tests

The GST engine rounds **CGST and SGST independently, per line**. On a ₹2762.71 line at 18% it
produces CGST 248.65 and SGST 248.64 — an odd-paisa asymmetry. The invoice header stores
1868.64/1868.64. So a recompute can disagree with the stored header by one paisa.

This is exactly why the drift detector exists, and why the export must post the **stored** header:
your IRN and the customer's paper are generated from the stored values, so Tally must match those,
not a re-derivation. **Worth a decision from your accountant:** whether to (a) accept 1-paisa
drift as immaterial, or (b) change the engine to round the CGST/SGST header to a single total
(which changes printed invoices and should be done deliberately, not as an export side-effect).

### 5.3 Tally ledger map

Defaults match conventional Tally naming (`Sales Accounts`, `CGST 9%`, `SGST 9%`, `IGST 18%`,
`Round Off`, `Bank Account`, `Cash`). Because Tally ledger names **must exist** in your company's
chart of accounts, they are centralised in `TallyLedgerMap` with `taxOverrides` and
`byMode` — a mismatch is a config change, not a code change.

> **Action needed from you:** send the exact ledger names from your TallyPrime company (Gateway of
> Tally → Display More Reports → Chart of Accounts → Ledgers). I will set the map to match. Until
> then, exports will use the defaults and Tally will reject unknown ledger names via `LINEERROR`.

### 5.4 What is NOT built yet

- **The runner** that reads Supabase and POSTs XML to Tally's gateway on `:9000`. Not built because
  it needs a decision on **file-based import vs live HTTP gateway** (§6, decision D2).
- Purchase / vendor vouchers (`purchase_orders`, `grns`), credit notes, journal entries.
- Payment *allocation* splitting (one receipt → many invoices) — `payment_allocations` exists and
  is the right source, but the voucher-splitting rule needs sign-off.

---

## 6. Decisions I need from you

| # | Decision | Why it matters | My recommendation |
|---|---|---|---|
| **D1** | **Sign the GSP proposal?** | 4,000 calls ≈ 2,000 despatches/year; overage rate unstated | Get the overage rate + next tier **in writing** before paying. Quote expires in 7 days. |
| **D2** | **Tally: file import or live HTTP gateway (:9000)?** | File import = manual, auditable, zero moving parts. Gateway = automatic but needs the Windows PC always on and a bridge process | **Start with file/XML import.** It needs no new infrastructure and proves the mapping. Add the gateway later. |
| **D3** | **Tally ledger names** | Export fails on unknown ledgers | Send me the chart of accounts. |
| **D4** | **CGST/SGST 1-paisa drift** | Affects books-vs-invoice agreement | Ask the accountant. My read: immaterial, but it is their call. |
| **D5** | **Does Prokon remain the sole billing source?** | `TALLY_BRIDGE_PLAN.md` says yes; confirms Tally is a consumer only | Confirm — it avoids two-way sync complexity entirely. |
| **D6** | **Production GSP host** | Not in any of the 3 PDFs | Must be obtained from Masters India. |
| **D7** | **EWB-only invoices?** | If EWB is raised for non-e-invoice docs, a second code path is needed | Prefer IRN-first-then-EWB universally. |

---

## 7. Gaps and blockers

### Must be resolved with Masters India before production code is written

| # | Gap | Impact |
|---|---|---|
| G1 | **No production host** anywhere in the 3 PDFs — only `https://sandb-api.mastersindia.co` | Configuration is blocked. Record as an ADR once supplied. |
| G2 | **`payment_details` has no source in Prokon** — Prokon stores bank info on `branches`, not per invoice | Either derive from `branches` + `proforma_invoice_settings`, or omit the block. Needs a decision. |
| G3 | **No error-code table** in either API doc | Error triage is guesswork. Ask for the master list. |
| G4 | **Token lifetime undocumented** | Refresh logic must be reactive (401) — already designed that way. |
| G5 | **`Version` contradiction** — one line says mandatory `'1.1'`, but it appears in no example, table, or schema | Confirm whether `/einvoice/` accepts or requires it. |
| G6 | **Bulk max batch size undocumented** | Cannot size the bulk job safely. |
| G7 | **No rate limits / 429 behaviour documented** | Unknown throttling risk; start conservative and serial. |
| G8 | **`document_type` enum for GSP vs NIC** — NIC uses `INV` | Confirm GSP accepts the same values. |
| G9 | **Cancel reason codes** — only `"1"` is shown in an example | Ask for the code list. |

### Internal

| # | Gap | Impact |
|---|---|---|
| G10 | The spec PDFs contain a **real-looking username and password** (`aman@mastersindia.co` / `Miitspl@123`) in the auth examples | Sample credentials in a confidential doc. **Never** commit these; confirm with Masters India whether they are live and rotate. |
| G11 | ~12 places where the docs' examples contradict their own parameter tables (`contract_details` vs `contact_details`, `round_off` range, e-way-bill required-list conflicts, a `vehicle_number` enum copy-paste error) | Each must be resolved empirically against sandbox. |
| **G12** | **4 of 4 stored IRNs are fabricated (100%), and 3 of 3 E-Way Bill numbers are malformed** — see §11 | **Highest priority.** Your database currently asserts e-invoice compliance that does not exist. Investigate the legal exposure, clean the rows, remove the `mockIrnPayload()` call path, and add the DB constraints. |

---

## 8. Build plan — phased

### Phase 1 — Tally export (largely done)
1. ✅ `src/lib/tallyExport.ts` + 51 tests
2. ✅ Typecheck + ESLint clean
3. ⬜ Runner: read `invoices`/`invoice_items` → `buildSalesExport` → write `.xml` (+ `.csv`)
4. ⬜ UI: a **Reports → Tally Export** tab (date range + branch filter), download button
5. ⬜ Map real ledger names (D3)
6. **Verification:** import the generated XML into a Tally *trial* company; confirm voucher count and
   that the Trial Balance ties out to the invoice register.

### Phase 2 — GSP client, sandbox
7. ⬜ `gspPayload.ts` + golden-file tests (§3.3)
8. ⬜ `gspClient.ts` — token cache, JWT header, retry/backoff, error mapping
9. ⬜ `gsp.functions.ts` — `createServerFn` wrappers with auth checks
10. ⬜ Migration `20260930000001_gsp_integration.sql` (author only)
11. ⬜ Replace the manual paste-back step in `sales.invoices.$id.tsx` with a live call, **keeping
    paste-back as a fallback** so a GSP outage never blocks billing
12. **Verification:** generate an IRN + EWB for a test GSTIN in sandbox; confirm the returned
    `Irn`/`AckNo`/`SignedQRCode` parse and persist, and that `v_invoices_compliance.is_complete`
    flips true.

### Phase 3 — Hardening
13. ⬜ Bulk IRN generation for backfill (`#10`/`#10A`) with the `EwbNo == null` trap handled
14. ⬜ 24-hour cancellation window enforcement in the UI
15. ⬜ `gsp_api_log` dashboard for failed attempts
16. ⬜ Production cutover: swap `base_url`, disable sandbox, re-verify

---

## 9. Verification plan

| Rung | Command / action | Status |
|---|---|---|
| Unit tests | `npx vitest run src/lib/__tests__/tallyExport.test.ts` | ✅ **51/51 pass** |
| Typecheck | `npx tsc --noEmit` | ✅ exit 0 |
| Lint | `npx eslint src/lib/tallyExport.ts src/lib/__tests__/tallyExport.test.ts scripts/tally-export.ts` | ✅ exit 0 |
| Live end-to-end | `npx vite-node scripts/tally-export.ts -- --from 2026-04-01 --to 2027-03-31` | ✅ ran against live Supabase: 10 invoices fetched, 9 vouchers built, 1 cancelled skipped |
| XML well-formedness | `xml.etree.ElementTree.parse()` on the generated file | ✅ parses; 9 `TALLYMESSAGE`; voucher signs correct; **Σ ledger entries = 0.00** |
| Fabricated-reference guard | Same live run, before the guard existed vs after | ✅ 7 fabricated refs now BLOCK the export (was: silently written) |
| Build | `npm run build` | ⬜ not run |
| Tally import | Import generated XML into a Tally trial company | ⬜ needs TallyPrime access |
| GSP sandbox | Live IRN + EWB against sandbox | ⬜ needs Masters India credentials |

**Regression rule:** expanding `gstBuckets`, `buildSalesVoucher` or the voucher sign convention
**requires** re-running the balance tests — a sign error there produces a voucher that balances
in Tally but posts backwards, which is the hardest class of accounting bug to notice.

---

## 10. Cost summary

| Item | Cost |
|---|---|
| GSP APIs (4,000 calls/yr: e-Invoice + EWB + GSTIN) | **₹25,000 + 18% GST = ₹29,500 / yr** |
| On-boarding & support | FOC |
| TallyPrime XML/HTTP gateway | **₹0** (built into TallyPrime) |
| Tally export development | In-house (mostly done this session) |
| Hosting | Existing Vercel + Supabase |

**Effective cost per e-invoiced despatch at the 4,000-call tier: ~₹14.75** (₹29,500 ÷ ~2,000 despatches).
If you exceed 4,000 calls, that figure changes by an unknown overage rate — see D1.

---

## 12. 🔴 DATA INTEGRITY FINDING — fabricated IRN / E-Way Bill numbers in production

**Found while validating the Tally export against your live database on 2026-09-21.**

### What was found

A read-only audit of `public.invoices` (10 rows) returned:

| Metric | Count |
|---|---|
| Total invoices | 10 |
| Carrying an IRN | 4 |
| **IRNs that are fabricated** | **4 (100%)** |
| Genuine IRNs | **0** |
| Invoices carrying an E-Way Bill number | 3 |
| **E-Way Bill numbers that are malformed** | **3 (100%)** |

Specific rows:

| Invoice | Field | Value | Problem |
|---|---|---|---|
| `PHS/INV/26-27/0001` | `irn` | `f31a6ff6` × 8 | mock output |
| `PHS/26-27/0006` | `irn` | `e64b2b54` × 8 | mock output |
| `PHS/INV/26-27/0008` | `irn` | `3906740a` × 8 | mock output |
| `PHS/INV/26-27/0009` | `irn` | `2d0864a9` × 8 | mock output |
| `PHS/26-27/0002` | `ewaybill_no` | `EWB83440626047` | not 12 digits (14 chars, `EWB` prefix) |
| `PHS/INV/26-27/0008` | `ewaybill_no` | `EWB88414466353` | not 12 digits |
| `PHS/INV/26-27/0009` | `ewaybill_no` | `EWB88441940382` | not 12 digits |

All four rows also have `einvoice_status = 'generated'`.

### Why this is serious

1. **These pass every existing check.** `mockIrnPayload()` in `src/lib/gst.ts` builds
   `hash.repeat(8)` from an 8-character hash — a 64-character lowercase hex string. It therefore
   **satisfies `IRN_REGEX` (`/^[0-9a-f]{64}$/i`)**. Regex validation, checksum validation and the
   `v_invoices_compliance.is_complete` view all treat these as valid.
2. **The system reports them as legally complete.** `einvoice_status='generated'` plus the
   `is_complete` flag means the UI currently tells staff these invoices are compliant. They are not.
   `src/lib/einvoice.ts` documents that `mockIrnPayload()` "fabricated IRN/QR values" and was
   supposed to have been retired — but its output is live in the data.
3. **It would have propagated into Tally.** Without the guard added this session, exporting these
   vouchers would write fabricated statutory identifiers into your accounting books as `IRNNO` /
   `EWAYBILLNO`.

### What was done about it

- **`looksFabricatedIrn()`** in `src/lib/tallyExport.ts` detects the `xxxx.repeat(8)` pattern, which
  real SHA-256 output does not produce.
- **`detectReferenceWarnings()`** also validates the E-Way Bill number shape (must be 12 digits).
- **The export runner now refuses to write any output** when either is found, printing every
  offending row. Override only with `--allow-fake-references`.
- 47 unit tests cover this, including a positive test that a realistic non-repeating 64-hex IRN is
  **not** flagged.

### What you must do

1. **Decide the legal question first.** If any of these invoices were actually issued to customers
   as GST invoices, the supplies may be non-compliant and need a real IRN raised (and possibly a
   revised document). This is an accountant/CA question, not a software one — surface it before
   anything else.
2. **Clean the data** (author a migration; do not let the app "fix" it silently):

```sql
-- 20260930000002_purge_mock_einvoice_refs.sql   (AUTHOR ONLY — review, then apply yourself)

-- Null out fabricated IRNs: 8-hex block repeated 8 times.
update public.invoices
   set irn = null,
       ack_no = null,
       ack_date = null,
       qr_payload = null,
       einvoice_status = 'pending'
 where irn is not null
   and lower(irn) = repeat(lower(substr(irn, 1, 8)), 8);

-- Null out malformed E-Way Bill numbers (anything not exactly 12 digits).
update public.invoices
   set ewaybill_no = null,
       ewaybill_date = null,
       ewaybill_valid_till = null,
       eway_status = 'pending'
 where ewaybill_no is not null
   and ewaybill_no !~ '^[0-9]{12}$';
```

   > Before running: `select` the same predicates and confirm the row set matches the table in
   > §12 exactly. Take a backup (the project already has a daily Drive backup job).
3. **Remove the generator from the code path.** `mockIrnPayload` is still imported by
   `src/routes/_app/sales.invoices.$id.tsx:35` and called at line 177. Replace that call with the
   real GSP path (Phase 2) or with an explicit "generate test data" dev-only action.
4. **Add a DB-level guard** so this cannot recur silently:

```sql
-- Reject the repeated-block pattern at the source.
alter table public.invoices
  add constraint invoices_irn_not_mock
  check (irn is null or lower(irn) <> repeat(lower(substr(irn, 1, 8)), 8));

alter table public.invoices
  add constraint invoices_ewaybill_shape
  check (ewaybill_no is null or ewaybill_no ~ '^[0-9]{12}$');
```

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **GSP** | GST Suvidha Provider — a GSTN-authorised gateway. Masters India is the one here. |
| **IRP** | Invoice Registration Portal — issues the IRN. |
| **IRN** | Invoice Reference Number — 64-hex SHA-256, the invoice's legal identity. |
| **EWB** | E-Way Bill — 12-digit transport document, mandatory above ₹50,000. |
| **NIC** | National Informatics Centre — operates the EWB portal. |
| **GSTIN** | 15-char GST identifier. |
| **Sandbox** | Test environment connected to the real IRP/NIC test instances. |
| **Tally gateway** | TallyPrime's built-in HTTP/XML endpoint on port 9000. |
