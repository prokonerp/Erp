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

## Amendment 2026-09-25 — decisions taken before any sandbox call

Recorded while `GSP_MODE=mock` is still the only mode that can run. The
blockers in the table above are unanswered, but three of them (G2, G5, G8)
can no longer be left as open questions because the payload has to serialise
something *today*. Each gets a decision, a default, and an obligation to
confirm the default on the first live call rather than assume it. The full
step-by-step rehearsal is `docs/runbooks/gsp-sandbox-rehearsal.md`.

### D-1 — Configuration scope is a single GSTIN, so config is env-only

`GSP_USER_GSTIN` is the **only** credential source. There is one legal entity,
so the client's identity is fixed at startup and never varies per request.

`gsp_settings` (migration `20260929000001_gsp_integration.sql`) is
**intentionally unused**. It is keyed per `branch_id` with a unique constraint
on `(user_gstin, environment)`, and it holds non-secret routing config only.
For a single-GSTIN deployment there is exactly one row, at most, and its
contents would be a second copy of `GSP_BASE_URL` and `GSP_USER_GSTIN` that can
disagree with the environment. A split-brain config where the badge says
`sandbox` but the table says `production` is a worse failure than not having
the table at all. The table stays applied, and stays empty.

*Consequence.* Multi-branch and multi-GSTIN onboarding becomes a real code
change, not a config change: read `gsp_settings` per invoice, key the JWT
cache by GSTIN rather than by process, and decide what happens when a branch
has no row. That work is only worth doing when a second GSTIN actually
exists.

### D-2 — Code-side defaults for the three answerable blockers

Every value below is already implemented. None of them is a guess about the
GSP's behaviour; they are choices about what we send until the vendor answers.

| Blocker | Decision | Default already implemented | Confirm on first sandbox call |
|---|---|---|---|
| G2 | Omit `payment_details` | `payment_details` is sent as `null` unless the NIC builder produced a `PayDtls` block; there is no bank/payment source in the invoice form, so in practice it is `null` (`src/lib/gspPayload.ts:321`). | If the GSP rejects the request for a missing payment block, the block has to be sourced from `branches` (bank account, IFSC) or the request has to carry an explicit "no payment details" marker. Ask which. |
| G5 | Send **no** `version` field in the GSP request | The GSP envelope has no `version` key at all. `Version: "1.03"` exists only inside the nested NIC JSON, which is a different document (`src/lib/invoiceJson.ts:906`). | One line of the spec says `"1.1"` is required; every example omits it. If the first call fails on a missing or wrong `version`, that is G5 and it is a one-line change. |
| G8 | `document_type = "INV"` | `document_details.document_type` is carried straight from the NIC builder, which hardcodes `Typ: "INV"` for sales invoices (`src/lib/invoiceJson.ts:711`, `src/lib/gspPayload.ts:256`). | If the GSP rejects `INV`, the accepted enum is a vendor answer, not a guess. The GSP enum and the NIC enum are not the same namespace. |

G1, G3, G6, G7, G9 and G10 have no code-side default. They are inputs only
the vendor can supply, and they are itemised in
`docs/runbooks/gsp-sandbox-rehearsal.md` Part C.

### D-3 — Deployment is fail-closed, and the badge is the authority

`sandbox` and `production` throw at startup when `GSP_BASE_URL`,
`GSP_USERNAME`, `GSP_PASSWORD` or `GSP_USER_GSTIN` is missing, and an
unrecognised `GSP_MODE` is rejected rather than guessed. There is no silent
fallback to mock. Environment is read once at startup and is **not**
hot-reloaded, so a stale badge means a stale process, not a stale variable.

The `GSP: <mode>` badge on the invoice screen is the authoritative indicator
of which transport is live, because it is served by `getGspRuntimeInfo()`
from the same `getGspConfig()` the transport uses — it cannot disagree with
the code path. Configuration state inferred from "the app loaded" or "the
last call succeeded" is not evidence of mode.

### D-4 — Prove the connection before generating a document

The first live call in any new environment is the **connection probe** (the
"Test GSP connection" affordance, which performs token-auth only and creates
nothing), never Generate IRN.

Rationale: `generate_irn` is a non-idempotent statutory write. If it fails
because the auth scheme is wrong, the credentials are wrong, or
`GSP_BASE_URL` points at the wrong host, the failure and the document are
inseparable — you end up with a half-understood error and a document that
may or may not have registered at the far end. The probe reduces the whole
unknown surface to a single boolean (does token-auth return a token?) before
anything is created, and it is the one call that is safe to repeat.

The probe must be run first on every environment change, not just the first
sandbox run, because the failure mode it catches is configuration drift, not
first-contact unfamiliarity.
