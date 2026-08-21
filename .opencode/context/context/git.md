# Git State & Repository Notes

## Current state (as of 2026-08-21)
- **Branch:** `fork` (created from `main` to avoid committing to main).
- **Main branch:** untouched — all local work happens on `fork`.
- **Remote:** `origin → https://github.com/prokonerp/Erp.git` (NEW).
- **Old remote REMOVED:** `gauravarora97/prokon-gatepass.git` — connection to original repo broken. Origin was private; original account `gauravarora97` has no public repos.
- **Recent commit on fork:** `1468dc9 Replace designated owner email with prokonerp@gmail.com` (1 file changed: `supabase/migrations/20260803130516_13dadd82-0a90-4319-b0f8-c9b465459967.sql` — owner email allow-list now `gaurav@prokonhitech.com`, `prokonerp@gmail.com`).
- **Base history:** original repo commits preserved (latest upstream `ca7a0a1 Refactored Summary into tabbed`).

## Important: `.env` is TRACKED in git
- `.env` was committed in the original repo (log: `e5fca4d Changes`, etc.) and is NOT in `.gitignore`.
- It contains live Supabase credentials (URL + publishable keys; `SUPABASE_SERVICE_ROLE_KEY` referenced server-side — check whether the value is present in .env).
- **Risk:** if this repo ever becomes public, credentials leak. Owner said "keep as-is (will update later)" — pending: rotate keys + untrack .env.

## GitHub auth (for push access)
- `gh` CLI logged in with accounts: `prokonerp` (active), `Madav-Verma`, `asofbdattendance-beep`.
- `prokonerp` account is the owner of the new remote `prokonerp/Erp` — verify the repo exists on GitHub before pushing; it was NOT verified as existing at setup time.

## Guidelines for agents
- Work on `fork` unless told otherwise. Never commit directly to `main` (owner preference).
- Do not push unless explicitly asked.
- After tasks, update `.opencode/context/working/status.md` with branch/commit changes.
- Never commit secrets; keep `.env` untouched unless explicitly tasked.