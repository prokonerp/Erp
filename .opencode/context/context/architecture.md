# Architecture

## Deployment topology

```
┌──────────────┐        ┌──────────────────────────────────┐        ┌──────────────────┐
│   Browser    │ ─────► │  Cloudflare Worker (Nitro SSR)   │ ─────► │     Supabase     │
│ React 19 app │  HTTPS │  src/server.ts → TanStack Start  │        │  Postgres + RLS  │
│ (TanStack    │        │  SSR pages + Server Functions    │        │  Auth + Storage  │
│  Router)     │        └──────────────────────────────────┘        └──────────────────┘
└──────────────┘
```

- **Frontend/SSR:** Cloudflare Worker via `@cloudflare/vite-plugin` + `wrangler.jsonc`. Secrets injected at deploy time (`.dev.vars` gitignored; not committed).
- **Backend:** Supabase managed (`https://vimkodursmcsaptrrzbl.supabase.co`) — Postgres with RLS, Auth, Storage.
- **No CI/CD in-repo** — no `.github`; deployments driven by Lovable Cloud pipeline.

## Server entry points

- `src/start.ts` — `createStart()` wiring global middleware:
  - `functionMiddleware: [attachSupabaseAuth]` — client-side; attaches `Authorization: Bearer <session.access_token>` to every Server Function RPC.
  - `requestMiddleware: [errorMiddleware]` — SSR-level try/catch → branded 500 HTML page.
- `src/server.ts` — Cloudflare Worker `fetch` handler. Lazily imports `@tanstack/react-start/server-entry`; normalizes catastrophic SSR errors (`{"unhandled":true,"message":"HTTPError"}`) into branded error page; `error-capture.ts` records uncaught exceptions out-of-band.
- `src/router.tsx` — builds QueryClient + `createRouter` with generated routeTree, scroll restoration, default error component.

## Three data paths (important!)

**A. Direct browser → Supabase (RLS as signed-in user)** — most list/detail pages.
`useQuery` → `supabase.from("invoices").select(...)` directly from browser using anon/publishable key + live session. RLS enforces row-level access.

**B. Browser → Worker Server Function → Supabase ADMIN (service role, bypasses RLS)** — privileged/trusted ops.
`createServerFn()` + `supabaseAdmin` from `client.server.ts` (`SUPABASE_SERVICE_ROLE_KEY`). Examples: `admin-users.functions.ts`, `public-tickets.functions.ts` (no auth), `public-ticket-uploads.functions.ts` (HMAC-signed delete tokens).

**C. Browser → Worker Server Function → Supabase as VERIFIED USER (RLS intact)** — guarded by `requireSupabaseAuth` middleware.
Context gets `{ supabase (user-scoped), userId, claims }`. Example: `indent.functions.ts`, admin functions.

## Authentication flow (end-to-end)

1. Login: `src/routes/auth.tsx` → `supabase.auth.signInWithPassword({ email, password })`.
2. Client: `client.ts` — `localStorage` session, `persistSession: true`, `autoRefreshToken: true`.
3. `src/lib/useAuth.ts` — subscribes `onAuthStateChange`, exposes `{ session, loading }`, resets permissions cache on auth change, records login/logout activity.
4. `_app` layout guards all app routes: no session → `<Navigate to="/auth" />`.
5. Token attach (client): `auth-attacher.ts` global functionMiddleware → `Authorization: Bearer <token>` on every serverFn RPC.
6. Token verify (server): `auth-middleware.ts` `requireSupabaseAuth` — requires Bearer, creates client with token, `supabase.auth.getClaims(token)` → injects `{ supabase, userId, claims }`.
7. Authorization: RBAC layer (`usePermissions` / `useRole` / `permissions.ts`) — `can(module, action)` + admin via `has_role` RPC.
8. Idle timeout: `IdleTimeout` component — 30 min inactivity → marks `sessionStorage["idle-session-expired"]` → force re-login.

## MCP server (AI tool integration)

- Endpoints: `/mcp` (`src/routes/mcp.ts`, `createTanStackMcpHandler`), `/.mcp/list-tools`, `/.mcp/invoke-tool/$tool`, `/.well-known/oauth-protected-resource`, `/.lovable/oauth/consent`.
- Definition: `src/lib/mcp/index.ts` — `defineMcp({ name: "prokon-erp", title: "Prokon ERP", version: "0.1.0" })`, OAuth issuer = `https://<projectRef>.supabase.co/auth/v1`, `acceptedAudiences: "authenticated"`.
- Auth: `src/lib/mcp/supabase.ts` `supabaseForUser(ctx)` — forwards verified OAuth token as Bearer so queries run under RLS as that user.
- Tools (read-only): `list_tickets`, `get_ticket`, `list_invoices`, `list_tickets`, `search_customers`, `stock_lookup`.

## Page render flow (SSR)

Browser → Cloudflare Worker (`server.ts`) → TanStack Start SSR → route loaders/components → (optionally) Server Functions → Supabase → HTML/JS back to browser, then hydrates and becomes SPA.