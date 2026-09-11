# Engineer Verification Flow — Design (Approach A: Append-only)

**Date:** 2026-09-11
**Status:** Approved (data+flow, UI+logs)
**Scope:** Engineer portal ticket verification — customer details + model/serial with audit + geotagged photo
**Stack:** TanStack Start (React 19) + Router + Query v5, Supabase PG + RLS + Storage (`ticket-attachments`), react-hook-form + Zod v4, Tailwind v4 + shadcn, Sonner

## 0. Locked decisions (from user)
1. Incorrect customer details → saved as additional info alongside master, main master fields never overwritten. Displayed in Customers master edit dialog (pencil → Contacts tab) as read-only "Field Verified" section with engineer tag. (Q1 JSONB-on-master intent satisfied via separate table, zero mutation of `customers` row.)
2. Engineer tagging = every verification stores engineer id/name/phone + timestamp, separate from `assigned_employee_id` assignment. (Contacts-tab clarification.)
3. Model/Serial mismatch → keep originals on ticket, show correction below with red strikethrough → green diff + engineer + timestamp + photo link, visible to admin and engineer. Never replace.
4. Mismatch photo = mandatory geotagged (live GPS + photo), block save if missing.
5. Strict sequence: Step 1 Customer (Verified/Incorrect) → Step 2 Model/Serial (Matched/Mismatch) → Work (notes/photos/close). Step 2 locked until Step 1; work locked until both.
6. Approach A chosen over JSONB-only and full review queue.

## 1. Architecture
- Two new tables, one row per ticket (upsert on re-verify), append-only history via `ticket_activities`. No `customers` or `tickets.product/serial_no` mutation.
- `ticket_customer_verifications`: `id uuid PK`, `ticket_id uuid UNIQUE NOT NULL FK tickets(id) CASCADE`, `customer_id uuid FK customers(id) SET NULL`, `verdict text verified|incorrect`, `snapshot jsonb` (ticket customer_* copy at verify time), `corrected jsonb` (only when incorrect: name/phone/email/address/sector/location), `engineer_employee_id uuid FK employees`, `engineer_name/phone text`, `verified_at timestamptz default now()`, `created_at/updated_at`.
- `ticket_equipment_verifications`: `id`, `ticket_id UNIQUE FK`, `verdict matched|mismatch`, `original_model/original_serial text` (copy of `tickets.product/serial_no`), `corrected_model/corrected_serial text`, `photo_path text`, `photo_lat/double`, `photo_long`, `photo_accuracy`, `photo_captured_at timestamptz`, engineer stamp, `verified_at`, timestamps.
- RLS mirrors tickets: engineer `SELECT/INSERT/UPDATE` only own tickets via `assigned_employee_id` = own employee or name-fallback uniqueness guard (same as `useMyQueue.ts`); admin full. Service-role only for storage writes via server function.
- No ADR required (additive tables, no framework/auth/storage-architecture change). Follows existing `ticket_assignment_history` + `ticket_activities` append-only patterns.

## 2. Components + files
- Engineer portal: `src/routes/eng.ticket.$id.tsx` — add 2-step stepper card above notes/photo timeline; gating logic + verdict forms + GPS photo capture.
- Admin ticket: `src/routes/_app/tickets.$id.tsx` — read-only verification badges + correction diff block under customer/equipment sections.
- Master dialog: `src/components/CustomerForm.tsx` (`CustomerFormFields` Contacts tab) — new read-only "Field Verified (from site)" list querying reports by `customer_id` (engineer, time, ticket link, corrected fields). No edit, no payload change in `buildCustomerPayload`/`saveCustomer`.
- Uploads: `src/lib/public-ticket-uploads.functions.ts` — extend schema to accept `lat/long/accuracy/captured_at`, require when `kind=equipment_correction`; keep 8MB/MIME allowlist; path `ticket/{id}/{date}/equipment-{ts}-{rand}.{ext}`.
- Hooks: extend `src/hooks/useMyQueue.ts` ownership + add `useTicketVerifications(ticketId)` (Query key in `src/lib/queryKeys.ts`).
- Diff UI reuse: `src/components/CorrectGrnSerialDialog.tsx` strikethrough pattern (`line-through decoration-red-400` → `bg-emerald-50 text-emerald-700`).

## 3. Data flow
1. Engineer opens `/eng/ticket/$id` → guard (FK then name) → fetch ticket + both verifications (stale 30s).
2. Step 1: shows snapshot (customer_name/phone/email/address/sector/location + linked `customers` billing when `customer_id`). `[Details Verified]` writes verdict=verified + snapshot + stamp. `[Details Incorrect]` opens rhf+zod form prefilled from snapshot → save writes verdict=incorrect + corrected JSONB + stamp. Both write `ticket_activities(kind=customer_verify)`.
3. Step 2 unlocked: shows `product/serial_no` (+ `installed_equipment` link when `equipment_id`). `[Matched]` writes matched. `[Not Matched]` requires manual model/serial inputs + camera photo with live `navigator.geolocation.getCurrentPosition` (high accuracy) → upload → save mismatch + photo/geo. Writes `ticket_activities(kind=equipment_verify + photo)`.
4. Work section (notes, extra photos, special-instruction ack, close) enabled only when both verifications exist.
5. Admin + Contacts tab read verifications + activities timeline; ticket never shows replaced values.

## 4. Error handling + gating
- GPS denied/timeout/unavailable → `toast.error` + inline retry, save blocked (mandatory per decision). Offline → blocked with message (no silent queue in v1).
- Photo: wrong MIME, >8MB (server) / >2MB engineer client pre-check, missing capture timestamp → block. Upload failure → keep form state, retry.
- Re-verify: upsert verification row + new activity row; originals, snapshots, prior activities immutable. Concurrent saves: last-write-wins on verification row, full history in activities.
- Validation: zod required for corrected customer fields (10-digit phone, email regex per `validateCustomerForm`), required corrected model/serial on mismatch, required photo+geo.

## 5. Testing
- Vitest: verdict payload builders (snapshot/corrected shaping), GPS-required guard, gating selectors (step2 locked, work locked).
- RLS smoke: engineer A cannot select/insert ticket B verifications; admin can.
- Manual: mobile Chrome GPS allow/deny, mismatch without photo blocked, admin sees diff + timeline, Contacts tab shows Field Verified with engineer + time, re-verify appends activities.

## 6. Out of scope (YAGNI)
- No auto-promotion of corrections into `customers`/`tickets` master fields; no admin approve queue (Approach C deferred).
- No EXIF parsing library in v1 — live GPS + captured_at is proof; EXIF bytes preserved as uploaded.
- No bulk backfill of old tickets.

## Verification
- `npm run lint` + `vitest` for new builders/guards; manual engineer strict-sequence walkthrough on `/eng/ticket/$id` + admin diff check.
