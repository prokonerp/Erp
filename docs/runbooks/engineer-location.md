# Runbook — Engineer Location Tracking

## Apply order (manual — never automated)

1. `20260928000001_engineer_location_tracking.sql` — 6 tables, RLS, realtime publication.
2. `20260928000002_engineer_location_retention_rollup.sql` — haversine, rollup fn, rollup + purge cron.
3. `20260928000003_engineer_location_rls_hardening.sql` — cross-engineer reads admin-only.
4. `20260928000004_engineer_location_completeness.sql` — spoof flags, kill switch, session reaper.

Supabase Dashboard → SQL editor → paste each file → Run, in order. All four are idempotent (safe to re-run).

## Verify after apply

```sql
-- tables
SELECT tablename FROM pg_tables WHERE tablename LIKE 'engineer_%';
-- realtime
SELECT tablename FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime' AND tablename = 'engineer_live_status';
-- cron (rollup 01:00 IST, purge 01:30 IST, reaper every 15 min)
SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'engineer-%';
-- RLS hardening: expect ZERO rows
SELECT policyname FROM pg_policies
 WHERE tablename LIKE 'engineer_%'
   AND (qual LIKE '%has_permission%' OR with_check LIKE '%has_permission%');
```

Then PostgREST (required after hand-applied migrations):

```sql
NOTIFY pgrst, 'reload schema';
```

Confirm in the browser: the Movement page's `engineer_live_status` REST call returns 200.

## Cron health

- Rollup ran: `SELECT employee_id, day, rolled_up_at FROM engineer_daily_movements ORDER BY rolled_up_at DESC LIMIT 5;`
- Purge working: `SELECT count(*), min(received_at) FROM engineer_location_pings;` (min should stay within ~30 days).
- Reaper working: `SELECT count(*) FROM engineer_duty_sessions WHERE ended_at IS NULL;` should drain overnight.

## Kill switch

`engineer_location_settings`, row `id = 1`. `tracking_enabled = false` → gate passes through, duty start and pings refuse with `TRACKING_DISABLED`, admin toggle on the Movement page (audited to `engineer_admin_audit`). Use it before any risky deploy, and as the instant rollback.

## Overrides

Movement → roster row → Override… → 15/30/60/120 min + mandatory reason. Visible with expiry; revocable. Audited (`gate-override.grant` / `gate-override.revoke`).

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| Roster 400 / "not set up yet" | Migration missing or stale PostgREST cache | Apply order above, then `NOTIFY pgrst, 'reload schema';` |
| `WebSocket is closed before established` | Channel churn (old builds) / blocked WS | Current build uses one shared channel; check network allows `wss://` |
| Blank map, list works | Tiles blocked or CSS missing | Check tile request in Network; `leaflet.css` ships with the bundle |
| Permanent "Checking location…" | Dismissed browser prompt | "Enable location" button re-prompts (fixed build) |
| Engineer blocked despite GPS on | Stale `last_seen_at` from delayed flush | Fixed via monotonic liveness; "Try again" forces a fresh read |
| Consent accepted but duty won't start | Stale client state | Fixed via refresh-before-start; reload the page as fallback |
| Orphan on-duty rows (pre-fix data) | Old `recordPings` flipped `on_duty` | Next ping self-heals; reaper clears idle sessions every 15 min |

## Rollback

1. Kill switch OFF (instant, no redeploy).
2. If needed: unschedule the three cron jobs, then drop the six tables in dependency order (pings → live_status → overrides → rollup output → consent → sessions), drop the two functions. See the ADR for the exact order.
