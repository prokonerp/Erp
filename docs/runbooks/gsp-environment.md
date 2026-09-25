# GSP environment setup

The GSP integration ships in **`GSP_MODE=mock`**, which needs no credentials
and no network. This runbook is what you need when Masters India issues
sandbox credentials.

> Do **not** commit any of these values. `.env*` is already git-ignored
> (`.gitignore:49`). Set them in your local `.env` and in the Vercel project's
> server-side environment variables.
>
> Never paste the sample username/password printed in the Masters India PDFs
> (`data/gsp-pdfs/*.txt`) into any file or commit. See blocker G10 in
> `docs/adr/0003-gsp-mock-first.md`.

## Variables

| Variable | Required | Example | Notes |
|---|---|---|---|
| `GSP_MODE` | no | `mock` | One of `mock` \| `sandbox` \| `production`. Defaults to `mock`. Anything else is rejected at startup. |
| `GSP_BASE_URL` | yes, except `mock` | `https://sandb-api.mastersindia.co` | The **sandbox** host is the only one in the API documents. There is **no documented production host** — it must come from Masters India (blocker G1). No default is guessed. |
| `GSP_USERNAME` | yes, except `mock` | — | Sent as JSON to `POST /api/v1/token-auth/`. |
| `GSP_PASSWORD` | yes, except `mock` | — | Same call. |
| `GSP_USER_GSTIN` | yes, except `mock` | `06AEHPA2697G1ZL` | The GSTIN of the issuing entity. |
| `GSP_MOCK_ERROR` | no | `3038: Pincode does not exist` | **Mock only.** Injects a real GSP business-failure envelope so the error and retry paths can be exercised. |

`mock` mode additionally accepts `GSP_BASE_URL` and `GSP_USER_GSTIN` as inert
values so the same config can be carried across environments.

## Failure mode is fail-closed

`sandbox` and `production` **throw at startup** when any required variable is
missing, and an unrecognised `GSP_MODE` is rejected rather than guessed:

```
GSP sandbox mode is misconfigured — missing GSP_BASE_URL, GSP_PASSWORD.
Set these in the server environment (never commit them).
```

A misconfigured server therefore cannot silently fall back to the mock and
present fake IRNs as real ones.

## Switching to the live sandbox

1. Obtain sandbox credentials from Masters India.
2. Set the five variables above in the server environment.
3. Set `GSP_MODE=sandbox`.
4. Restart the process (environment is read at startup, not hot-reloaded).
5. Open an invoice, click **Generate IRN**, then **Check GSP status**. The badge
   changes from `GSP: mock` (purple) to `GSP: sandbox` (blue).
6. Confirm `v_invoices_compliance.is_complete` flips to true for that invoice.

## Seeing the mode without guessing

Every invoice screen shows a `GSP: <mode>` badge:

- **purple `mock`** — dummy APIs. Values are *not* legally registered.
- **blue `sandbox`** — connected to the Masters India sandbox.
- **green `production`** — connected to production.

The badge tooltip repeats the warning in mock mode so nobody can mistake a
dummy IRN for a real one.

## Exercising failure paths in mock mode

```bash
# Every GSP call returns a genuine business-failure envelope with this code.
GSP_MOCK_ERROR="3038: Seller details Details:Pincode-101301 does not exists" npm run dev
```

The UI should surface `[3038] …` and the attempt should appear in
`gsp_api_log` with `ok = false`.
