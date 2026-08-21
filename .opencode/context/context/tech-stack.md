# Tech Stack

| Layer | Technology |
|---|---|
| Framework | **TanStack Start** (`@tanstack/react-start` ^1.167) — full-stack React with SSR |
| UI | **React 19.2** (`react`, `react-dom`) |
| Routing | **TanStack Router** (^1.168) — file-based; route tree auto-generated at `src/routeTree.gen.ts` |
| Data fetching | **TanStack Query** (^5.83) — QueryClient per router instance |
| Styling | **Tailwind CSS v4** (`@tailwindcss/vite` ^4.2) + **shadcn/ui** (`components.json`, new-york style) + Radix UI + `tw-animate-css` + `sonner` toasts |
| Validation | **Zod** (^4.4) — MCP tool schemas + server-function input validators |
| Auth / Backend | **Supabase** (`@supabase/supabase-js` ^2.105) — Auth (email+password), Postgres (RLS), Storage (ticket-attachments bucket) |
| Build tool | **Vite 7** with `@cloudflare/vite-plugin` ^1.25 |
| Server runtime | **Nitro** (beta `3.0.260603-beta`) — TanStack Start's server on Cloudflare Workers |
| Package manager | **Bun** (`bun.lock`, `bunfig.toml`) — note: `minimumReleaseAge = 86400` guard, Lovable packages exempt |
| MCP | `@lovable.dev/mcp-js` ^0.26 + `@lovable.dev/vite-tanstack-config` (2.13.1) — Lovable scaffolding + MCP server |
| Feature libs | react-hook-form, recharts, xlsx (CSV/Excel), jspdf + jspdf-autotable, html2canvas, qrcode, pdfjs-dist, date-fns, cmdk, vaul, input-otp, react-resizable-panels, embla-carousel-react |

Project template: **Lovable-generated TanStack Start TS template** (`.lovable/project.json` → `tanstack_start_ts_2026-05-12`).

## Key config files

- `vite.config.ts` — wraps `@lovable.dev/vite-tanstack-config` (tanstackStart, react, tailwind, tsconfig paths, cloudflare build-only, componentTagger dev-only, VITE_* env injection, `@` → `./src` alias, MCP plugin `mcpPlugin()` auto-generates MCP routes + `.lovable/mcp/manifest.json`). Server entry redirected to `src/server.ts`.
- `wrangler.jsonc` — Cloudflare Worker: name `tanstack-start-app`, compatibility `2025-09-24`, flags `["nodejs_compat"]` (needed for crypto/Buffer), main `src/server.ts`.
- `tsconfig.json` — ES2022, `react-jsx`, bundler resolution, strict, noEmit, `@/* → ./src/*`.
- `bunfig.toml` — supply-chain guard (24h minimum release age).
- `supabase/config.toml` — `project_id = "vimkodursmcsaptrrzbl"` only.
- `eslint.config.js` — ESLint 9 + typescript-eslint + Prettier; blocks `server-only` package imports (TanStack Start convention: `*.server.ts` files).

## Conventions to respect

- Server functions: `createServerFn()` in `src/lib/*.functions.ts`, protected with `requireSupabaseAuth` middleware from `src/integrations/supabase/auth-middleware.ts`.
- Server-only files named `*.server.ts` (e.g., `client.server.ts`).
- Route files under `src/routes/` (file-based), `_app` layout wraps authenticated pages.
- Client Supabase singleton: `src/integrations/supabase/client.ts` (lazy Proxy init, localStorage session).
- Server admin client (service role, bypasses RLS): `src/integrations/supabase/client.server.ts`.