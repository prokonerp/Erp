-- 20260929000001_gsp_integration.sql
-- GSP integration: non-secret routing config + an auditable call log.
--
-- AUTHOR ONLY — this harness must never push to Supabase. Apply via the
-- Supabase SQL editor (Dashboard → SQL → New query), then run the verification
-- queries at the bottom.
--
-- Design notes
-- ------------
-- * Credentials are NOT here. GSP username/password/token live in server
--   environment variables (GSP_USERNAME / GSP_PASSWORD / …). This table
--   holds only non-secret routing config so it can be audited and changed
--   without redeploying a secret. See docs/adr/0003-gsp-mock-first.md.
-- * gsp_api_log deliberately grants nothing to anon/authenticated. It can
--   contain request/response bodies, and a call log is a server-side
--   forensic aid, not a client feature.
-- * `invoices.irn` is already `text unique` (migration
--   20260902000000_invoicing_staged.sql), so this migration does NOT add a
--   second unique index — that would be a duplicate object. Postgres unique
--   already permits many NULLs, which is what the cleanup migration needs.

-- ── 1. Routing config ──────────────────────────────────────────────────────
create table if not exists public.gsp_settings (
  id                 uuid primary key default gen_random_uuid(),
  branch_id          uuid references public.branches(id) on delete cascade,
  user_gstin         text not null,
  environment        text not null default 'sandbox'
                       check (environment in ('sandbox', 'production')),
  base_url           text not null default 'https://sandb-api.mastersindia.co',
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_gstin, environment)
);

comment on table public.gsp_settings is
  'Non-secret GSP routing config (GSTIN, environment, base URL). Credentials are environment variables, never stored here.';

create index if not exists idx_gsp_settings_branch on public.gsp_settings (branch_id);

drop trigger if exists trg_gsp_settings_updated_at on public.gsp_settings;
create trigger trg_gsp_settings_updated_at
  before update on public.gsp_settings
  for each row execute function public.touch_updated_at();

alter table public.gsp_settings enable row level security;

-- Non-secret: any signed-in user may read the active routing config so the UI
-- can display the environment badge. Writes are admin-only.
drop policy if exists "view gsp_settings" on public.gsp_settings;
create policy "view gsp_settings" on public.gsp_settings
  for select to authenticated using (true);

drop policy if exists "admins manage gsp_settings" on public.gsp_settings;
create policy "admins manage gsp_settings" on public.gsp_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- ── 2. Call log ────────────────────────────────────────────────────────────
-- Every attempt, success or failure. This is the audit trail for statutory
-- documents: "who asked for this IRN, when, and what did the GSP say?"
create table if not exists public.gsp_api_log (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid references public.invoices(id) on delete cascade,
  operation     text not null,
    -- auth | generate_irn | cancel_irn | gen_ewb_by_irn | get_einvoice_by_doc
    -- | get_einvoice_by_irn | get_ewb_by_irn | get_gstin_details
  endpoint      text not null,
  http_status   int,
  ok            boolean not null default false,
  gsp_code      text,
  error_message text,
  request_id    text,
  request_body  jsonb,
  response_body jsonb,
  duration_ms   int,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.gsp_api_log is
  'GSP call audit trail. Redact tokens, passwords, SignedInvoice and SignedQRCode before insert — the QR payload is a signed legal artifact and belongs on invoices.qr_payload only.';

create index if not exists idx_gsp_api_log_invoice on public.gsp_api_log (invoice_id, created_at desc);
create index if not exists idx_gsp_api_log_op      on public.gsp_api_log (operation, created_at desc);
create index if not exists idx_gsp_api_log_failed  on public.gsp_api_log (created_at desc) where ok = false;

alter table public.gsp_api_log enable row level security;

-- Intentionally NO select/insert policies: the table is server-only.
-- service_role bypasses RLS, which is how the server functions write here.

-- ── 3. Grants ──────────────────────────────────────────────────────────────
grant select on public.gsp_settings to authenticated;
grant all    on public.gsp_settings to service_role;
grant all    on public.gsp_api_log   to service_role;

-- Defence in depth: even if the Data API exposes the table, clients get nothing.
revoke all on public.gsp_api_log from anon, authenticated;

-- ── 4. Verification (run after applying) ───────────────────────────────────
-- Expect 2 rows.
-- select table_name from information_schema.tables
--  where table_schema = 'public' and table_name in ('gsp_settings', 'gsp_api_log');
--
-- Expect true for rls_enabled on both.
-- select relname, relrowsecurity from pg_class
--  where relname in ('gsp_settings', 'gsp_api_log');
