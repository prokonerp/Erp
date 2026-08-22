# Deployment & Environment

## Deployment topology
- **Vercel** — TanStack Start SSR app (Nitro `vercel` preset, GitHub integration with `github.com/prokonerp/Erp`). Build: `bun run build`; `NITRO_PRESET` overrides the default target.
- **Supabase** — managed backend (`cqjmcfwsrljxhixzfgpk`), schema via 145 migrations (`supabase/migrations/`).
- **No in-repo CI/CD** — deploys are driven by Vercel's GitHub integration on push to `main`.

## Environment variables (names & roles — values live in `.env`, which is git-untracked)

| Variable | Role |
|---|---|
| `SUPABASE_PROJECT_ID` | Supabase project ref (also in `supabase/config.toml`) |
| `SUPABASE_URL` | Supabase API URL (server-side use) |
| `SUPABASE_PUBLISHABLE_KEY` | Anon/publishable key (server-side fallback) |
| `VITE_SUPABASE_PROJECT_ID` | Project ref exposed to client bundle |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key exposed to client bundle (browser client) |
| `VITE_SUPABASE_URL` | URL exposed to client bundle |
| `SUPABASE_SERVICE_ROLE_KEY` | **Service role key — bypasses RLS. Server-side only** (`client.server.ts`, HMAC secret for public uploads). Never in client code. |
| `OLD_SUPABASE_URL` / `OLD_SUPABASE_ANON_KEY` | Old Lovable Cloud project (read-only) — only used by one-off migration scripts; can be removed once they're retired |

Notes:
- `.env` is **not tracked in git** (in `.gitignore`). `.env.example`-style documentation lives in this table.
- VITE_* vars are inlined into the client bundle at build time — they must be present in the Vercel project's build environment.

## Vercel setup (one-time, dashboard)
1. Import `github.com/prokonerp/Erp`; Framework Preset: **Other**; Build Command: `bun run build`.
2. Add env vars (Production + Preview) from `.env`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (secret), `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`.
3. Supabase Auth → URL Configuration: Site URL = the Vercel app URL; add the Vercel domain to Additional Redirect URLs, plus `http://localhost:8080` for local dev.

## Build & run
- Package manager: **Bun** (`bun.lock`). Run `bun install`, `bun run dev` (port 8080), `bun run build`.
- Build output: `.vercel/output/` (Vercel Build Output API, via Nitro `vercel` preset). Default target is Vercel; override with `NITRO_PRESET=node-server bun run build` for a plain Node build.
- Local preview of a built app: `npx srvx --static .vercel/output/static .vercel/output/functions/__server.func/index.mjs` (per `.vercel/output/nitro.json`).

## Data migration (completed 2026-08)
- Old Lovable Cloud Supabase (`vimkodursmcsaptrrzbl`) → new project (`cqjmcfwsrljxhixzfgpk`).
- `scripts/`: `extract-old-data.mjs` (export), `import-data.mjs` (import + sequence bumps), `create-users.mjs` (auth users/profiles), `set-passwords.mjs`, `verify-migration.mjs` (row-count + special checks; report in `data/verify-report.md`).
- Business data snapshots live in `data/export/` — gitignored (`data/`).

## Supabase migrations workflow
- Schema changes: add new SQL file under `supabase/migrations/` with timestamp prefix (e.g., `20260822..._name.sql`).
- Existing migrations must not be edited after being applied to the live DB.