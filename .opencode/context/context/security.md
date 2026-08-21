# Security & Permissions

## Authentication
- **Email + password only** via Supabase Auth. NO OAuth providers (no GitHub/Google login).
- Session: localStorage, persist + auto-refresh. 30-min idle timeout (`IdleTimeout.tsx`) with warning dialog at 25 min; marks `sessionStorage["idle-session-expired"]`.
- Auth flow details in `architecture.md` (attach → verify → claims).

## Two-layer RBAC (coexisting)

**Layer 1 — Global role (`user_roles`):** `app_role` enum: `admin | user`. Admins bypass everything (`has_role(auth.uid(), 'admin')`). First-admin bootstrap: `is_designated_owner()` + `claim_admin()` RPC (only succeeds when no admin exists). Designated owner emails (current): `gaurav@prokonhitech.com`, `prokonerp@gmail.com` — defined in migration `20260803130516_13dadd82-0a90-4319-b0f8-c9b465459967.sql`.

**Layer 2 — Module permissions (`app_roles` + `role_module_permissions` + `app_users`):**
- Per-module flags: `enable_access, can_read, can_create, can_edit, can_delete, can_export, can_import`.
- Module keys registered in `app_modules` (customers, products, tickets, indent, amc, gatepass, quotations, reports, ims, sales, po, accounts, general_dc, payroll, employees...).
- Per-user override: `app_users.custom_permissions` JSONB — merged FIRST and WINS over role rows.
- `app_users.status = 'inactive'` → no permissions at all.
- Evaluation: `has_permission(user_id, module, action)` RPC (SECURITY DEFINER); client mirrors via `usePermissions().can(mod, action)` with in-memory cache, busted on sign-in/out.

## RLS summary
- All tables have RLS enabled; service_role bypasses.
- Recurring patterns: admin-gated, module-permission-gated, ownership-scoped (created_by/owner_id), open-but-authenticated (`auth.uid() IS NOT NULL`).
- Hard DELETEs restricted to admins; app prefers soft-delete (is_deleted) for tickets/indents/amcs/invoices; `document_deletion_audit` for admin deletions; 30-day purge via `purge_archived_records()` (pg_cron).
- Storage buckets: `ticket-attachments` (tickets module), `amc-agreements` (amc module), `oem-logos` (admin).
- Detail per table in `database.md`.

## Password policy (client + server enforced)
- Min 8 chars; ≥1 uppercase; ≥1 lowercase; ≥1 digit; ≥1 special char.
- 30-day expiry; `must_change_password` force flag; last-5 password history (hashed SHA-256 `userId:pw`), no reuse.
- `changeOwnPassword` verifies current password by re-signing in (throwaway publishable-key client).

## Public (unauthenticated) surfaces
- `/raise-ticket` — public ticket form (`submitPublicTicket`): Zod validation, title-case normalization, soft numeric captcha, max 5 attachments.
- `uploadPublicTicketAttachment` / `deletePublicTicketAttachment` — public storage upload/delete protected by HMAC-SHA256 signed tokens (keyed by `SUPABASE_SERVICE_ROLE_KEY`), timing-safe compare, MIME whitelist (jpeg/png/webp/heic/heif), ≤8 MB, sanitized extensions, path must start `public/`.

## Server-function hardening
- `requireSupabaseAuth` middleware on every privileged serverFn; `assertAdmin` (has_role RPC) on admin endpoints; service-role client never exposed to browser code.
- `client.server.ts` (service role) only imported server-side; no `server-only` package (TanStack convention: `*.server.ts`).

## Known hardening gaps (documented, not yet fixed)
- Some tables still use permissive `auth.uid() IS NOT NULL` policies (products, serials, quotation settings, invoice_items, eway_bills, delivery_challans) — admin-only writes preferred elsewhere.
- `supabase/config.toml` has no auth provider settings committed; live project config may differ.
- `.env` contains live Supabase credentials and IS tracked in git (from original repo) — see `git.md`; consider untracking/rotating before making repo public.