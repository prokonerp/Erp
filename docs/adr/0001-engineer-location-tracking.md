# ADR-0001: Engineer Location Tracking (On-Duty Only, BYOD)

**Status:** Accepted
**Date:** 2026-09-18
**Deciders:** Product + Engineering

## Context

Field engineers asked for a fair attendance/conveyance story and admins need
to know who is on duty and where they were during duty hours. Phones are
employee-owned (BYOD, India — DPDP Act 2023 applies), so tracking must be
consent-gated, on-duty-only, and visibly restrained: no background tracking,
no off-duty data, no self-map shown to the engineer.

## Problem

Without any location signal, duty attendance and site-visit claims are
unverifiable, and conveyance disputes have no ground truth. A naive
always-on tracker would violate consent law, destroy trust, and bloat
storage.

## Decision

- Track **only while explicitly On-duty** (session start/stop by the
  engineer). No background tracking, ever.
- Browser `watchPosition`, throttled to **≥45s OR ≥100m**; pause on
  `visibilitychange`; offline queue in IndexedDB, exactly-once via
  `client_ping_id` upsert.
- Raw pings kept **30 days**, then purged; permanent per-day rollup
  (distance, stops, site list) computed on IST calendar days.
- Event breadcrumbs (arrive/depart/FSR/photo) carry a one-shot geo fix via
  the existing `getCurrentGeo()` helper.
- **Transparent gate:** engineer write paths require a fresh on-duty fix;
  the blocking message is exactly
  "Turn on GPS and internet, then try again." Server-enforced
  (`requireFieldLocation`), fail-closed, with a **time-boxed manager
  override** (5–120 min, reason required, audit-logged) for genuine dead
  zones (basements/server rooms).
- Admin sees "last seen X ago", never a fake live dot. Realtime on
  `engineer_live_status` with polling fallback.
- New realtime infrastructure: `supabase_realtime` publication gains
  `engineer_live_status`; pg_cron jobs for rollup (01:00 IST) + purge
  (01:30 IST).
- New dependency: `leaflet` + `react-leaflet@^5` (React 19 requires v5)
  + `@types/leaflet`, OSM tiles, client-only import. First map dependency
  in the repo.
- New offline-sync surface: IndexedDB queue is the project's first
  client-side outbox (flush ≤50 ordered by `captured_at`, idempotent).

## Alternatives Considered

1. **Do nothing** — keep attendance/conveyance unverified. Rejected: the
   disputes this unblocks are the reason for the feature.
2. **Always-on background tracking** — rejected: BYOD + DPDP consent,
   battery, trust. Also technically unreliable on mobile web.
3. **Native app with background GPS** — rejected: cost and deployment
   overhead for a 10-engineer team; web is sufficient for on-duty use.
4. **No gate, tracking advisory-only** — rejected: without server
   enforcement the data cannot be trusted for attendance/pay.

## Reasons

- On-duty-only + consent dialog + immutable consent log satisfies DPDP
  consent requirements with the smallest possible data footprint.
- Throttle + 30-day purge bounds storage (~20 MB for 10 engineers/month).
- Mirroring proven repo patterns (`requireActiveUser`,
  `useActivityTracker` heartbeat, `useRealtimeRefetch` debounce,
  `VisitTimesBar` conditional updates) keeps the new code idiomatic.
- Fail-closed + manager override balances anti-fraud against the basement
  reality without a support trap.

## Trade-offs

- Gain verifiable duty/visit truth; lose some engineer privacy comfort —
  mitigated by consent + on-duty-only + no self-trail UI.
- Gain a map dependency (bundle + maintenance); keep it isolated to the
  Movement tab behind a client-only import so the rest of the app is
  unaffected.
- Mock GPS on web cannot be reliably blocked — record accuracy + skew and
  flag for review instead of pretending otherwise.

## Consequences

### Positive

- Duty sessions, live roster, day routes, and visit breadcrumbs become
  queryable ground truth for attendance and conveyance review.
- Gate message is honest and actionable; override path is audited.

### Negative

- Engineers must keep the app open and GPS on while on duty; backgrounded
  tabs produce gaps (rendered as "last seen", never faked).
- iOS Safari background throttling limits "live" fidelity.

### Risks

- pg_cron must be enabled on prod (present in `setup_new_supabase.sql`,
  absent from `config.toml`) — verify before relying on rollup/purge.
  Mitigation: rollup function is manually runnable; admin UI tolerates
  missing rollup rows.
- Realtime must honour RLS for the new table — verify as an engineer that
  only the own row streams.

## Migration / Rollback

- Forward: apply `20260928000001_engineer_location_tracking.sql` then
  `20260928000002_engineer_location_retention_rollup.sql` (additive only,
  idempotent, no backfill). Prepared as files for manual application —
  no automated Supabase writes.
- Rollback (additive-only, safe): `DROP TABLE` the six new tables in
  dependency order (pings → live_status → overrides → rollup →
  consent → sessions), `DROP FUNCTION` rollup/haversine, remove cron
  jobs, remove `engineer_live_status` from the realtime publication.
  Client code degrades via existing "not set up yet" hints.

## Related Decisions

- None (first ADR in `docs/adr/`).
