# ADR 0003 — GSP integration is mock-first

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Prokon ERP engineering
- **Supersedes:** nothing
- **References:** `docs/GSP_INTEGRATION_AND_TALLY_EXPORT.md`,
  `docs/gsp-einvoice-api-reference.md`, `docs/gsp-ewb-api-reference.md`

## Context

Prokon must issue statutory e-Invoices (IRN) and e-Way Bills through a GST
Suvidha Provider. The chosen provider is Masters India. Their two API
documents describe a sandbox host only:

```
https://sandb-api.mastersindia.co
```

No production host appears in either document, and no credentials have been
issued yet. Meanwhile the ERP has a working **pure** NIC JSON builder
(`src/lib/invoiceJson.ts`) and a manual download → government-portal →
paste-back flow.

The intermediate state was actively dangerous: `mockIrnPayload()` in
`src/lib/gst.ts` synthesised IRNs as `hash8.repeat(8)`. Those values pass
`IRN_REGEX` (`/^[0-9a-f]{64}$/`), so the database and the compliance view
reported invoices as legally complete. A read-only audit on 2026-09-21 found
**4 of 4** stored IRNs fabricated and **3 of 3** e-way numbers malformed.

Waiting for credentials is not an option, but shipping a code path that can
write fake statutory identifiers into a live database is worse.

## Decision

Build the complete integration now against a **mock transport**, selected by
environment, and defer all credential-dependent behaviour to configuration.

1. **One interface, two implementations.** `GspTransport`
   (`src/lib/gspClient.ts`) is implemented by `createHttpTransport` (real
   GSP) and `createMockTransport` (`src/lib/gspMock.ts`). Server functions
   depend only on the interface.

2. **`GSP_MODE` selects the implementation** — `mock` (default),
   `sandbox` or `production`. `mock` needs no credentials. `sandbox` and
   `production` **fail closed** when `GSP_BASE_URL`, `GSP_USERNAME`,
   `GSP_PASSWORD` or `GSP_USER_GSTIN` is missing; they never silently degrade
   to mock and an unknown mode is rejected rather than guessed.

3. **The mock's IRN is a real SHA-256** of the document, not a repeated
   block. It is deterministic per document, so re-running is idempotent, and
   it is structurally indistinguishable from a genuine IRN — which is what
   lets the parse → persist → status path be exercised honestly.

4. **Manual paste-back stays available** as a fallback. A GSP outage must
   never block billing.

5. **A non-idempotent write is never blindly retried.** A 401 is a
   definitive "not processed" signal, so one re-auth + retry is safe.
   A timeout or 5xx may have registered the IRN server-side, so
   `generateIrn` / `genEwbByIrn` / `cancelIrn` surface
   `GspTimeoutError` with `isOutcomeUnknown` and the caller must confirm the
   outcome via `getEinvoiceByDoc` before trying again. Only idempotent reads
   retry with exponential backoff.

6. **Credentials live in environment variables only**, never in the database
   and never in git. `gsp_settings` holds non-secret routing config
   (GSTIN, environment, base URL) so it can be audited and changed without a
   redeploy of secrets.

7. **Mock mode is visibly labelled** in the UI. An operator must never be
   able to mistake a mock IRN for a real one.

## Consequences

**Good**

- The full pipeline — build NIC JSON → transform → call → parse → persist →
  compliance status — is exercised and tested today, with no credentials.
- Cutover to the real GSP is an environment change plus `gsp_settings.base_url`,
  not a code change. No builder, parser or UI rewrite.
- The fabricated-IRN path is removed from the code, and a database
  constraint prevents that class of value from ever being stored again.
- Business-error and timeout paths are covered by tests rather than assumed.

**Bad / accepted**

- Mock mode can produce rows that look compliant but are not legally
  registered. This is why the mode badge is mandatory and why production
  mode is never reachable without explicit configuration.
- GSP responses are simulated, not real. Field-level mismatches will only
  surface against the live sandbox. The response parser deliberately follows
  the documented quirks (unwrapped token, `JWT` scheme, error code as the
  leading integer of `errorMessage`, `EwbNo == null` as the only reliable EWB
  signal), but the first sandbox run is still a genuine integration test.
- The mock adds ~200 lines of code that will be dead weight in production.

## Open questions that block production

These are **not** solvable in code and must be answered by Masters India
before the sandbox cutover:

| # | Blocker | Consequence if unanswered |
|---|---|---|
| G1 | **No production host** in either document | `GSP_BASE_URL` for `production` is unknown; cutover is blocked. |
| G2 | `payment_details` has no source in Prokon | Bank/payment block is either omitted or derived from `branches`. Decision needed. |
| G3 | No error-code table | Failure triage is limited to the codes seen in examples. |
| G5 | `Version` contradiction (`"1.1"` required by one line, absent from every example) | The request deliberately sends no `version` field. Must be confirmed. |
| G6 | Bulk max batch size undocumented | Bulk backfill cannot be sized safely. |
| G7 | No rate limits / 429 behaviour | Throttling behaviour unknown; start serial and conservative. |
| G8 | `document_type` enum for GSP vs NIC | Assume `INV` is valid; verify in sandbox. |
| G9 | Cancel reason codes | Only `"1"` is shown; the full list is needed for the cancel UI. |
| G10 | The spec PDFs contain a real-looking username and password | Confirm whether it is live and rotate it. **Never commit those values.** |

## Rollout

1. Ship in `GSP_MODE=mock`. UI shows a "Mock" badge.
2. Apply the two migrations (config + cleanup) via the Supabase dashboard.
3. Once sandbox credentials arrive: set `GSP_BASE_URL`,
   `GSP_USERNAME`, `GSP_PASSWORD`, `GSP_USER_GSTIN`, set `GSP_MODE=sandbox`.
4. Generate one IRN and one e-way bill for a test GSTIN. Confirm the
   returned `Irn` / `AckNo` / `SignedQRCode` parse and persist, and that
   `v_invoices_compliance.is_complete` flips to true.
5. Record the production host as a follow-up ADR, then switch to
   `GSP_MODE=production` and re-verify.
