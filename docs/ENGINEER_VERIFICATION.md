# Engineers Portal — Verification Ledger (Sep 2026 hardening)

> Every bug from the end-to-end audit, what fixed it, and how to prove it.
> Local gates (all green at commit time): `bun run test` 799/799,
> `bunx tsc --noEmit` clean, `bun run build` green, every new migration
> applied 2–3× on a scratch PostgreSQL cluster with behavioral assertions.
> Live-environment gates below are manual — Supabase writes are never done
> by automation; apply the migrations yourself, then run the checks.

## 0. Live-DB apply runbook (in this order)

New migrations (all idempotent, additive, zero data loss — safe to re-run):

1. `20260922000001_harden_ticket_attachments_storage.sql` — drops anon INSERT.
2. `20260922000002_grant_engineer_tables.sql` — GRANTs (live may already have
   out-of-band grants; re-granting is a no-op).
3. `20260922000003_fix_transfer_cancelled_enum.sql` — adds `cancelled` value.
4. `20260912000002_ticket_verifications_policies.sql` — RENAMED from
   `...12000001_ticket_verifications_policies.sql` (duplicate version fix).
   Guarded no-op where the hardened successor already runs.
5. `20260922000004_scope_engineer_rls.sql` — per-engineer RLS scope.
6. `20260922000005_harden_doc_triggers.sql` — definer triggers + INSERT siblings.
7. `20260922000006_fsr_submission_id.sql` — idempotency column + backfill + UNIQUE.
8. `20260922000007_integrity_constraints.sql` — FKs + CHECKs (NOT VALID first;
   read any NOTICEs — they name exact report queries for leftover bad rows).

Pre-flight (read-only, Supabase SQL editor):

```sql
-- 1. Which of the duplicate-version files actually applied?
-- NOTE: live has no supabase_migrations schema (bootstrapped outside db push),
-- so this is NOT runnable in SQL — check Dashboard > Database > Migrations
-- (or `supabase migration list` from CLI) instead.
-- 2. Orphan scan BEFORE #9 (predicts its NOTICEs):
select t.id from tickets t left join employees e on e.id = t.assigned_employee_id
 where t.assigned_employee_id is not null and e.id is null;
-- 3. Confirm the anon storage hole exists BEFORE #1 (expect 1 row):
select policyname, roles from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname = 'Public can upload ticket attachments';
```

Post-apply (expectations):

```sql
-- anon INSERT gone; authenticated INSERT remains:
select policyname, roles from pg_policies
 where schemaname='storage' and tablename='objects' and cmd='INSERT';
-- single migration version; hardened policies in force:
-- version check is NOT runnable in SQL (no tracking schema on live) —
-- confirm via Dashboard > Database > Migrations instead.
select policyname from pg_policies where tablename='ticket_customer_verifications';
-- engineer tables granted:
select has_table_privilege('authenticated','public.field_service_reports','INSERT');
```

## 1. Security gates (Wave 0) — verify each

| # | Was | Fix | Prove it live |
|---|---|---|---|
| 1 | anon Internet could INSERT into `ticket-attachments` | anon arm dropped (`...22000001`) | table above shows no `anon` INSERT policy; try an anon REST upload → 403/RLS error |
| 2 | 7 engineer tables had no GRANTs (fresh-reset = dead portal) | GRANTs migration (`...22000002`) | `has_table_privilege` checks above |
| 3 | `cancelled` enum value only out-of-band; transfer-cancel trigger dead on reset | versioned `ADD VALUE` (`...22000003`) | `select enumlabel from pg_enum … = 'cancelled'` |
| 3b | duplicate migration version `20260912000001` ×2 | renamed + guarded no-op (`...12000002`) | single-version query above; `supabase migration list` shows no duplicates |
| 4 | captcha hardcoded 0/0, server defaulted | stateless HMAC challenge, verified first in `submitPublicTicket` | submit with wrong answer → "Captcha verification failed"; 22 captcha/rate/guard unit tests green |
| 5 | public-form uploads 401'd (auth-gated fns) and schema-rejected (no ticket_id) | anon `stagePublicTicketPhoto` (rate-limited, `public/staged/`) + token `deleteStagedPublicPhoto`; submit allow-lists staged paths only | signed-out browser: upload photo → success; submit → ticket created with attachment; 6th photo / 9 MB file → rejected |

## 2. DB integrity (Wave 1) — verify each

| # | Was | Fix | Prove it live |
|---|---|---|---|
| 6 | any engineer read ALL tickets, updated ANY visit/verification, read full assignment log + everyone's docs | `...22000004`: Engineer-role → assigned-only; office/admin/strangers unchanged | as an engineer login: list tickets → only assigned; `update ticket_visits` on another's row → 0 rows; assignment history → own rows; `engineer-uploads` → own folder |
| 7 | cancel-unlink triggers ran as caller → RLS-denied cancels silently no-op'd; direct-Submitted docs skipped custody | definer + search_path (`...22000005`); AFTER INSERT custody siblings | cancel a GRN as non-editor → succeeds + stamp clears; DC created Submitted with carrier → custodian stamped |
| 8 | FSR retry → duplicate rows + view-only lockout | `submission_id` UNIQUE (`...22000006`); client reuses key, 23505 = success | submit, kill network mid-flight, retry → exactly 1 row |
| 9 | bare-uuid FK columns, no range CHECKs | 3 FKs + 3 CHECKs, NOT VALID + conditional VALIDATE (`...22000007`) | new bad writes rejected; NOTICEs (if any) list exact cleanup queries |

Scratch-cluster proofs (method, for the record): throwaway local PostgreSQL,
stub roles/tables, each migration applied 2–3× (0 errors), then behavioral
matrices (engineer-A/B/office/admin/stranger × tickets/visits/history/uploads;
old-vs-new cancel semantics; INSERT-sibling stamping; backfill + 23505;
clean-vs-dirty constraint paths). One environment caveat found while proving:
Homebrew PostgreSQL 15.19 does not match rows through `FOR UPDATE`/`FOR
DELETE` RLS policies (SELECT works; `FOR ALL` works) — a build defect, not a
migration defect. UPDATE-through-RLS was therefore proven via `FOR ALL`
twins carrying the identical expressions. Re-check on any new local build
before trusting it for RLS validation; production Supabase is unaffected.

## 3. App logic (Wave 2) — verify each

- **Identity**: one policy, 8 call sites, shared gate; 13 unit tests
  (`engineer-identity`, `ticket-assignee`). Manual: duplicate-email logins
  fail loud with "contact admin" on queue/profile/workspace/server fns.
- **Ack**: engineer ack flips the column (server fn, idempotent). Manual:
  ack as engineer → admin ticket view shows acknowledged.
- **FSR submit**: timeout-retry creates exactly 1 row; dashboard + queue
  refresh after finalize; `closed_at` set on auto-close (print lifecycle).
- **Workspace**: no "Not assigned" flash for the owner (pending state);
  activities errors surface inline; photo re-picks survive transient
  failures; concurrent re-verify never deletes the winner's photo (re-read
  guard); matched verdicts carry best-effort GPS; Retry refetches in place.
- **Visits**: second Arrive never overwrites the first (conditional update +
  insert fallback); timeline keeps dates (`15/09/2026 09:40`), actors show
  "You"/short-id.
- **Signatures**: same-tick double-save uploads once; saved signatures render
  as images; rotation no longer skews strokes (normalized coordinates).
- **Queue**: no double-rendered tickets; dead section removed; refresh spins.
- **Dashboard**: unlinked logins get the link-admin hint; material card links
  to queue; visits count is daily (IST).
- **Profile**: rapid doc/photo taps serialize (ref locks); signed URLs cached
  per mount.
- **Conveyance**: errors classified (migration vs denied vs offline); failed
  saves roll back their upload; mid-edit typing survives refetch; odometer
  validated pre-upload; INR totals formatted.
- **Preview**: `/fsr/preview` redirects unless dev.
- **Keys**: all eng hooks/invalidations on `engKeys` (no ad-hoc literals).
- **Admin check**: exact-match-first (`Admin Assistant` no longer reads as
  admin); 11 classification tests green.
- **Types**: `submission_id`, ticket FK/stamp columns, visits + assignment
  history tables added (live `gen types` blocked: CLI token lacks access to
  the linked project — regenerate when access exists and diff).

## 4. Left open deliberately (product calls, not bugs)

- Battery readings vs bank-qty enforcement (blocking rule needs a product call).
- Stale verification snapshots after admin edits; old verdict visible after
  reassignment; no mismatch alerts; GPS spoofability (all pre-existing v1
  limits from the product document §12).
- `useTicketsTable` per-page activities lookup (perf pattern, admin-side).
- Legacy permissive-era exposure window is closed in-file-order; no action.
 - `front_indication`: dropped by `20260919000001` per product decision (user
   confirmed: leave deleted; `rating` and all related columns untouched).

## 5. One-command live check (read-only)

Paste the whole of `scripts/verify-eng-live.sql` into the Supabase SQL editor
and Run. It is ONE union query, so you get a SINGLE result grid
`(seq, check, result)` — copy all rows (runners that show only the last
result set would otherwise hide every check but the final one).

Failure → owning task:

| Failure | Task |
|---|---|
| duplicate `12000001` versions | NOT CHECKABLE in SQL (no tracking schema on live) — confirm via Dashboard > Database > Migrations |
| anon INSERT hole / missing grants / missing `cancelled` enum | A2 (apply runbook incomplete — apply the matching Wave 0–1 migration) |
| backfill residue unmatched/ambiguous > 0 | A3 (data cleanup); A5 GATE: do not apply name-fallback removal while > 0 without user sign-off |
| any `convalidated = false` / orphan or CHECK-violation count > 0 | A4 (fix rows via the NOTICE report query, re-run the validate migration) |
| any rewritten policy still has a name leg | A5 (apply `20260923000003_remove_name_fallback_rls.sql`) |
| `engineer-uploads` SELECT missing | owned by `20260922000004` — re-apply it; never hand-edit `storage.objects` (needs `supabase_storage_admin`) |
| grn/dc checks show `absent` / no rows | expected before B1 ships; after B1, non-validated or orphan rows are a B1 data task |
| M1 shows fewer than 3 `guarded` rows / any `UNGUARDED!` | apply `20260923000005_guard_stock_rpcs.sql` (a missing row = live overload without guard) |
| M3/M4 show `PERMISSIVE!` | apply `20260923000007_scope_reads_tighten_history.sql` |
| M6 shows `NOT-TIGHTENED!` | apply `20260923000007_scope_reads_tighten_history.sql` |
