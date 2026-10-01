# GSP Pre-Credential Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ERP ready so that the moment sandbox credentials arrive, the first live action is a *safe connectivity check* and the full flow is already rehearsed end-to-end.

**Architecture:** No new subsystems. One small server fn + one button (a safe token-auth probe), otherwise rehearsal of the existing mock-mode flow. All compliance plumbing already exists and is merged.

**Tech Stack:** TanStack Start server fns, supabase-js, vitest, pnpm.

**Spec:** `docs/adr/0003-gsp-mock-first.md`, `docs/runbooks/gsp-environment.md`, `docs/GSP_INTEGRATION_AND_TALLY_EXPORT.md`.

## Global Constraints

- Never commit GSP credentials; never use the sample creds in `data/gsp-pdfs/*.txt` (blocker G10).
- Never execute SQL — migrations are authored, a human applies them.
- No Vercel deploy or env writes — hand env values to the user.
- No `git push` / `git merge`. `mock`/`sandbox`/`production` must stay fail-closed.
- Single GSTIN: `GSP_USER_GSTIN` is the only credential source; `gsp_settings` stays unused.
- The full gate for any task: `npx tsc --noEmit` (0 errors), `npx vitest run` (all green), `pnpm build` (exit 0). **tsc + vitest are not sufficient — the browser build must pass too** (see Task 5).

---

### Task 1: "Test GSP connection" server function

**Files:**
- Modify: `src/lib/gspClient.ts` — add `authenticate(): Promise<{ token: string }>` to `GspTransport`
- Modify: `src/lib/gspMock.ts` — mock `authenticate()`
- Modify: `src/lib/gsp.functions.ts` — add `testGspConnection`
- Create: `src/lib/__tests__/gspConnection.test.ts`
- Modify: `src/routes/_app/sales.invoices.$id.tsx` — add the button

**Interfaces:**
- Produces: `testGspConnection(): Promise<{ ok: true; mode: GspMode } | { ok: false; mode: GspMode; code: number | null; error: string }>`
- Exports a pure `runGspConnectionTest()` so it is unit-testable without a database.

- [x] **Step 1: Write the failing test** — mock mode returns ok; sandbox with a missing credential throws `/misconfigured/`; `GSP_MOCK_ERROR` yields `ok: false`.
- [x] **Step 2: Run it — expect FAIL** (`is not a function`; API genuinely absent).
- [x] **Step 3: Implement** — HTTP impl reuses the existing `authHeader()` closure; mock impl calls `maybeFail("token-auth")` then returns a deterministic token. `getGspConfig()` stays *outside* the try so a misconfiguration propagates rather than degrading into a misleading `ok: false`.
- [x] **Step 4: Run it — expect PASS** (13 tests).
- [x] **Step 5: Wire the button** beside "Check GSP status", gated on `sales · read`.
- [x] **Step 6: Verify** tsc 0, eslint 0, full suite green.

### Task 2: Record the code-side ADR decisions

**Files:** Modify `docs/adr/0003-gsp-mock-first.md`

- [x] **Step 1:** Confirm current defaults are the decided behaviour: **G2** `payment_details`, **G5** omit `version`, **G8** `document_type = "INV"`.
- [x] **Step 2:** Append an amendment section (D-1..D-4) recording each as decided-and-to-be-verified, plus the single-GSTIN config decision and the connect-before-generate rule. Leave the existing G1–G10 register untouched.

### Task 3: Rehearsal + onboarding runbook

**Files:** Create `docs/runbooks/gsp-sandbox-rehearsal.md`

- [x] **Step 1:** Part A — mock rehearsal, 13 numbered steps, each with Expected / If-it-fails, plus the read-only evidence SQL.
- [x] **Step 2:** Part B — sandbox test, connection probe first, independent Check-GSP-status cross-check, IRN well-formedness check.
- [x] **Step 3:** Part C — Masters India onboarding checklist + ready-to-send email + triage table.

### Task 4: Mock end-to-end rehearsal (verification, no credentials)

Executed by a human in the browser — see `docs/runbooks/gsp-sandbox-rehearsal.md` Part A. Not automatable here: it needs an authenticated browser session.

- [ ] Run Parts A1–A13 and record the results.

### Task 5: Browser-bundle safety of the mock transport

**Files:** Create `src/lib/mockHash.ts`; Modify `src/lib/gspMock.ts`; Create `src/lib/__tests__/mockHash.test.ts`

**Why:** exporting `runGspConnectionTest` made `gspMock.ts` client-reachable, so its `import { createHash } from "node:crypto"` broke the browser build with `"createHash" is not exported by "__vite-browser-external"`. `tsc` and `vitest` both passed — only `pnpm build` caught it.

- [x] **Step 1:** Add `mockHashHex()` — a browser-safe deterministic 64-char lowercase-hex hash (8-lane FNV-1a avalanche), no dependencies.
- [x] **Step 2:** Swap `gspMock.sha256Hex` to delegate to it.
- [x] **Step 3:** Test — deterministic, 64-hex, single-char changes reshuffle, never a repeated 8-char block (so it clears the anti-fabrication CHECK).
- [x] **Step 4:** Verify `pnpm build` exits 0.

---

## Verification

| Claim | Owner | Evidence |
|---|---|---|
| Connection probe works offline | agent | 13 tests in `gspConnection.test.ts` |
| Probe never creates a document | agent | test file holds no invoice fixture; `authenticate()` only |
| Mock is browser-safe | agent | `pnpm build` exit 0, 0 browser-external errors |
| Fabrication guard still holds | agent | `mockHash.test.ts` repeated-block case |
| Full flow rehearsed | human | runbook Part A1–A13 |

## Follow-ups (not in this plan)

- **G2 correctness:** `payment_details` is sent as a populated `PayDtls` block (mostly null) rather than omitted — confirm with the vendor whether the block should be suppressed entirely.
- **EWB rehearsal needs a large invoice:** the e-Way Bill button only renders at `total >= 50000`.
- **Token cache (15 min):** a credential change inside the TTL is not re-probed until expiry.
- **Production cutover** remains blocked on **G1** (no documented production host).
