# GSP sandbox rehearsal

Three parts, in order. **Part A** proves the whole pipeline against the mock
and needs no credentials. **Part B** is the first real call, and only starts
after credentials and a vendor confirmation are in hand. **Part C** is the
onboarding request that unblocks Part B.

Nothing here has been executed by the agent that wrote this file. Every step
is written for a human to run, in order, and read the result.

Read `docs/runbooks/gsp-environment.md` first for the variable list and the
fail-closed startup behaviour, and `docs/adr/0003-gsp-mock-first.md` for why
the integration is mock-first and what D-1 … D-4 settled.

> **Never write a real credential into any file in this repository.** The
> sample username and password printed in the Masters India spec
> (`data/gsp-pdfs/einvoice-api-spec.txt`, lines 8-12) are not to be copied
> into `.env` files that get committed, into this document, or into a ticket.
> Set the values in the server environment by hand.

---

## Part A — Mock rehearsal (no credentials needed)

Purpose: exercise every statutory path, prove that **creating an invoice
never contacts the GSP**, and leave a known-good baseline before a real
credential is ever configured.

Throughout Part A, `GSP_MODE=mock`. No other variable is required.

### A1 — Start the app in mock mode

1. Stop any running dev server.
2. Start it with mock mode explicit (no credentials needed):

   ```bash
   GSP_MODE=mock npm run dev
   ```

**Expected.** The server starts. No startup error about missing
`GSP_BASE_URL` / `GSP_USERNAME` / `GSP_PASSWORD` / `GSP_USER_GSTIN` — that
error is only raised for `sandbox` and `production`.

**If it fails.** A missing-credentials startup error in mock mode means
`GSP_MODE` is not `mock` in the process environment. Check for a stray
`GSP_MODE` in `.env` and for a shell variable left over from Part B.

### A2 — Confirm the mode badge

1. Open any invoice detail page (Sales → Invoices → pick one).
2. Read the badge in the header.

**Expected.** A purple badge reading `GSP: mock`. Hovering it repeats
"Dummy APIs — values here are NOT legally registered".

**If it fails.** Any other mode means the running process is not the one you
just started. Environment is read at startup and is not hot-reloaded, so
restart the process rather than reloading the page.

### A3 — Create a throwaway B2B draft invoice

1. Sales → Invoices → New.
2. Pick a customer that has a **buyer GSTIN**. `e_invoice_required` is
   computed from seller GSTIN **and** buyer GSTIN, so an invoice with no
   buyer GSTIN resolves to `N` and tests nothing. A B2C invoice is useless
   here.
3. Add one or two line items. Give the invoice a **total of at least
   ₹50,000** — the e-Way Bill button on the invoice page is only rendered
   when `total >= 50000`, and the rehearsal needs it.
4. Save as a **draft**. Do not issue it.

**Expected.** The invoice saves and its detail page opens, with an invoice
number assigned and no GSP activity of any kind.

**If it fails.** A GSTIN validation error means the buyer GSTIN failed its
checksum. Pick a different customer.

### A4 — Prove invoice creation never calls the GSP

This is the single most important step in Part A. Run it **before** touching
Generate IRN.

1. Note the invoice number from A3.
2. In the Supabase SQL editor, run:

   ```sql
   -- Expect 0. Invoice creation must not produce a single GSP call.
   select count(*) as gsp_calls_before from public.gsp_api_log;

   -- Expect the invoice, e_invoice_required = true, einvoice_status 'pending',
   -- irn null, is_complete false.
   select invoice_no, einvoice_status, e_invoice_required, e_way_required,
          irn, ewaybill_no, is_complete
     from public.v_invoices_compliance
    where invoice_no = '<the invoice number from A3>';
   ```

3. In the app, confirm the compliance badges read
   **`e-Invoice required: Y`** and a `PENDING` / "Pending e-Invoice" state.

**Expected.** `gsp_calls_before` is `0` (or unchanged from whatever it was
before this run), and the invoice row shows `e_invoice_required = true`,
`irn` null, `is_complete` false.

**If it fails.** Any non-zero count means something other than the explicit
GSP buttons is reaching the transport. That is a defect, not a
misconfiguration. Stop here and report it — do not continue Part A, because
every later result is now suspect.

> `gsp_api_log` has no `select` policy and is revoked from `anon` and
> `authenticated`. The Supabase SQL editor runs as the table owner, which is
> why these queries work there and not from the app.

### A5 — Generate the IRN

1. On the invoice detail page, click **Generate IRN**.
2. Wait for the result.

**Expected.** `einvoice_status` becomes `generated`; a 64-character hex IRN,
an `AckNo`, an `AckDate`, and the signed QR payload appear. The
`IRN Locked` badge appears, and financial fields become uneditable.

**If it fails.** The UI should show a `[<code>] <message>` string. Read the
message, then check `gsp_api_log` (see A6). A malformed IRN is rejected —
the mock is deterministic and correct, so a rejection here means the
document builder produced something the parser could not read.

### A6 — Check GSP status

1. Click **Check GSP status**.

**Expected.** The remote status agrees with what is stored: the IRN matches
what Generate IRN returned, and no mismatch is reported.

**If it fails.** `remoteMatches = false` means the stored IRN and the
GSP's own record disagree. In mock mode that is a mock/parser bug — the mock
derives its answer from the same document, so they cannot legitimately
diverge.

### A7 — Confirm the compliance view flips

1. Re-run the view query with the log query:

   ```sql
   -- Expect is_complete = true once IRN and EWB both exist, and the full
   -- call history of this invoice.
   select invoice_no, einvoice_status, e_invoice_required, e_way_required,
          irn, ewaybill_no, is_complete
     from public.v_invoices_compliance
    where invoice_no = '<invoice number>';

   select created_at, operation, endpoint, ok, http_status, gsp_code,
          error_message, duration_ms
     from public.gsp_api_log
    where invoice_id = (select id from public.invoices
                         where invoice_no = '<invoice number>')
    order by created_at desc;
   ```

2. Check the IRN is well-formed, not merely present:

   ```sql
   -- Expect t. The IRN is a 64-hex SHA-256 digest.
   select invoice_no,
          irn,
          (irn ~ '^[0-9a-f]{64}$') as irn_well_formed
     from public.invoices
    where invoice_no = '<invoice number>';
   ```

**Expected.** `gsp_api_log` now has rows (`generate_irn`,
`get_einvoice_by_doc`) — the count went from `0` at A4 to non-zero only now.
`irn_well_formed` is `t`. `is_complete` is still `false` at this point if the
invoice also needs an e-Way Bill (it does, at ≥ ₹50,000).

**If it fails.** `irn_well_formed = f` is a hard stop. The database
constraint `invoices_irn_not_repeated_block` rejects the retired mock's
output; a value that reaches the view in the wrong shape means the
constraint is not applied — re-apply
`supabase/migrations/20260929000002_invoice_compliance_cleanup.sql`.

### A8 — Generate the e-way bill

1. On the invoice detail page click **e-Way Bill** to open the GSP e-Way
   card. It is only present when the invoice has an IRN and
   `total >= 50000`.
2. Enter **Distance (km)** — it is the only required field. Transporter and
   vehicle are optional; leaving them blank falls back to the invoice's
   saved transport details.
3. Click **Generate**.

**Expected.** A 12-digit e-way bill number, an e-way bill date, and a
`valid till` timestamp. `eway_status` becomes `generated`. The compliance
card now reads `COMPLETE`.

**If it fails.** `distance_km` is required by the form, not by the GSP. A
business error code here is a real GSP-shaped failure and must appear in
`gsp_api_log` with `ok = false`.

### A9 — Re-run the compliance view

1. Re-run the A7 queries.

**Expected.** `is_complete = true`, `einvoice_status = 'generated'`,
`ewaybill_no` matching `^[0-9]{12}$`:

   ```sql
   -- Expect t.
   select invoice_no,
          (irn        ~ '^[0-9a-f]{64}$') as irn_well_formed,
          (ewaybill_no ~ '^[0-9]{12}$')   as ewb_well_formed
     from public.invoices
    where invoice_no = '<invoice number>';
   ```

**If it fails.** `is_complete` false with both documents present means the
view's inputs disagree with the header — re-read
`v_invoices_compliance` (migration `20260902000000_invoicing_staged.sql`)
and confirm the migration is applied.

### A10 — Negative path: inject a GSP business failure

1. Stop the dev server.
2. Restart with an injected failure so **every** call returns a real-shaped
   business-error envelope:

   ```bash
   GSP_MODE=mock GSP_MOCK_ERROR="3038: Pincode does not exist" npm run dev
   ```

3. Open a *different* throwaway invoice (create one the same way as A3) and
   click **Generate IRN**.

**Expected.** The UI surfaces the error as `[3038] Pincode does not exist` —
or the full string the mock returns. The attempt is recorded:

   ```sql
   -- Expect ok = false, gsp_code '3038', http_status set.
   select created_at, operation, endpoint, ok, http_status, gsp_code,
          error_message
     from public.gsp_api_log
    where invoice_id = (select id from public.invoices
                         where invoice_no = '<the second invoice>')
    order by created_at desc;
   ```

**If it fails.** No row with `ok = false` means the failure never reached the
log writer. An error shown in the UI with no log row points at the logging
path in `src/lib/gsp.functions.ts`, not at the GSP.

### A11 — Cancel the IRN

1. Restart the server **without** `GSP_MOCK_ERROR` (the cancel path must not
   be run against an injected failure).
2. On the first invoice from A3, click **Cancel IRN**, confirm the dialog,
   and submit. The reason code is limited to the one documented value.
3. Re-run the A7 queries.

**Expected.** `einvoice_status = 'cancelled'`, and the side table
`eway_bills.status` is set to `cancelled` as well. A
`cancel_irn` row appears in `gsp_api_log` with `ok = true`. The Cancel IRN
button is now gone from the page.

**If it fails.** An error naming the 24-hour window means
`isWithinIrnCancelWindow(ack_date)` returned false — see A12.

### A12 — Prove the 24-hour cancellation window blocks a stale `ack_date`

1. On the **second** invoice (the one from A10, which never got an IRN) or a
   freshly created one, generate an IRN with no injected error so it lands
   with a current `ack_date`.
2. **Manual step, human only.** Backdate its `ack_date` in the Supabase SQL
   editor by more than 24 hours. This is a write to a throwaway invoice and
   the agent must never run it:

   ```sql
   update public.invoices
      set ack_date = now() - interval '25 hours'
    where invoice_no = '<invoice number>';

   -- Confirm the backdate landed.
   select invoice_no, ack_date, now() - ack_date as age from public.invoices
    where invoice_no = '<invoice number>';
   ```

3. Reload the invoice detail page. The **Cancel IRN** button must be absent,
   and the page must show "24-hour cancellation window closed — raise a
   credit note instead."

**Expected.** No Cancel IRN button, that explanatory line, and the reason is
`isWithinIrnCancelWindow` (`src/lib/gspEwb.ts`, `IRN_CANCEL_WINDOW_MS` = 24h)
evaluated on the server-rendered `ack_date`.

**If it fails.** The button is present with a stale `ack_date` means the
compliance/completing loader is serving a cached row. The server-side guard
in `cancelGspIrn` also refuses such a request, so a click would still fail —
but a visible button that cannot work is a UI defect worth reporting.

4. Restore the invoice so the database is left clean:

   ```sql
   update public.invoices set ack_date = now() where invoice_no = '<invoice number>';
   ```

### A13 — Tally export: warnings and the balance gate

1. Reports → **Tally Export** tab. Set a date range that contains the
   throwaway invoices.
2. Click the export/run action.

**Expected.** The result summary reports a voucher count, and the warning
blocks appear as data dictates:

- **Ledgers not in the map** — tax ledgers named by convention (e.g.
  `CGST9`, `IGST18`) rather than read from your ledger map. This is
  informational, not an error.
- **Suspicious references** — a voucher whose IRN or e-way bill number is not
  a real statutory shape. Mock-mode values are flagged here rather than
  imported as real.
- **Stored vs recomputed totals** — a per-rupee disagreement between the
  stored header and the recomputed line items.

When there are no unbalanced vouchers, the summary reads **All vouchers
balance** and both **Download XML** and **Download CSV** are offered.

3. Force an unbalanced voucher to confirm the gate. The balance check
   withholds downloads **entirely** — not a warning:

   - Note the exact per-voucher figures the block prints when it fires:
     `sum` vs `expected` and the difference.
   - Confirm the two download buttons are **absent** from the card header
     while the block is showing.

**Expected.** With at least one unbalanced voucher: a destructive-toned
block naming the count, "failed the balance check — download withheld", the
list of offending voucher numbers with the delta, and no download buttons.

**If it fails.** Download buttons visible alongside the balance block mean
the gate in `TallySalesExport.tsx` (`blocked = result.unbalanced.length > 0`)
is not holding. That is a blocking bug: an unbalanced import corrupts the
books on the Tally side.

**Part A is done when:** the log was empty at A4 and non-empty at A7, the
injected error produced an `ok = false` row, cancel worked, the stale window
blocked, and the Tally gate withheld the download.

---

## Part B — Sandbox test (only after credentials arrive)

**Do not start Part B until every line in the Part B preconditions
checklist is ticked.** A sandbox call is a real HTTP call to a real vendor
system and can create a real document.

### Part B preconditions

- [ ] **Our own credentials**, issued to us by Masters India. Never the
      sample username/password printed in `data/gsp-pdfs/einvoice-api-spec.txt`
      (lines 8-12) — if those turn out to be live, they must be rotated
      (blocker G10), and the rotation confirmed in writing before use.
- [ ] **Vendor written confirmation that sandbox IRNs are not reported** to
      GSTN. Their proposal calls the sandbox a "test environment"; whether
      a sandbox IRN is legally non-reporting is **not documented anywhere**.
      Get this in writing, per environment, before generating anything.
- [ ] All three migrations applied:
      `20260929000001_gsp_integration.sql`,
      `20260929000002_invoice_compliance_cleanup.sql`,
      `20260930000001_create_invoice_with_items.sql`.
- [ ] `GSP_MODE=sandbox` and `GSP_BASE_URL`, `GSP_USERNAME`, `GSP_PASSWORD`,
      `GSP_USER_GSTIN` set in the server environment. Sandbox host is
      `https://sandb-api.mastersindia.co`; the production host is still
      unknown (blocker G1) and is not needed for this part.
- [ ] The process has been **restarted** after the variables were set —
      environment is read at startup, not hot-reloaded.
- [ ] The badge on an invoice page reads `GSP: sandbox`.
- [ ] A **test buyer GSTIN** is available for the B2B counterparty, and a
      throwaway invoice with `total >= 50000` is ready (or ready to be
      created).

### B1 — Run the connection probe first

1. Open the invoice page and use the **Test GSP connection** affordance. It
   performs **token-auth only** and creates nothing.
2. Read what it reports.

**Expected.** A success report naming the mode and a successful
authentication.

**If it fails.** Stop. Do not generate anything. A failing probe is a
configuration problem (host, credentials, or auth scheme) and it is
diagnosable in isolation — see the Triage table at the end of this document.

### B2 — Create a disposable B2B invoice

1. Sales → Invoices → New. Buyer with a GSTIN, total ≥ ₹50,000, save as
   draft. This invoice is going to be cancelled at the end of Part B; it is
   not a real sale.

**Expected.** The draft saves. Badge still reads `GSP: sandbox`, and the
`e-Invoice required: Y` badge is shown.

**If it fails.** The `Y` badge missing means the buyer GSTIN did not pass the
B2B gate, and the IRN will not be meaningful.

### B3 — Generate the IRN

1. Click **Generate IRN**.

**Expected.** A real `Irn`, `AckNo`, `AckDate` and `SignedQRCode` are
returned, parsed, and persisted. `einvoice_status` becomes `generated`.

**If it fails.** Read the code and message in the UI, then the log row. If
the GSP complains about `version` (G5), `document_type` (G8), or a missing
payment block (G2), you have found the answer to an open blocker — record it
in ADR 0003 and stop; do not retry blindly.

**Never retry a failed `generate_irn` on a timeout or 5xx.** The call may
have registered server-side. Use B4 to find out what actually happened.

### B4 — Check GSP status, independently

1. Click **Check GSP status**.

This is the cross-check that matters most. It is an independent read against
the vendor, not an echo of what this app stored.

**Expected.** `remoteMatches = true` and the remote IRN equals the stored
IRN. The invoice page reports a real match.

**If it fails.** A mismatch between the stored IRN and the remote one is a
serious finding: one of the two is wrong, and the stored one may be a value
this app should not be holding. Capture the `gsp_api_log` rows for both
calls before changing anything.

### B5 — Verify in the database

1. Re-run the Part A A7 queries against this invoice:

   ```sql
   select invoice_no, einvoice_status, e_invoice_required, e_way_required,
          irn, ewaybill_no, is_complete
     from public.v_invoices_compliance
    where invoice_no = '<invoice number>';

   select irn, (irn ~ '^[0-9a-f]{64}$') as irn_well_formed
     from public.invoices
    where invoice_no = '<invoice number>';
   ```

**Expected.** `einvoice_status = 'generated'`, `irn_well_formed = t`, and
`is_complete` still `false` while the e-Way Bill is outstanding.

**If it fails.** A sandbox IRN that is not 64 lowercase hex is not a valid
NIC IRN. Stop and raise it with the vendor before generating anything else.

### B6 — Verify the call log

1. Re-run the `gsp_api_log` query.

**Expected.** One row per operation attempted — `auth`,
`generate_irn`, `get_einvoice_by_doc` — each with `ok = true`, an HTTP
status, and a plausible `duration_ms`. No `request_body` or
`response_body` cell contains a token, a password, or a raw
`SignedQRCode`; those are redacted before insert and the QR payload belongs
only on `invoices.qr_payload`.

**If it fails.** A leaked token in `request_body` is a credential-in-plaintext
incident. Rotate the token, and treat the log table as sensitive.

### B7 — Optional: generate the e-way bill

1. **e-Way Bill** → enter Distance (km) → **Generate**.

**Expected.** A 12-digit e-way bill number, a date, and a `valid till`
timestamp. `eway_status` becomes `generated` and `is_complete` flips to
`true`.

**If it fails.** Record the code. The e-Way Bill API is a separate
subscription (see Part C) and may not be enabled on the sandbox account
even when e-Invoicing is.

### B8 — Negative test

1. Trigger a known-bad request — for example an invoice whose seller pincode
   is invalid — and click **Generate IRN**.

**Expected.** A business-error code and message from the vendor, surfaced in
the UI, with a `gsp_api_log` row where `ok = false`, `gsp_code` populated,
and `http_status` set. The invoice's `einvoice_status` becomes `failed` with
`einvoice_error` set; **no** IRN is written.

**If it fails.** An error the app swallows, or a failed attempt with no log
row, means the failure path is not being recorded — the audit trail is the
point of the log.

### B9 — Cancel within 24 hours

1. On the disposable invoice, click **Cancel IRN** and confirm. This proves
   the sandbox path is reversible before it is ever used on a real invoice.
2. Re-run the B5 query.

**Expected.** `einvoice_status = 'cancelled'`, a `cancel_irn` row with
`ok = true` in the log, and `eway_bills.status = 'cancelled'` if an e-way
bill was generated.

**If it fails.** A rejection naming a reason code is blocker G9 — only `"1"`
is documented, and the full list is needed before the cancel UI can be
trusted. Record the vendor's message verbatim.

---

## Part C — Masters India onboarding checklist

Everything Prokon needs from Masters India to move from mock to sandbox to
production. Tick each line as it is received in writing, and record the
answer in ADR 0003.

**To purchase**

- [ ] E-Invoicing API subscription — **sandbox**
- [ ] E-Invoicing API subscription — **production**
- [ ] E-Way Bill API subscription — **sandbox**
- [ ] E-Way Bill API subscription — **production**

**To ask for**

- [ ] Our **own** sandbox username and password (never the sample printed in
      the spec PDF)
- [ ] **G1** — the **production host URL**. Neither API document contains
      one; without it the production cutover cannot be configured.
- [ ] **G3** — the **error-code table**: every business error code, its
      meaning, and whether it is retryable. Triage is currently limited to
      the codes that appear in the examples.
- [ ] **G9** — the full **cancel reason-code list** with the text for each.
      Only `"1"` is documented.
- [ ] **G5** — the **`Version` requirement** for the generate request: is a
      `version` field required, and if so what value. One line of the spec
      says `"1.1"`; every example omits it. We send none.
- [ ] **G8** — confirmation that **`document_type = "INV"`** is valid on
      their API, and the full accepted enum if not. The GSP enum and the NIC
      enum are not the same namespace.
- [ ] **G6** — the **maximum bulk batch size** for a bulk IRN/EWB call, so a
      backfill can be sized safely.
- [ ] **G7** — **rate limits and 429 behaviour**: requests per second, the
      burst allowance, and whether a `Retry-After` header is returned.
- [ ] A **test buyer GSTIN** for the B2B counterparty, so e-invoicing can be
      exercised end to end.
- [ ] **Written confirmation that sandbox IRNs are non-reporting** — that
      they are not filed with GSTN and carry no statutory weight. Per
      environment, not just for the sandbox account.

**Rotate and never commit**

- [ ] Confirm whether the sample credentials in
      `data/gsp-pdfs/einvoice-api-spec.txt` (lines 8-12) are live. If they
      are, **rotate them**. Do not copy those values into any file, ticket,
      commit or chat message in this repository.

### Ready-to-send email

Subject: Masters India API — credentials and pending documentation (sandbox onboarding)

Dear [name],

We are building our ERP against the Masters India E-Invoicing and E-Way Bill
APIs and are ready to begin sandbox integration testing. Before we can
start, could you please confirm or provide the following?

1. Subscriptions — please enable the E-Invoicing API and the E-Way Bill API
   on both the **sandbox** and **production** accounts.
2. Credentials — sandbox **username and password issued to us**. We will not
   use any credentials that appear in the published sample documentation.
3. **Production host URL** — the base URL for the production environment.
   The API documents we hold list only the sandbox host.
4. **Error-code table** — the full list of business error codes, their
   meanings, and which are safe to retry.
5. **Cancel reason codes** — the complete list for IRN cancellation. Your
   documentation shows only reason code `"1"`.
6. **`version` field** — your e-invoice generate request documentation
   states a `version` of `"1.1"` in one place, while every example request
   omits the field entirely. Please confirm whether `version` is required
   and, if so, the correct value.
7. **`document_type`** — please confirm that `INV` is a valid value for the
   `document_type` field on the generate endpoint, and provide the full
   accepted enum.
8. **Bulk batch size** — the maximum number of documents permitted in a
   single bulk IRN or e-Way Bill request.
9. **Rate limits** — requests per second, burst limits, and whether throttled
   responses return a `Retry-After` header.
10. **Test buyer GSTIN** — a GSTIN we may use as the counterparty for
    end-to-end B2B testing.
11. **Sandbox reporting confirmation** — written confirmation that IRNs
    generated in the sandbox environment are **not reported to GSTN** and
    carry no statutory validity, for both the sandbox and any test
    production account.

If any of the above is already documented in a current version of your API
reference, a link to that document is just as useful as a reply.

We would also appreciate confirmation of whether the sample credentials
published in your API specification are live. If they are, please rotate
them.

Thank you,
[name / company]

---

## Triage

Symptom first, then the most likely cause. Start here before reading logs.

| Symptom | Likely cause | Do this |
|---|---|---|
| `401` on any call | The auth scheme is `Authorization: JWT <token>`, **never** `Bearer`. `Bearer` returns an opaque auth failure that looks like bad credentials. | Fix the header scheme in `createHttpTransport` before touching the credentials. Confirm with the connection probe. |
| "Unable to login with provided credential" | Wrong or expired username/password, or credentials issued for a different environment than the `GSP_BASE_URL` in use. | Re-check which environment each variable belongs to. The probe isolates this; nothing has been created yet. |
| The GSP complains about `version` | **G5.** The spec contradicts itself; the request deliberately sends no `version` field. | Add the field with the value the vendor confirms. Record the answer in ADR 0003. |
| `document_type` rejected | **G8.** `INV` is assumed, not verified. | Use the enum the vendor confirms. One-line change in the payload builder. |
| A payment/details block is rejected or demanded | **G2.** `payment_details` is omitted because the invoice form has no bank or payment source. | Decide with the vendor whether the block is required, and from where it should be sourced (`branches`) if so. |
| Cancel rejected | **G9.** Only reason code `"1"` is documented; the full list is unknown. | Capture the vendor's message verbatim and add it to the cancel UI. Do not guess a code. |
| Timeout or `5xx` on Generate IRN / e-Way Bill / Cancel | The outcome is **unknown** — the call may have registered server-side. | **Do NOT regenerate.** Use **Check GSP status** to establish the real state first. A blind retry risks a duplicate statutory document. |
| `is_complete` false while documents exist | The compliance view's inputs disagree with the header, or a migration is not applied. | Re-read `v_invoices_compliance` and confirm `20260902000000_invoicing_staged.sql` is applied. |
| An IRN is stored but is not 64 hex | The value is not a real NIC IRN. The `invoices_irn_not_repeated_block` constraint exists to stop the retired mock's output being stored. | Hard stop. Re-apply `20260929000002_invoice_compliance_cleanup.sql` and re-audit. |
| Tally download buttons missing | An unbalanced voucher. Downloads are withheld entirely, not flagged. | Fix the stored totals on the named vouchers, then export again. |
