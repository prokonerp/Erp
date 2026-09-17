# P0001 storage uploads — RESOLVED 2026-09-17 (app-side root cause; do NOT send as a storage bug)

> ## RESOLVED — this was never a Supabase bug
>
> **Cause:** `20260911000003_advisory_lock_rpc.sql` created `public.pg_advisory_lock(text)`,
> `public.pg_advisory_unlock(text)` and `public.pg_advisory_xact_lock(text)` — **overloads of the
> pg_catalog built-ins (which take `bigint`)**. `20260923000008_harden_advisory_locks.sql` then added
> a guard that `RAISE`s P0001 for any key not prefixed `so_fulfill:`.
>
> The storage API calls `pg_advisory_*` with an untyped/string key on its object-write path.
> PostgreSQL's unknown-argument resolution prefers the **string category** when a `text` candidate
> exists, so the platform's call bound to *our* overload and got rejected — 500 P0001 on every
> object write, for every bucket, from every client including the Dashboard. Reads/list/delete never
> take that lock, which is why they kept working.
>
> **Proof:** the Postgres log records `advisory lock key outside app namespace` at level error,
> status `P0001`, **0.5–1.0 s after every one of the 8 failing storage writes** on 2026-09-16
> (18:08:59→18:09:00, 18:22:19→18:22:20, 18:24:27→18:24:28, 18:26:02→18:26:02, 18:32:49→18:32:50,
> 18:38:38→18:38:39, 18:41:58→18:41:59, 18:42:15→18:42:16) — including a bare signed-URL `PUT`
> (`/storage/v1/object/upload/sign/ticket-attachments/e2e/signed-mu4flvk8.png`) that no application
> code touched. The RAISE string is ours, not storage's.
>
> **Fix:** `supabase/migrations/20260924000001_fix_advisory_lock_overload_collision.sql`
> (drops the 3 colliding overloads, re-creates them as app-namespaced `app_advisory_*`), plus the
> matching rename in `src/lib/documentFlow.writers.ts` (+ its tests).
>
> The audit sections below are kept as the incident record. No ticket is needed for storage.

# (original draft — superseded, retained as forensics)

## Project
- Ref: `cqjmcfwsrljxhixzfgpk` (Prokon Erp, live/production)
- First observed: week of 2026-09-16. Was working before (app has months of successful uploads).

## Symptom
Every object WRITE to Supabase Storage fails; every read works:
- `POST /storage/v1/object/<bucket>/<path>` (service_role key, any bucket,
  with or without `x-upsert`, any MIME/size) →
  `500 {"statusCode":"500","error":"DatabaseError","message":"database error, code: P0001","code":"DatabaseError"}`
- `PUT <signed-upload-url>` (token minted by `createSignedUploadUrl`, service_role) → same 500 P0001
- `POST /storage/v1/object/list/<bucket>` → 200 (reads fine)
- `DELETE` missing object → clean 404 `NoSuchKey` (API delete path healthy)

Minimal repro (replace `$SUPABASE_URL` / `$SERVICE_ROLE_KEY`):
```bash
# FAILS (500 P0001) — 70-byte PNG, fresh path, both buckets:
curl -s -X POST "$SUPABASE_URL/storage/v1/object/ticket-attachments/e2e-probe.png" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Content-Type: image/png" --data-binary @tiny.png -w "\nHTTP:%{http_code}\n"
# WORKS (200): POST $SUPABASE_URL/storage/v1/object/list/ticket-attachments {"prefix":"","limit":5}
```

## What we ruled out (with catalog evidence, available on request)
- No custom trigger on `storage.objects` (only FK constraint triggers,
  `protect_objects_delete` BEFORE DELETE FOR EACH STATEMENT,
  `update_objects_updated_at` BEFORE UPDATE).
- `relforcerowsecurity = false` on `storage.objects`; INSERT/SELECT granted.
- Bucket policies reference only `has_role`, `has_permission`,
  `storage.foldername` — none contain RAISE.
- Column defaults are `now()`, `gen_random_uuid()`, `false`,
  `string_to_array` — none raise. No generated-column expressions raise.
- **Zero CHECK / NOT NULL constraints on `storage.objects`** (so no
  CHECK-called function).
- Case-insensitive inventory of RAISE in `storage, public, auth,
  extensions` schemas: the only storage functions containing RAISE are
  `storage.can_insert_object` (raises `PT200` control-flow only) and
  `storage.protect_delete` (P0001, DELETE-only). No other P0001 source exists
  on the INSERT path — yet every INSERT raises P0001.
- Buckets `ticket-attachments` + `engineer-uploads` exist, private,
  `file_size_limit` 10485760, `allowed_mime_types` NULL,
  `versioning_status` DISBLED. Schema has versioned-release columns
  (`is_versioned`, `is_delete_marker`, `version`, `archived_at`,
  `owner_id`) + `s3_multipart_uploads(_parts)` tables.

## App-side pipeline audit — 2026-09-17 (all green; application is NOT the cause)

Verified live, read-only, against project `cqjmcfwsrljxhixzfgpk` with user `test@gmail.com`
(same account and same ticket as the failing upload):

| Gate | Check | Live result |
| --- | --- | --- |
| Auth account | GoTrue user `76df49a1-4810-453f-81c7-e6448da976e4`, email confirmed, not banned | PASS |
| `requireActiveUser` | `app_users.status = 'active'`, `must_change_password = false` | PASS |
| Engineer identity | `employees.auth_user_id = 76df49a1-…` (employee `8d723e0d-…`, active) | PASS |
| Not admin (correct) | `has_role(uid,'admin') = false`; `user_roles` empty; role via `app_roles.name = 'Engineer'` | PASS |
| Field engineer | `is_field_engineer(uid) = true` | PASS |
| Permissions | `has_permission(uid,'tickets','create') = true` | PASS |
| Ticket exists | `786ba8ed-f7a7-4fe4-9d34-29d04e03453b`, status In Progress | PASS |
| Assignee gate | `tickets.assigned_employee_id = my_employee_id(uid) = 8d723e0d-…` | PASS |
| Bucket | `ticket-attachments` private, 10 MB cap, mime NULL; bucket list (read) works | PASS |
| **Storage object write** | `POST /storage/v1/object/ticket-attachments/ticket/<id>/<date>/<kind>-<ts>.<ext>` via service_role | **FAIL — 500 P0001** |

Two consequences:
1. Every write on this path uses the **service-role** key, which **bypasses RLS entirely**.
   No bucket policy, no `has_role`, no app-table RLS can produce this 500. The failure is
   below the application, inside the platform's object-write path.
2. Bucket contents confirm it: `public/` and `ticket/` folders still exist, but **no new
   object has landed since 2026-09-14** — while reads/list/delete all keep working.

Observed bucket rows report `type: STANDARD` and `versioning_status: null` from a
versioned-release storage API — worth confirming against the live DB row via the trace SQL.

## Second platform symptom (NEW, 2026-09-17) — GoTrue also returns a database error

- `GET /auth/v1/admin/users?page=1&per_page=1` (service_role) →
  **500** `{"code":500,"error_code":"unexpected_failure","msg":"Database error finding users"}`
  — reproduced twice, `error_id` `01a0adc6-a269-7dba-8363-a690b018ef93` and `01a0adc6-f3b4-788b-bbe8-03018069b3e7`
- `GET /auth/v1/admin/users/76df49a1-4810-453f-81c7-e6448da976e4` → **200** (single-row fetch works)
- `GET /auth/v1/health` → 200, GoTrue `v2.197.0`

A **second** platform service returns a database error on a multi-row DB operation while
single-row operations succeed. Same failure class as the storage symptom (service → DB
error), and independent of this application's code.

## LOG LINE (paste from Dashboard → Logs Explorer → Postgres, error level,
## window = one fresh failing upload above)
```
PASTE the ERROR: line AND its CONTEXT: PL/pgSQL function … line N at RAISE line here
```

## AUTH LOG LINE (same Logs window, for the GoTrue 500 above)
```
PASTE the ERROR: line + CONTEXT: line produced when POST/GET /auth/v1/admin/users is called
```

## Ask — CLOSED
Items 1 and 2 (storage P0001) are **resolved**: root cause was our own
`public.pg_advisory_*(text)` overloads hijacking the storage API's built-in call.
Fixed by `20260924000001_fix_advisory_lock_overload_collision.sql`. No support action.

## Open item — verify after applying the fix
`GET /auth/v1/admin/users` (list) returns 500 `"Database error finding users"` while
`GET /auth/v1/admin/users/<id>` returns 200 (GoTrue v2.197.0, /health 200).

**Re-test immediately after applying the migration.** If it recovers, it was the same
overload collision reaching a second platform caller. If it still fails, *that* is a
genuine Supabase-side question and the only item worth a ticket — attach the Postgres
log line for the failing statement (it will name the function).
