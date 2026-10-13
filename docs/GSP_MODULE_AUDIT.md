# GSP / Invoicing Module — Deep-Dive Audit Report

- **Date:** 2026-09-30
- **Branch:** `feat/gsp-mock-first` @ `4da6f6b7`
- **Scope:** Masters India GSP e-Invoice + E-Way Bill integration and the invoicing module it depends on
- **Method:** 5 parallel read-only audit agents (payload builders, HTTP transport, server functions + DB + auth, UI route, tests + integrity), followed by a manual verification pass on the highest-impact claims
- **Mode at audit time:** `GSP_MODE=mock`. No sandbox credential has ever been configured.

---

## Verdict

The architecture is sound. The failure modes are handled deliberately, the security
posture is mostly good, and 88 tests pass.

The integration is **not** end-to-end ready, though. Five endpoint paths do not match
the API documentation, so every non-authenticated call returns 404 against the real
sandbox. Several serialization defects would be rejected or silently dropped by the GSP.
Two concurrency and cancellation defects affect statutory documents.

Mock tests pass partly because they never exercise the HTTP transport layer. That gap
hid the endpoint bug.

**Bottom line:** fix Phase 0 and Phase 1, then run the sandbox. Phases 2 to 4 harden and
finish the module.

---

## Verification legend

| Mark | Meaning |
|---|---|
| **[V]** | Verified by hand against the source and, where relevant, the API reference doc |
| **[R]** | Reported by an audit agent, read-only evidence, not independently re-run |
| **[?]**| Cannot be settled without a runtime, build, or database check |

---

## Objective checks

| Check | Command | Result |
|---|---|---|
| Types / syntax | `npx tsc --noEmit` | **exit 0**, no errors |
| Lint | `npx eslint` on 8 GSP + invoice files | **192 errors** — 183 `no-explicit-any` (`invoiceJson.ts` 123, `sales.invoices.$id.tsx` 68, `einvoice.ts` 1), 1 `no-control-regex`, rest style. 89 auto-fixable |
| Tests | 88 tests across 7 files | all pass (agent run) |

There are no syntax errors and no type errors. Every defect below is logical or
semantic.

---

## Phase 0 — Blockers

Nothing live works until these land.

### GSP-001 — Endpoint paths do not match the API reference **[V]** · CRITICAL

`src/lib/gspClient.ts:480-520`

The client prefixes every authenticated endpoint with `/api/v1/einvoice/`. The
reference doc's endpoint table (`docs/gsp-einvoice-api-reference.md:1369-1379`) says
otherwise for five of the six calls:

| Operation | Doc (§15) | Code | Verdict |
|---|---|---|---|
| Generate IRN | `/api/v1/einvoice/` | `/api/v1/einvoice/` | correct |
| Cancel IRN | `/api/v1/cancel-einvoice/` | `/api/v1/einvoice/cancel-einvoice/` | **wrong** |
| Gen EWB by IRN | `/api/v1/gen-ewb-by-irn/` | `/api/v1/einvoice/gen-ewb-by-irn/` | **wrong** |
| Get by IRN | `/api/v1/get-einvoice` | `/api/v1/einvoice/get-einvoice-details` | **wrong** |
| Get by doc | `/api/v1/get-einvoice-bydoc` | `/api/v1/einvoice/get-einvoice-details-by-doc` | **wrong** |
| Get EWB by IRN | `/api/v1/get-ewb-byirn` | `/api/v1/einvoice/get-ewb-details-by-irn` | **wrong** |
| Get GSTIN details | `/api/v1/get-gstin-details` | `/api/v1/einvoice/get-gstin-details` | **wrong** |

Query-string defects in the same block:

- `get_einvoice_by_doc` omits the required `document_type` parameter. The doc's example
  carries `document_type=INV`.
- `get_ewb_by_irn` omits `user_gstin`.
- `get_gstin_details` sends `gstin` + an `action` parameter instead of the documented
  `user_gstin` + `gstin`.

The module docstring (`gspClient.ts:8-26`) claims these are "pinned from the source
documents." They are not. The `gstin=` vs `user_gstin=` query inconsistency at
`gspClient.ts:493` and `:501` is a genuine API quirk, but it is only two of the errors.

**Impact:** every call except token-auth and generate-IRN fails with 404. Note that
generate-IRN is the one non-idempotent call, so a partial-working sandbox would mint
real IRNs and then fail to read them back or cancel them.

**Fix:** rebuild all six paths and query strings from the §15 table. `sandbox` and
`production` only. Keep the deliberate `gstin=` / `user_gstin=` split, and comment it as
a documented quirk rather than an inconsistency.

### GSP-002 — Duplicate IRN race **[R]** · CRITICAL

`src/lib/gsp.functions.ts:210, 259-274`

`generateGspIrn` reads `bundle.raw.irn`, checks it is null, then mints. There is no row
lock and no conditional write. Two concurrent clicks both observe `irn = null`, both call
`transport.generateIrn()`, and both write.

The unique constraint on `invoices.irn` does not help. It prevents two invoices sharing an
IRN, not one invoice receiving two. The second write silently overwrites the first.

**Fix:** make the update conditional and treat a zero-row result as the concurrency
signal.

```ts
const { data: won } = await admin
  .from("invoices")
  .update({ irn, ack_no, ack_date, einvoice_status: "generated" })
  .eq("id", invoiceId)
  .is("irn", null)          // claim the row
  .select("irn")
  .maybeSingle();
if (!won) return { ok: true, alreadyGenerated: true, irn: /* re-read */ };
```

Consider a Postgres advisory lock keyed on the invoice id for the read-then-mint window.
The codebase already uses that pattern in `20260924000001_fix_advisory_lock_overload_collision.sql`.

### GSP-003 — Minted IRN is lost when the database write fails **[R]** · HIGH

`src/lib/gsp.functions.ts:259-277`

If the invoice UPDATE fails (`updErr`), the handler throws. The GSP has already registered
a real statutory IRN. Unlike the timeout path, this branch never calls `resolveOutcome`
and never calls `logCall`. There is no audit row, `einvoice_status` is unchanged, and the
UI still offers Generate IRN. The next click hits the GSP's duplicate-document rejection
and the local record never converges.

**Fix:** on `updErr`, run `resolveOutcome` to reconcile, always write a `gsp_api_log` row,
then surface the error.

### GSP-004 — Cancel never clears the IRN **[V]** · HIGH

`src/lib/gsp.functions.ts:430-434`

```ts
await admin.from("invoices")
  .update({ einvoice_status: "cancelled", einvoice_error: null })
  .eq("id", data.invoiceId);
await admin.from("eway_bills").update({ status: "cancelled" }).eq("invoice_id", data.invoiceId);
```

Three problems in six lines. `irn`, `ack_no`, `ack_date` and `qr_payload` are all left in
place, so `hasIrn` in `einvoice.ts:186` still returns true and the compliance badge still
reads "Complete". Neither update checks its `error`. There is no `logCall`.

Downstream effects: the green "e-Invoice ✓" badge keeps rendering
(`sales.invoices.$id.tsx:939`); `isLocked` stays true (`:252`), which hides the Cancel
Invoice card and blocks `issueIfDraft`. The invoice has no reachable terminal state.

**Fix:** clear the statutory fields in the same update, check both errors, write a log row.

### GSP-005 — `create_invoice_with_items` is callable by `anon` **[V]** · HIGH

`supabase/migrations/20260930000001_create_invoice_with_items.sql:59-85, 193-194`

```sql
create or replace function public.create_invoice_with_items(...)
security definer
set search_path = public
  ...
     and auth.uid() is not null        -- line 85: skipped for anon
...
grant execute ... to authenticated;     -- line 193
grant execute ... to service_role;     -- line 194
```

`CREATE FUNCTION` grants EXECUTE to `PUBLIC` by default and there is no
`revoke execute ... from public, anon`. For an anonymous request `auth.uid()` is NULL, so
the guard short-circuits and is skipped. Combined with `SECURITY DEFINER`, an anonymous
caller can insert an invoice header plus items as the table owner.

**Fix:**

```sql
revoke execute on function public.create_invoice_with_items(jsonb, jsonb) from public, anon;
```

and change the guard to deny when `auth.uid() is null` unless the role is `service_role`.
Sibling migrations already use this idiom: `20260921000001_engineer_material_stats_rpc.sql:20`
and `20260924000001_fix_advisory_lock_overload_collision.sql:91`.

**Verify [?]:** `select has_function_privilege('anon','public.create_invoice_with_items(jsonb,jsonb)','EXECUTE');`

### GSP-006 — `gspMock.ts` uses Node-only globals in a client-reachable module **[R][?]** · HIGH

`src/lib/gspMock.ts:78, 111, 211`

| Line | Issue |
|---|---|
| 78 | `Buffer.from(...).toString("base64")` in `signedQr()`. `Buffer` is a Node global, not an import, so Vite's browser-external shim cannot catch it. `pnpm build` passes; it dies at runtime with `Buffer is not defined` |
| 111 | `process.env.GSP_MOCK_ERROR` — `process` is undefined in a browser bundle. This is the first statement of `createMockTransport`, so it throws `ReferenceError` before any call runs |
| 211 | Bare `require("./gspClient")` inside `createTransportForMode` — no `require` in an ESM chunk |

The module is client-reachable. Commit `82e5acaa` exists precisely because
`createHash` from `node:crypto` broke the browser build; that commit fixed the import but
did not address these three globals. The fix's own verification note ("0 browser-external
errors") proves the import is gone, not that these globals are unreachable.

`createTransportForMode` has zero importers, so deleting it is the clean fix for line 211.

**Verify [?]:** `pnpm build && grep -rlE "NIC Sandbox|mock-token-auth|Buffer.from" dist/ .output/`

---

## Phase 1 — Serialization correctness

The GSP rejects or silently drops these.

### PAY-001 — Every `reference_details` key name is wrong **[R]** · HIGH

`src/lib/gspPayload.ts:337-355`, against `docs/gsp-einvoice-api-reference.md:472-496`

| Documented key | Code emits |
|---|---|
| `invoice_period_start_date` / `invoice_period_end_date` | `invoice_start_date` / `invoice_end_date` |
| `reference_of_original_invoice` / `preceding_invoice_date` | `invoice_number` / `invoice_date` |
| `receipt_advice_number` / `receipt_advice_date` / `contract_reference_number` | `advice_reference` / `advice_date` / `tender_reference` |

`reference_details` is emitted unconditionally, so every request carries unknown keys.

### PAY-002 — `export_details` is always structurally invalid **[R]** · HIGH

`src/lib/gspPayload.ts:311-317`

`country_code` is mandatory (doc L251, example value `"IN"` at L454) but hardcoded to
`null`. `foreign_currency` is a currency code string; line 314 is the dead expression
`nic.ValDtls.TotInvValFc ? null : null`, which evaluates to `null` on both branches.

Every SEZ / export invoice produces a request the GSP rejects.

### PAY-003 — `invoice_remarks` violates the field contract **[R]** · HIGH

`src/lib/invoiceJson.ts:849`, `gspPayload.ts:336`

Doc L275 specifies `String(3-100)`, pattern `[0-9|A-Z|a-z|/|-]{0,100}`. The code builds
`` `PO No: ${poNo} Dt: ${poDt}` `` — spaces and colons — or up to 200 characters of free
text. Any invoice with notes or a PO reference fails validation on a field operators
rarely inspect.

### PAY-004 — Doc-number sanitisation collides and can produce invalid numbers **[V]** · HIGH

`src/lib/invoiceJson.ts:510-522`

```ts
let sanitized = s.replace(/\//g, "-");
if (sanitized.length > 16) {
  sanitized = sanitized.slice(-16);   // keeps the suffix
}
```

Left truncation destroys uniqueness. Verified collision:

```
PHS/INV/2026-27/0001 → INV-2026-27-0001
PQS/INV/2026-27/0001 → INV-2026-27-0001
```

A 19-character sibling truncates to `-INV-26-27-10008`, which begins with `-`. The portal
rejects document numbers starting with `0`, `/` or `-` (doc §13.1 #8).

Worse: `resolveOutcome` (`gsp.functions.ts:313-335`) looks the document up by this number.
On a collision it can fetch another invoice's IRN and write it onto this row. That is the
exact hazard the module exists to prevent.

**Fix:** generate a NIC-safe `DocDtls.No` at numbering time (≤16 chars, no leading `0`, `/`
or `-`) and persist it. Stop mutating the number at build time.

### PAY-005 — `TotInvVal` is rounded, breaking the valuation identity **[V]** · HIGH

`src/lib/invoiceJson.ts:815`

```ts
const totInvValRaw = invoice.total != null ? Number(invoice.total) : sumTot + rndOffAmt;
const totInvVal = Math.round(totInvValRaw);
```

Reproduced: `total = 1000.50`, tax + assessable = `1000.40`, so `RndOffAmt = 0.10` and
`TotInvVal = 1001`. Now `AssVal + tax + RndOffAmt = 1000.50 ≠ 1001`, and `payDue` at
line 831 is computed from the rounded figure, so it drifts by ₹0.50.

This contradicts the module's own rule at lines 12-16 (never re-derive or round stored
totals). The `gspPayload` test that pins mirroring hand-builds the NIC JSON, so it never
reaches this line.

**Fix:** `const totInvVal = r2(totInvValRaw)`.

### PAY-006 — B2C is built and forwarded, but this API forbids it **[R]** · HIGH

`src/lib/invoiceJson.ts:613, 688, 732, 969`

Doc §13.1 #7: "B2C invoices must not be requested through this API." Doc L207/L234 allow
the pattern `([0-9]{2}[0-9|A-Z]{13}) | PRO` for `buyer_details.gstin`. The builder
substitutes `"URP"` for a missing or unregistered buyer, and `gspPayload` forwards it.

The only guard is `computeEInvoiceRequired` in the UI, so any direct, bulk, or alternate
call path emits an invalid `supply_type`.

**Fix:** throw in `buildGstInvoiceJson` when `supTyp === "B2C"`. Confirm `PRO` vs `URP`
with the vendor **[?]**.

### PAY-007 — `||` where `??` is required swallows legitimate zeroes **[R]** · MEDIUM

`src/lib/invoiceJson.ts:754, 763`

```ts
r2(Number(it.taxable_value) || r2(gross - discountAmt))
```

A 100%-discount or nil-rated line with `taxable_value = 0` yields the gross value. The
same pattern affects `line_total` at line 763.

**Fix:** `it.taxable_value != null ? r2(it.taxable_value) : r2(gross - discountAmt)`.

### PAY-008 — E-way consignment value can be under-declared **[R]** · MEDIUM

`src/lib/invoiceJson.ts:1001`

```ts
r2(Number(invoice.total) || 0) || r2(Number(invoice.taxable_value) || 0)
```

When `total` is absent or zero the value falls back to the tax-exclusive taxable value.
A ₹55,000 consignment declares ₹50,000, which can drop below the e-way threshold, and no
bill is raised for goods that legally need one.

### PAY-009 — State code map caps at 38, erasing export codes **[R]** · MEDIUM

`src/lib/invoiceJson.ts:247-252`, used at lines 955 and 999

`stateCodeToInt("96")` returns `null`. Doc §13.1 #21 mandates state code 96 for direct
export, #22 uses 97 for other territory. Those transactions ship
`fromStateCode: null`.

### PAY-010 — `place_of_supply` can be null though it is mandatory **[R]** · MEDIUM

`src/lib/invoiceJson.ts:621, 740`

Doc L206 specifies `place_of_supply` as `String(1-2)`, required. For a URP buyer with no
GSTIN and no POS on the invoice, the value resolves to null.

### PAY-011 — Ack dates parse in server-local time, then store as UTC **[R]** · MEDIUM

`src/lib/invoiceJson.ts:1112-1149`

All three accepted shapes (`YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MM-YYYY`) build
`new Date("YYYY-MM-DDT00:00:00")` with no zone specifier before `.toISOString()`. On an
IST host, `"14/09/2023 10:00:00"` stores as `…04:30:00Z`.

`gspEwb.ts:129-137` measures the 24-hour cancel window from that value, so the window
opens 5.5 hours early and shuts 5.5 hours early. That is the boundary the whole
cancellation feature hinges on.

**Fix:** parse explicitly as UTC. Ack times are portal-side.

### PAY-012 — E-way validity hardcoded to +1 day **[R]** · MEDIUM

`src/lib/invoiceJson.ts:1259` vs `:1286-1291`

The comment says validity may be derived as `ewbDate + ceil(distance/100)` days. The code
applies a hardcoded `+1`. A 400 km consignment gets 1 day of validity instead of 4, and
the vehicle is stopped en route. The value is then stored on the invoice as fact.

### PAY-013 — SEZ supply type chosen without checking the recipient **[R]** · MEDIUM

`src/lib/invoiceJson.ts:278-282, 862-864`

`SEZWP` / `SEZWOP` are returned with no check that the recipient is an SEZ Unit or
Developer (doc §13.1 #17), so a domestic customer on a `sez_*` invoice produces an invalid
`supply_type`. Separately, the hard LUT guard fires only for `sez_zero_rated`; the more
common `export_zero_rated` path gets no LUT check at all.

### PAY-014 — ₹50,000 boundary is inclusive, and the code contradicts the docs **[R]** · MEDIUM

`src/lib/transport.ts:141-155` returns `t >= 50000` with a comment asserting the threshold
is inclusive and warning against changing it to `>`. Rule 138 says "exceeds fifty thousand
rupees", and `docs/GSP_INTEGRATION_AND_TALLY_EXPORT.md:678` says "mandatory above ₹50,000".

An invoice of exactly ₹50,000 currently gets an e-way bill it does not need.

**Fix:** confirm the portal's comparator in sandbox, then make code, comment and docs agree.

### PAY-015 — `isValidBase64` rejects base64url QR payloads **[R]** · LOW

`src/lib/invoiceJson.ts:183-204`

Accepts padded standard base64 only. The doc calls the payload a "base64 JWT" (L615), so
a base64url or `data:`-prefixed value would be rejected on paste-back.

### PAY-016 — Miscellaneous low-severity serialization **[R]** · LOW

| Location | Issue |
|---|---|
| `invoiceJson.ts:764` | `hsn_code` defaults to `"0000"`, a mandatory field that must be valid per the GST master |
| `invoiceJson.ts:767` | `unit` is free text, upper-cased, not a UQC enum value |
| `invoiceJson.ts:811` | `RndOffAmt` is an uncapped plug (documented prose limit ±99.99) |
| `invoiceJson.ts:1014` | E-way `itemList` is silently empty when items are omitted; portal requires ≥1 |
| `invoiceJson.ts:1016` | E-way `hsnCode` strips non-digits, so `12A34` becomes `1234` |
| `invoiceJson.ts:1020` | E-way CGST/SGST/IGST rates are re-derived and can contradict stored amounts |
| `invoiceJson.ts:1009` | E-way `transDistance` emits `"0"` where `gspEwb.ts:22` demands a positive value |
| `invoiceJson.ts` | Item-count ceilings (1000 e-invoice, 250 e-way) are not enforced anywhere |
| `gspEwb.ts:58-59` | The frozen fallback sets `vehicle_no` on a Part-A slip; with `transporterId` the doc requires `transDocNo` / `transMode` / `vehicleNo` to be blank (L1591) |
| `gspEwb.ts:136, 154` | A future-dated `ack_date` yields negative elapsed time, so the invoice reads "cancellable" with >24 h remaining |

---

## Phase 2 — Persistence and database integrity

### DB-001 — `redact()` does not recurse, so signed artefacts reach the log **[R]** · HIGH

`src/lib/gsp.functions.ts:73-82`

```ts
function redact(body: unknown): unknown {
  const clone = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  for (const key of Object.keys(clone)) {          // top level only
    if (/^(signedinvoice|signedqrcode|qrcodeurl|token|password)$/i.test(key)) {
      clone[key] = "[redacted]";
    }
  }
  return clone;
}
```

The GSP envelope is nested: `SignedQRCode` and `SignedInvoice` live at
`results.message.SignedQRCode`. `logCall` receives the whole envelope (line 285). The regex
never sees a nested key, so the signed QR payload is written verbatim into
`gsp_api_log.response_body`.

Migration `20260929000001_gsp_integration.sql:83` states the QR payload "belongs on
`invoices.qr_payload` only."

Reproduced: `redact({results:{message:{SignedQRCode:'JWT-PAYLOAD-HERE'}}})` returned the
secret intact.

**Fix:** recurse with a depth cap, matching keys case-insensitively at every level, and
walk arrays.

### DB-002 — Deleting an invoice erases its statutory audit trail **[R]** · MEDIUM

`supabase/migrations/20260929000001_gsp_integration.sql:65`

```sql
invoice_id uuid references public.invoices(id) on delete cascade
```

The table comment at line 61 calls this "the audit trail for statutory documents: who
asked for this IRN, when, and what did the GSP say?" Deleting or purging an invoice
silently destroys the corresponding GSP call log.

**Fix:** `on delete set null`, matching the `created_by` treatment on line 78.

### DB-003 — The anti-fabrication CHECK does not prevent fabrication **[R]** · MEDIUM

`supabase/migrations/20260929000002_invoice_compliance_cleanup.sql:78-80`

```sql
check (irn is null or lower(irn) <> repeat(lower(substr(irn,1,8)),8))
```

This rejects only the retired `mockIrnPayload()` shape. Any other fabricated value
passes, including one from `mockHashHex`, which `mockHash.ts:22-27` says is
non-repeating by design.

The invariant the app already enforces client-side, `irn ~ '^[0-9a-f]{64}$'`, has no
table-level CHECK anywhere in the migrations.

**Fix:** add the 64-hex CHECK alongside the existing one. The repeated-block CHECK becomes
redundant but harmless.

### DB-004 — `resolveOutcome` reports success for a write that failed **[R]** · HIGH

`src/lib/gsp.functions.ts:321-338`

The `update` call discards its `error` and the whole body sits inside
`catch { return null }`. Supabase-js resolves rather than throws on a failed write, so a
PostgREST error is invisible. The function then returns
`{ ok: true, alreadyGenerated: true, irn }` and `logCall` writes `ok: true` (line 326)
into the statutory audit trail for an operation the database never performed.

### DB-005 — Recovery path never writes `ack_date`, permanently disabling cancellation **[R]** · HIGH

`src/lib/gsp.functions.ts:322-325`

`resolveOutcome` updates only `irn`, `einvoice_status`, `einvoice_error`.
`cancelGspIrn` gates on `isWithinIrnCancelWindow(invoice.ack_date)` (line 416), and a null
ack date returns false (`gspEwb.ts:129-137`).

An invoice recovered from a timeout holds an IRN that can never be cancelled through the
app, even inside the 24-hour window. The statutory remedy requires a manual credit note.
The UI compounds this by printing "24-hour cancellation window closed" when in fact the
window has just opened.

**Fix:** persist `ack_no` and `ack_date` from the by-doc response during recovery.

### DB-006 — E-way writes are non-atomic and error-blind **[R]** · MEDIUM

`src/lib/gsp.functions.ts:491-515`

Neither the `invoices` update (491) nor the `eway_bills` insert (501) checks `error`, and
they are two round-trips with no transaction. A partial failure leaves `ewaybill_no` set
with no `eway_bills` row. `eway_bills` has no unique index on `invoice_id`, so a
double-click that slips past the line-462 guard inserts two rows for one invoice.

**Fix:** one RPC for both writes, check errors, add `unique (invoice_id)`.

### DB-007 — Cancel writes are non-transactional and ignore both errors **[R]** · MEDIUM

`src/lib/gsp.functions.ts:430-434`

If the invoice update fails while the `eway_bills` update succeeds, the e-way bill reads
`cancelled` while the invoice still reads `generated`. If both fail, the invoice remains
`generated` forever against a cancelled IRN at the GSP.

### DB-008 — `gsp_settings` is readable by any authenticated user **[R]** · MEDIUM

`supabase/migrations/20260929000001_gsp_integration.sql:51-52, 95`

```sql
create policy "view gsp_settings" on public.gsp_settings
  for select to authenticated using (true);
```

Line 100 revokes `gsp_api_log` from `anon` and `authenticated`, but the equivalent revoke
for `gsp_settings` is absent, and no `alter default privileges` exists anywhere in the
migrations directory.

The values are non-secret by design, but the policy comment claims "Non-secret", not
"public". Any signed-in user can enumerate the company GSTIN regardless of role.

**Fix:** `revoke all on public.gsp_settings from anon;` and scope the select policy to
users with sales access.

### DB-009 — `getGspRuntimeInfo` has no module permission check **[R]** · MEDIUM

`src/lib/gsp.functions.ts:590-600`

Every other exported server function calls `assertModulePermission`. This one has only
`requireActiveUser`, so any active account learns the GSP mode and vendor host. Low-value
data, but it contradicts the file's own documented invariant (lines 10-14).

### DB-010 — Invoice reads have no branch or tenant scoping **[R]** · LOW

`src/lib/gsp.functions.ts:123-192`

All access goes through `getAdmin()` (service role, RLS bypassed) and `loadInvoiceBundle`
filters on `id` only. A user with `sales · edit` can pass any invoice uuid, including one
from another branch, to `generateGspIrn`.

**Fix:** scope the read to permitted branches before minting, or record single-tenant
design in the ADR.

### DB-011 — `recordFailure` drops its update error **[R]** · MEDIUM

`src/lib/gsp.functions.ts:358`

`bundle.raw.id` is an unchecked cast of `unknown`, and the surrounding try/catch cannot
catch a PostgREST error because supabase-js resolves with `{ error }`. A failed
failure-record is invisible.

---

## Phase 3 — Transport and error handling

### CLI-001 — Token-auth failure escapes unwrapped, hiding the outcome **[R]** · HIGH

`src/lib/gspClient.ts:369`

```ts
async function once(...) {
  const token = await authHeader();   // outside the try, which opens at 372
```

Any token-auth failure escapes `once` unwrapped, so it never becomes a
`GspTimeoutError` and carries no `endpoint`. In `call` (445-457) a raw `SyntaxError` or
`TypeError` matches neither the 401 nor the `isBusiness` branch, so for a non-idempotent
write line 457 rethrows it raw. The caller loses `isOutcomeUnknown` and cannot tell
whether an IRN was minted.

Compounded by `gspClient.ts:345`: `res.json()` on the token response has no try/catch,
unlike the data path at 393-400.

**Fix:** move `authHeader()` inside the try and wrap its `res.json()`.

### CLI-002 — An empty 200 body is treated as success, and cancel trusts it **[R]** · HIGH

`src/lib/gspClient.ts:213`

```ts
if (envelope && Object.keys(envelope).length === 0) return null;   // "success"
```

`generateGspIrn` and `generateGspEwb` guard against this (lines 252, 486).
**`cancelGspIrn` does not.** It calls `transport.cancelIrn()` and unconditionally writes
`einvoice_status = "cancelled"` (lines 426-435).

A 200 `{}` from a proxy or WAF cancels the invoice in the ERP while the IRN stays ACTIVE
at the NIC.

**Fix:** remove the early return, and validate `message.CancelDate` in `cancelGspIrn`.

### CLI-003 — Token-auth has no timeout; one hung request kills the integration **[R]** · HIGH

`src/lib/gspClient.ts:340`

No `AbortController`, no timer. A hung TCP connection leaves `inflightToken` pending
forever. Because it is module scope, every later request awaits the same never-settling
promise. The whole integration dies with no error, no log, no recovery.

`timeoutMs` is applied only to the data call at line 371.

**Fix:** give token-auth its own controller and timer, cleared in `finally`.

### CLI-004 — The timeout clock starts after auth resolves **[R]** · MEDIUM

`src/lib/gspClient.ts:369-371`

The real deadline is `tokenAuthTime + timeoutMs`, unbounded, on every call.

### CLI-005 — Token cache is an unkeyed module singleton **[R]** · MEDIUM

`src/lib/gspClient.ts:288-289`

Correct only because ADR-0003 D-1 pins config to a single env-level `GSP_USER_GSTIN`.
Two live problems today: `inflightToken` is module scope but `authHeader` closes over
*this* transport's `config` (line 340), so two transport instances share one in-flight auth
and the loser gets the wrong `baseUrl`. And `resetGspTokenCache()` on 401 (line 385) is
global: with N requests on token T, a late 401 wipes the fresh token and nulls the
in-flight promise.

**Fix:** move both into the `createHttpTransport` closure, or key by
`` `${config.baseUrl}|${config.username}` ``. Reset only when the failing token is the
cached one.

### CLI-006 — `parseGspErrorCode` over-captures **[R]** · MEDIUM

`src/lib/gspClient.ts:190-191`

The "loose" fallback contradicts its own docstring at line 185 ("Returns null when there is
no leading integer") and misparses `"2 documents could not be processed"` as code `2`.
Every real code is `"<code>: <text>"`, which line 188 already matches.

`GspError.code` is rendered to operators in the probe UI (`gsp.functions.ts:666-669`),
where a bogus code sends them after the wrong fault.

**Fix:** delete the loose branch.

### CLI-007 — `baseUrl` is never validated **[R]** · LOW

`src/lib/gspClient.ts:71-91`

Trailing slashes are normalised, but there is no `new URL()` parse and no scheme check.
A typo'd host without a scheme throws `TypeError: Failed to parse URL`, which line 417
reports as `GspTimeoutError` "outcome unknown" — a misleading signal for a config bug.

ADR D-4 makes the probe the designated guard for exactly this drift.

### CLI-008 — Mock models the missing-EWB signal wrongly **[R]** · MEDIUM

`src/lib/gspMock.ts:184`

```ts
const known = /^f{64}$/.test(q.irn);
EwbNo: known ? null : deriveEwbNo(q.irn)
```

Three problems. It re-creates the exact repeated-`f` fabrication the module header (lines
7-15) says reached production, only inverted. It is unreachable, because `mockHashHex`
never produces 64 f's, so the null branch never fires. And the real API signals a missing
EWB as a **business failure** — `errorMessage: "2148: Requested IRN data is not available"`,
`status: "Failed"` (`docs/gsp-einvoice-api-reference.md:838`) — never a 200 with a null
field. The mock trains callers against a signal the vendor does not send.

### CLI-009 — Mock by-doc lookup fabricates an IRN when `document_date` is omitted **[R]** · MEDIUM

`src/lib/gspMock.ts:172`

`generateIrn` derives the IRN from the real `doc.document_date` (line 151), but
`getEinvoiceByDoc` falls back to `"01/09/2026"` when the field is missing, returning a
different IRN.

`document_date` is optional in `ByDocQuery` (`gspClient.ts:256`) but load-bearing for
determinism. Currently latent because the only production caller passes it
(`gsp.functions.ts:300-301`) — but that is exactly the recovery path used after a timed-out
generate, where a false "not found" invites a duplicate IRN.

**Fix:** make `document_date` required in `ByDocQuery`.

### CLI-010 — Mock digit derivation aliases on rare inputs **[R]** · LOW

`src/lib/gspMock.ts:66, 73`

`padEnd` after `replace(/\D/g, "")` pads with a constant. When it fires, distinct IRNs
collapse onto `777777777777777` / `333333333333`. Rare (a 64-char hex averages ~40 digits)
but real.

### CLI-011 — Mock writes null into string-typed fields **[R]** · LOW

`src/lib/gspMock.ts:188-189`

`EwbDt: null` and `EwbValidTill: null` violate `GspMessage`'s `EwbDt?: string`. It
type-checks only because `okEnvelope` takes `Record<string, unknown>`. Contained today by
an earlier throw on the missing `EwbNo`.

---

## Phase 4 — UI route

File: `src/routes/_app/sales.invoices.$id.tsx` unless noted.

### UI-001 — Per-invoice state is never reset when `id` changes **[R]** · HIGH

Lines 122, 129, 139, 194. The `[id]` effect only calls `load()`. The route component is
not remounted on param change, so `gstinResult` (the **previous customer's** verified
trade and legal name renders under the new buyer's GSTIN, lines 1455-1475), `ewayForm`
(the previous invoice's transporter, vehicle and distance is submitted to the GSP for the
new invoice, lines 381-383), `statusNote` and `cancelReason` all carry over.

### UI-002 — The persisted `e_invoice_required` column is never read **[R]** · HIGH

`src/lib/einvoice.ts:171-177`, `src/routes/_app/sales.invoices.new.tsx:708`

`getInvoiceCompletionStatus` short-circuits on `transport.e_invoice_reqd`. If it is `"N"`
— which is `DEFAULT_TRANSPORT.e_invoice_reqd` (`src/lib/transport.ts:85`) — the
`computeEInvoiceRequired` checksum gate at line 176 is never reached. But `new.tsx:708`
persists the column with the *opposite* precedence. Two sources of truth, inverted
precedence, and the authoritative column is dead weight.

Any invoice whose `transport_details` still carries the default `"N"` (pre-sync rows,
conversions, imports) reports `e_invoice_required: false`, which yields a green COMPLETE
chip and `is_provisional: false`, and `InvoicePrintModal.tsx:99-102` then hands the user
Original, Duplicate and Triplicate of a tax invoice that legally requires an IRN, printed
with no PROVISIONAL watermark.

### UI-003 — Every GSP action unmounts the whole page, including open dialogs **[R]** · MEDIUM

Line 905. `load()` sets `loading = true` and the render guard returns `<PageLoader />`
before any dialog renders. `generateIrn`, `generateEway`, `handleCancelIrn`,
`handlePasteIrn` and `handlePasteEwb` all `await load()`, so each causes a full-page
flash, a scroll reset, and a Radix focus-loss unmount of an open AlertDialog or Dialog
mid-action.

### UI-004 — Paste-back buttons have no busy state **[R]** · MEDIUM

Lines 1654, 1684. `handlePasteIrn` (534) and `handlePasteEwb` (619) never set a busy flag
and the dialog buttons are unconditional. Double-click fires two concurrent `.update()`
calls against `irn`, `ack_date` and `portal_response` on a statutory document.

### UI-005 — Three writers fight over the single `portal_response` column **[R]** · MEDIUM

Lines 574, 606, 656, 671, 737. `handleGenerateGstJson` sets it, `handleGenerateEwayJson`
overwrites it with `{ eway_json }`, then the paste handlers overwrite it again. Generating
a GST JSON and then an E-Way JSON destroys the IRN's `raw_pasted` evidence.

### UI-006 — The e-Way button and the compliance badge use different rules **[R]** · MEDIUM

Line 989 versus `einvoice.ts:181-182`. The button shows on `inv.total >= 50000` alone; the
badge honours `transport_details.e_way_reqd === "N"`, which overrides the threshold. On a
₹60,000 invoice with an explicit `"N"` the panel reads "e-Way required: N / COMPLETE"
while an enabled button invites generating a bill the panel says is not required.

### UI-007 — The "legacy mock" e-Way form contradicts its own helper text **[R]** · MEDIUM

Lines 120, 1066, 1331, 371. Line 120 labels it "legacy mock" but `generateEway` calls the
real `generateGspEwb`. The card promises "Leave a field blank to fall back to this
invoice's saved transport details", yet `distance_km` initialises to `0` and
`generateEway` rejects `0` at line 371. The user retypes a distance that is already stored
in `transport.distance_km` and displayed read-only 60 lines below. The retyped value
silently overrides the saved one.

### UI-008 — Four GSP actions render without their required permission **[R]** · MEDIUM

Lines 1114, 1000, 1440, 1614. The e-Way Generate button, "Check GSP status", "Test GSP
connection" and "Verify GSTIN" are plain `Button`s. Their handlers all call
`assertModulePermission` server-side (three require `sales · edit`, one `sales · read`), so
a read-only user gets an enabled control that always fails with a raw permission toast.
Only `generateIrn` (975) and Cancel IRN (1017) use `PermButton`.

### UI-009 — Six statutory writes bypass the server-function permission middleware **[R]** · MEDIUM

Lines 261, 574, 603, 656, 671, 737. `issueIfDraft`, `handlePasteIrn`,
`handleGenerateEwayJson`, `handlePasteEwb`, `cancelInvoice` and `handlePrintAudit` write
straight to Supabase with the anon-key client, so authorisation rests entirely on RLS with
no `assertModulePermission` equivalent. The paste path can lock an invoice
(`einvoice_status: "generated"`) with only `sales · read`.

### UI-010 — Read-modify-write race on `print_count` **[R]** · MEDIUM

Lines 734, 774-783. `nextCount` derives from the `inv` captured in the render closure, then
is written and re-applied via `setInv`. Two prints in one session both read
`print_count = 0`, both write `1`, both `setInv(1)`. The header under-counts while
`invoice_print_log` holds two rows. The log insert also happens before the invoice update,
so a failed update leaves a "printed" audit row.

### UI-011 — Cancel Invoice is a single unconfirmed destructive click **[R]** · MEDIUM

Lines 1606, 1614. Cancel IRN gets a full AlertDialog (1125). Cancelling the invoice itself,
which cascades `so_conversions` (681-691), is one click on a `variant="destructive"`
button with no confirmation and no permission gate. The `<Label className="text-xs">` at
1606 has no `htmlFor` and the `Textarea` no `id`.

### UI-012 — Cancel-window banner never re-evaluates **[R]** · LOW

`src/lib/gspEwb.ts:147` documents `irnCancelWindowRemainingMs` as something the UI uses to
phrase "23h left". Its only callers are tests. The route prints a static "window closed"
string at 1051-1058, and `irnCancellable` (line 256) is evaluated once per render with no
timer, so a page left open across the 24-hour boundary keeps showing an enabled Cancel IRN
button. The server rejects it correctly at `gsp.functions.ts:416`.

### UI-013 — `InvoicePrintPreview.tsx` is a dead duplicate with divergent props **[R]** · LOW

`src/components/invoice/InvoicePrintPreview.tsx`, zero importers. It reads
`it.cgst_amount`, `it.sgst_amount`, `it.igst_amount`, `it.amount` and `it.gst_percent`
(lines 204-207, 452, 480). None exist on the real `InvoiceItemRow`, which has `cgst`,
`sgst`, `igst`, `taxable_value` and `gst_rate` (`src/lib/sales.ts`). Every figure would
render as `0.00`.

**Fix:** delete it.

---

## Phase 5 — Test coverage

### TST-001 — No test asserts any endpoint path but token-auth **[R]** · HIGH

This is why GSP-001 survived. `gspConnection.test.ts:124` asserts only the token URL. The
cancel, gen-ewb-by-irn, get-einvoice-details, get-ewb-details-by-irn and get-gstin-details
paths are asserted nowhere, and the deliberate `gstin=` versus `user_gstin=` query
difference is unpinned. All 88 tests pass with every endpoint path wrong.

### TST-002 — `resolveOutcome` has zero tests **[R]** · HIGH

`gsp.functions.ts:236-245, 302-339`. The duplicate-IRN recovery path is the
highest-consequence function in the module and is untested.

### TST-003 — Permission gates have zero tests **[R]** · HIGH

`gsp.functions.ts:202, 400, 445`. No test file references `assertModulePermission`. Deleting
a gate breaks nothing.

### TST-004 — `gsp.integration.test.ts` performs no integration **[R]** · MEDIUM

It is `createMockTransport()` plus pure functions. The name implies sandbox coverage that
does not exist. Rename to `gsp.mockPipeline.test.ts`, or add a separately gated live test.

### TST-005 — The compliance test discards its own GSP output **[R]** · MEDIUM

`gsp.integration.test.ts:208-241` builds `nic` and `request` at lines 211-218, then
discards both. Assertions run on hand-written `"a".repeat(64)` and `"123456789012"`. The
only use of the GSP response is `expect(request).toBeTruthy()`.

### TST-006 — The invoice-to-`EwbDtls` chain is never exercised **[R]** · MEDIUM

`gsp.integration.test.ts:126` sets `generate_eway_within_einvoice: false`, so `EwbDtls` is
null (`invoiceJson.ts:889`). `gspPayload.test.ts:265` covers the field only via a
hand-built NIC.

### TST-007 — A test asserts the opposite of its name **[R]** · MEDIUM

`gspEwb.test.ts:100-106` is titled "rejects a blank transporter id once provided" but
asserts `parsed.success === true`. The rejection it claims to pin does not exist:
`gspEwb.ts:23-25` are `.optional()` with no `.min(1)`, so whitespace-only IDs pass.

### TST-008 — One test has zero assertions and pins known-bad behaviour **[R]** · MEDIUM

`invoiceJsonFix.test.ts:150-154` is `console.log` only. Lines 144-148 pin as expected a
garbage address (`WDWFEFWGRG`) reaching the e-way bill without customer fallback.

### TST-009 — Dead exports and untested helpers **[R]** · LOW

`einvoice.ts:52-55, 78, 80, 82, 86` — `parseGstPortalIRNResponse`, `parseEWayResponse`,
`getSupTyp`, `getSupTypForSalesType`, `isEInvoiceRequired`, `isEWayRequired`,
`isEInvoiceRequiredBool`, `computeEInvoiceRequiredAlias` — have zero consumers. Only
`computeEWayRequiredYN` is used (`sales.invoices.new.tsx`).

Also untested: `parseGstPortalIrnResponse` and `parseEwayResponse`, the real
`setTimeout → abort` path (`gspClient.ts:371`), and duplicated inline regexes at
`gsp.functions.ts:252, 486` that re-implement `IRN_REGEX` / `EWB_REGEX`.

All re-exported names in `einvoice.ts` do exist. No missing-module imports were found. No
TODO, FIXME or placeholder remains in the module.

### Recommended test additions

1. `resolveOutcome` recovery — generate throws `GspTimeoutError`, by-doc returns an IRN,
   assert the row updates with `alreadyGenerated: true`, and that a mismatched IRN leaves
   the row untouched.
2. Endpoint URL contract — stub `fetchImpl`, assert the exact path and query string for all
   eight endpoints, pinning the `gstin=` versus `user_gstin=` quirk, plus a
   401-then-success sequence on a non-idempotent call.
3. Permission-denial matrix — each of the seven server functions throws when
   `assertModulePermission` rejects; reads accept `sales · read`, writes demand `edit`.
4. Multi-item rounding reconciliation — three items with fractional paise, assert
   `AssVal + CgstVal + IgstVal + RndOffAmt === TotInvVal` and that `RndOffAmt` applies
   once.
5. `sanitizeDocNoForNic` collision guard — two invoice numbers sharing their last 16
   characters must produce distinct document numbers. Fails today.

---

## Runtime unknowns

None of these can be settled from the repository.

| # | Question | How to resolve |
|---|---|---|
| 1 | Is `gspMock.ts` in the client bundle? Determines whether GSP-006 is a live crash | `pnpm build && grep -rlE "NIC Sandbox\|mock-token-auth\|Buffer.from" dist/ .output/` |
| 2 | `URP` or `PRO`? Doc L207 says `PRO`, §13.1 #21 says `URP` | One sandbox B2C-less export call |
| 3 | Is a `version` field required? §13.1 #2 says `'1.1'`; the code sends none | First sandbox generate-IRN |
| 4 | Is the ₹50,000 comparator `>` or `>=`? | Invoice of exactly ₹50,000 in sandbox |
| 5 | Can `anon` actually reach `create_invoice_with_items`? | `has_function_privilege(...)` |
| 6 | Does the GSP drop or 400 on the `reference_details` key mismatch? | One request with a deliberately wrong nested key |
| 7 | Does `ack_date` round-trip through `normalizeAckDateToISO`, and does the tz bug bite in production? | Compare `invoices.einvoice_ack_date` against IRN generation time |
| 8 | Which migrations are actually applied to the live database? | `select * from v_invoices_compliance limit 1` |
| 9 | Does `assert_no_edit_after_irn` permit the IRN-setting UPDATE itself? | Live test |
| 10 | Is the cancelled state reachable, given `assert_items_frozen_after_irn` keys on `par_status`? | Live test |

---

## Outstanding from the credential review

Carried forward, still open:

- **G10** — a real-looking sample username and password are committed in plaintext in
  `docs/gsp-einvoice-api-reference.md` (lines ~41-42, 48-49) and
  `docs/gsp-ewb-api-reference.md` (lines ~76, 83-84, 122), contradicting the ADR blocker
  and both runbooks. Scrub, then have the vendor confirm rotation.
- **G1** — no production host appears in either API document. Production cutover is
  blocked until Masters India supplies it.

---

## Fix plan

Phase 0 and Phase 1 gate every live call. Phase 2 and 3 harden. Phase 4 finishes.

| # | Task | Files | Depends on |
|---|---|---|---|
| 0.1 | Rebuild all endpoint paths and query strings from doc §15 | `gspClient.ts` | — |
| 0.2 | Add endpoint URL-contract tests (fails today) | new `gspClient.url.test.ts` | 0.1 |
| 0.3 | `revoke execute … from public, anon`; deny when `auth.uid()` is null unless `service_role` | `20260930000001` | — |
| 0.4 | Replace `Buffer`, guard `process.env`, delete dead `createTransportForMode` | `gspMock.ts` | — |
| 0.5 | Clear statutory fields on cancel; check both errors; log the call | `gsp.functions.ts` | — |
| 0.6 | Conditional IRN claim; zero-row means concurrent winner | `gsp.functions.ts` | — |
| 0.7 | Reconcile via `resolveOutcome` on write failure; always log | `gsp.functions.ts` | 0.6 |
| 1.1 | Fix `reference_details` keys; valid-or-omit `export_details`; `invoice_remarks` charset and ≤100 | `gspPayload.ts`, `invoiceJson.ts` | — |
| 1.2 | `r2(TotInvVal)`; `??` over `||`; e-way consignment requires `total`; state codes 96/97; non-null POS | `invoiceJson.ts` | — |
| 1.3 | Generate NIC-safe document number at numbering time | `invoiceJson.ts` | — |
| 1.4 | Throw on B2C; gate SEZ on recipient; LUT guard on export | `invoiceJson.ts` | — |
| 1.5 | Parse ack dates as UTC | `invoiceJson.ts` | — |
| 2.1 | Recursive, depth-capped `redact()` | `gsp.functions.ts` | — |
| 2.2 | FK `set null`; add `irn ~ '^[0-9a-f]{64}$'` CHECK; `unique(invoice_id)` on `eway_bills`; revoke `gsp_settings` from anon | new migration | — |
| 2.3 | Check update errors in `resolveOutcome` and `recordFailure`; persist `ack_no`/`ack_date` | `gsp.functions.ts` | 0.7 |
| 2.4 | Atomic e-way write RPC | `gsp.functions.ts` + migration | 2.2 |
| 2.5 | Permission gate on `getGspRuntimeInfo` | `gsp.functions.ts` | — |
| 3.1 | Wrap `authHeader()` in the try; token-auth timeout | `gspClient.ts` | — |
| 3.2 | Empty envelope is a failure; validate `CancelDate` | `gspClient.ts`, `gsp.functions.ts` | — |
| 3.3 | Key the token cache; reset only on matching token | `gspClient.ts` | — |
| 3.4 | Delete the loose branch in `parseGspErrorCode` | `gspClient.ts` | — |
| 3.5 | Mock: business-failure signal for missing EWB; require `document_date` | `gspMock.ts` | 0.1 |
| 4.1 | Reset per-invoice state on `id` change | `sales.invoices.$id.tsx` | — |
| 4.2 | Single source of truth for `e_invoice_required` | `einvoice.ts`, `sales.invoices.new.tsx` | — |
| 4.3 | Separate initial load from background refetch | `sales.invoices.$id.tsx` | — |
| 4.4 | `PermButton` on the four ungated controls | `sales.invoices.$id.tsx` | — |
| 4.5 | Move the six client statutory writes behind server functions | `sales.invoices.$id.tsx`, `gsp.functions.ts` | 2.5 |
| 4.6 | Busy guards on paste-back; confirm dialog on Cancel Invoice; e-way button from `completion.e_way_required`; fix e-way form prefill; atomic `print_count`; separate `portal_response` columns; delete dead `InvoicePrintPreview.tsx` | `sales.invoices.$id.tsx`, components | 4.1 |
| 5.1 | Add the five recommended test groups; rename `gsp.integration.test.ts` | `src/lib/__tests__/` | 0.2, 0.7 |
| 5.2 | Clear 192 ESLint errors, mostly `no-explicit-any` | `invoiceJson.ts`, route, `einvoice.ts` | — |
| 5.3 | Scrub G10 committed credentials; record vendor rotation | `docs/gsp-*-api-reference.md`, ADR 0003 | — |

No file conflicts between parallelisable tasks. The generated
`src/routeTree.gen.ts` is currently modified; regenerate it, never hand-edit.

---

## Definition of done

1. `npx tsc --noEmit` exits 0.
2. `npx eslint` on the module exits 0.
3. All tests green, **including** the new endpoint-contract, permission, recovery,
   rounding and collision tests.
4. `pnpm build` exits 0, and `grep -rlE "Buffer.from|NIC Sandbox|mock-token-auth" dist/ .output/`
   returns nothing.
5. Sandbox run B1 through B8 green: probe `ok`, `remoteMatches = true`,
   `irn_well_formed = t`, `is_complete = true`, every call `ok = true` in `gsp_api_log`,
   and no token, password or raw `SignedQRCode` in any log body.

---

## What this changes about the earlier readiness verdict

The previous assessment called the code feature-complete and "ready per the
documentation." **That was too generous**, and it was wrong in one specific way worth
naming: the endpoint paths do not match the documentation, and the test suite could not
have caught it because no test exercises an endpoint path other than token-auth.

The mock is genuinely well built. The architecture decisions are sound. What was missing
was verification of the parts that only a live call exercises, which is exactly what the
audit's Phase 0 restores before any credential is spent.