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

## Conventions for future changes

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
