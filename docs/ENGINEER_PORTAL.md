# Engineers Portal — Module Truth

> Source of truth for the `/eng` portal: what it is, what it touches, and the
> rules that must hold. Transcribed product decisions come from
> `docs/Engineer-Verification-Product-Document.docx` (v1.0, Sep 2026);
> everything under "Changed Sep 2026" is the production-hardening pass
> (Waves 0–3, commits `fix(eng): [wave0/1/2]`).

## What it is

Mobile-first portal for field engineers, mounted at `/eng` (TanStack Start,
outside the `_app` admin shell). Engineers are contained to `/eng` by the
`eng.tsx` layout gate; admins landing on `/eng` bounce back to `/dashboard`.

| Route | Purpose |
|---|---|
| `/eng` | Dashboard: pending calls, completed visits, today's log, material stats |
| `/eng/queue` | Assigned-ticket queue (Today / Waiting for Parts / Carry Forward) |
| `/eng/ticket/$id` | Ticket workspace: verify → notes/photos → FSR → visits → signature |
| `/eng/conveyance` | Daily odometer log + conveyance expenses |
| `/eng/profile` | Identity card, photo, documents |
| `/raise-ticket` | PUBLIC form: customers raise tickets (captcha + staged uploads, no login) |
| `/fsr/preview` | DEV-ONLY showroom (redirects to `/` in production builds) |

## Tables (all RLS-enforced, least-privilege for the Engineer role)

`tickets` (assigned_employee_id FK + assigned_engineer_name fallback) ·
`ticket_customer_verifications`, `ticket_equipment_verifications` (one row per
ticket) · `ticket_visits` (one row per ticket; arrival guarded, departure
conditional) · `field_service_reports` (append-only; `submission_id` UNIQUE =
idempotency key) · `ticket_assignment_history` (audit) ·
`ticket_activities` (timeline) · `engineer_daily_logs` (one per day) ·
`engineer_conveyance_expenses` · `installed_equipment`, `customers`
(read-scoped). Storage: `ticket-attachments` (ticket + staged uploads),
`engineer-uploads` (own-folder reads for engineers).

## Product rules (from the verification product document — still binding)

1. Fixed 3-step order: customer check → equipment check → work. No skipping.
2. Originals are never replaced; corrections sit beside them (snapshots).
3. Equipment mismatch needs BOTH serial-plate photo AND live GPS, else save blocks.
4. Only the assigned engineer (or admin) verifies/uploads — enforced in the
   UI, in RLS (`20260922000004`), AND in every server fn (`assertTicketAssignee`).
5. Every verification writes a timeline entry; past entries are immutable.
6. One verification row per ticket; re-verify overwrites the verdict (timeline
   keeps both notes). Corrections never auto-update the customer master.
7. No offline queue (v1): every mutating action needs internet, says so, and
   never pretends otherwise.
8. Photos compress on-device (≤2 MB); undecodable files pass through ≤8 MB.
9. Failed saves delete their just-uploaded photo (no orphan accumulation).

## Changed Sep 2026 (hardening pass)

- **Security**: anon storage INSERT closed; GRANTs versioned; `cancelled`
  enum value versioned; duplicate migration version repaired; real
  server-side captcha; anon uploads staged under `public/staged/` with rate
  limits + path guards (`isStagedPublicPath`).
- **Scope**: Engineer-role holders see/update only assigned calls at the DB
  layer (tickets SELECT, visits/verification UPDATEs, assignment log,
  engineer-uploads). Office/admin/strangers byte-identical to before.
- **Integrity**: cancel-unlink triggers run as definer (fixes silent no-op
  cancels); custody INSERT siblings close the direct-Submitted gap; FSR
  `submission_id` UNIQUE kills duplicate rows; 3 FKs + 3 CHECKs added
  NOT VALID with conditional VALIDATE (never fails the push).
- **App**: one identity policy (`engineer-identity.ts`, shared gate
  `assertTicketAssignee`); one timezone (`time.ts`, IST everywhere);
  idempotent FSR submit (23505 = success); ack flips the column via server
  fn; arrival guarded; photo cleanup race-free + server-side; queue dedup;
  dashboard/conveyance/profile/conveyance fixes; `engKeys` factory;
  exact-match admin classification; types backfilled.
- **Known open product questions** (not bugs, need a product call): battery
  readings vs bank qty enforcement; stale snapshots after admin edits;
  no mismatch alerts; GPS spoofability (see verification doc §8).

## Portal login provisioning — and the 2026-09-18 auth outage

**The one rule:** the `auth` schema belongs to GoTrue. Application SQL never
inserts or updates `auth.users` / `auth.identities`. A row written by hand omits
columns GoTrue needs non-NULL, and the failure is brutal: 500 on every read of
that row — engineer sign-in, Admin → Users, the Supabase Auth dashboard.

**What happened (root cause, verified live).** `scripts/provision-engineers.sql`
created the five `@eng.prokonhitech.com` logins with a raw
`INSERT INTO auth.users (…)` / `INSERT INTO auth.identities (…)` listing only a
subset of columns. The omitted nullable columns stored NULL; GoTrue scans them
into non-pointer Go fields, so the row became undecodable:

| Probe | Result |
| --- | --- |
| `POST /auth/v1/token` as an engineer | 500 `Database error querying schema` |
| `GET /auth/v1/admin/users/{id}` for the 5 engineers | 500 `Database error loading user` |
| `GET /auth/v1/admin/users` | 500 `Database error finding users` |
| same calls for every non-engineer user | 200 |
| `POST /auth/v1/token` with an unknown email | 400 `invalid_credentials` (query fine → row decode is what fails) |

Repair (idempotent, 5 rows, audit → fix → post-check in one file):
`supabase/repair_20260918_auth_users_null_columns.sql`.
`scripts/provision-engineers.sql` is now **link-only** and carries the safety
assertion "zero writes to the auth schema".

**Canonical path for a new portal login** (Admin API — GoTrue writes every column):

1. Employee must be active and have an email in Employees master.
2. In-app: **Admin → Roles & Users → "Provision login"** on that employee row
   (`provisionEngineerLogin`: Admin API create/update, strong-password validation,
   `password_history`, `must_change_password` for first-login rotation).
   Scripted alternative: `node scripts/create-users.mjs`.
3. Only if the employee link is still missing: run `scripts/provision-engineers.sql`
   (links `employees.auth_user_id`, upserts `app_users`; finds the auth user, never creates it).
4. Verify each row with Section 0 of the repair file, or
   `GET /auth/v1/admin/users/{id}` → 200.

**Verified 2026-09-18 (after the operator applied the repair).**
`node scripts/diagnose-portal-logins.mjs '<email>:<pw>'` → 11/11 PASS, exit 0 (all 5
engineer rows decode, session issued). `node scripts/smoke-engineer-portal.mjs
https://localhost:8080 <5 email:pw pairs>` → all 5 reach `/eng` with the portal
rendered, zero failed requests, zero console errors.

Two behaviours worth knowing:

- the login hop is `/auth → /dashboard → /eng`; the dashboard loads first and the
  engineer gate bounces it. Cold-cache hops take 2.5–7s, so a short wait makes a
  healthy engineer look like they landed on `/dashboard`. The smoke script waits 20s
  on purpose.
- an engineer's `tickets` read is name-scoped as well as FK-scoped, so a ticket
  assigned to a *dangling legacy employee row with the same name* still shows in that
  engineer's history (observed: 9 tickets for "Vipin Chhonker" under employee id
  `5fff1eee…`, while the linked row is `a59e143c…`). Those are that engineer's own
  legacy calls — not another engineer's — but the roster's orphan section is the
  place to reconcile them.

**Shared-password caveat (product, open).** The five engineers were provisioned
with one shared password and `must_change_password = false`, so any engineer can
sign in as any other and the engineer↔ticket audit trail is not per-person.
Rotation to per-engineer passwords (`Admin → Roles & Users → Reset password`)
would close that.

## Conventions for future changes

- `auth` schema: read-only from the app. Never `INSERT` / `UPDATE` / `DELETE`
  `auth.users` or `auth.identities` from SQL — provision through the GoTrue
  Admin API (`provisionEngineerLogin` / `create-users.mjs`). See
  `supabase/repair_20260918_auth_users_null_columns.sql` for the repair recipe if
  a hand-written row ever slips in.
- New migrations: idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` /
  guarded `DO`), additive only (zero `DELETE FROM` / `TRUNCATE` /
  `DROP TABLE` / `DROP COLUMN`), safety-assertion header, `NOT VALID` +
  conditional `VALIDATE` for constraints on live tables.
- New server fns touching tickets: gate with `assertTicketAssignee`.
- New eng queries: use `engKeys`; cross-invalidate `engKeys.all`-family.
- New display times: use `src/lib/time.ts` (never device-local/UTC).
- New pure logic: unit test in `src/lib/__tests__/` (TDD: red first).
- Verify loop per change: `bun run test` + `bunx tsc --noEmit` +
  `bun run build` + (SQL) apply-twice on a scratch cluster.
