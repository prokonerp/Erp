# ADR-0002: Road-Route Resilience (Cache + Circuit Breaker + Session Budget)

**Status:** Accepted
**Date:** 2026-09-23
**Deciders:** Product + Engineering

## Context

ADR-0001 shipped engineer movement on Leaflet + OSM with client-side OSRM
road-snapping (`src/lib/roadRoute.ts`: match → route → raw, chunked, per-call
request cap). The service path had no persistence and no failure policy: every
page load re-hit the public OSRM demo, transport failures were swallowed one
chunk at a time with no memory, and nothing bounded spend/quota per session
longer than a single call. As the Movement tab gained admin trail replay, the
cost of a flapping or rate-limited service grew.

## Problem

Without guardrails, a slow/limited OSRM endpoint turns day routes into silent
straight-line fallbacks (or hammering), a reload always costs fresh requests,
and the UI has no honest way to say *why* geometry is straight. The public
demo is free but rate-limited by shared IP — exhaustion is a real failure mode
that must degrade gracefully, never blank the map.

## Decision

Layer three guardrails inside `fetchRoadRoute`, all never-throwing, ordered
**cache → circuit → budget → network**:

1. **Persistent cache** — matched geometry keyed by `hashTrace(points)` in
   `localStorage` (`osrm-road-cache:v1`): TTL 7 days, ≤50 entries, ≤150 KB per
   entry, quota/blocked storage fail soft (cache off). Costs zero budget.
2. **Circuit breaker** — 3 consecutive transport failures (network error,
   5xx) → open 60 s; HTTP 429 honours `Retry-After`, else opens 5 min.
   While open: zero network, raw geometry, `degraded: "service"`.
3. **Session request budget** — default 20 network requests per page session
   (`VITE_OSRM_MAX_REQUESTS`); over budget → raw + `degraded: "budget"`.

Result type gains `degraded?: "cache" | "budget" | "service"` so callers can
stay honest: `useRoadRoute`/`useRouteLegs` surface it, and the Movement map
caption shows *"Road matching paused (service limit) — showing straight
lines"* for `budget`/`service` only (`cache` is benign). The three-tier
match → route → raw fallback is unchanged beneath the guardrails.

**ADR-0001 explicitly upheld:** admin pins remain "last seen" positions (no
live dot), marker motion is a throttled UI *transition* between fixes
(`useAnimatedLatLng`), and the new trail replay is **admins only** (Movement
tab) — no engineer-facing self-trail UI, no policy/consent change.

## Alternatives Considered

1. **Do nothing** — reload hammering + silent straight lines as the feature
   grows. Rejected: quota exhaustion is expected on the public demo.
2. **Server-side snapping proxy** (budget/circuit in Postgres/edge) —
   rejected for now: adds a service hop and secrets to a read-only display
   path; client guardrails cover a 10-engineer roster. Revisit if a paid
   API key is introduced.
3. **Google Roads/Directions API** — real quotas and per-request cost, but a
   paid dependency + key handling; product chose to harden free OSRM.

## Reasons

- Cache-first ordering makes repeat views free and is invisible to provenance
  (`matched` still reports how the geometry was produced).
- Circuit + budget share one `degraded` channel the UI already needed for the
  honest "straight-line" caption — one concept, not three.
- Per-chunk tiers untouched → all 32 pre-existing `roadRoute` tests pass
  without modification; 7 new guardrail tests pin the new behaviour.

## Trade-offs

- Gain bounded spend and honest degradation; lose "always freshest" geometry
  within the 7-day TTL (acceptable: historical day routes are immutable).
- Gain a module-level singleton (per-page-session state) — resets on reload
  by design; `resetGuardrails()` exists for tests/HMR only.

## Consequences

### Positive
- Reload of a previously viewed day: 0 OSRM requests.
- Service outage/ratelimit: immediate raw fallback + visible caption, never a
  hung map or request storm.

### Negative
- `localStorage` growth bounded but real (~50 entries); privacy-mode browsers
  simply run without cache.
- Session budget (20) is per tab load — long admin sessions on many distinct
  engineers may hit it and see straight lines until reload.

### Risks
- Public demo IP bans → circuit stays open up to 5 min; mitigation: raw
  fallback + caption, and `VITE_OSRM_BASE_URL` for self-hosted OSRM raises
  both limits.

## Migration / Rollback

No schema, no env required (optional `VITE_OSRM_MAX_REQUESTS`). Rollback:
revert the `roadRoute.ts` guardrail block; callers tolerate a return type
without `degraded` only if hooks are reverted together — ship as one commit.

## Related Decisions

- ADR-0001 — Engineer Location Tracking (On-Duty Only, BYOD): live-dot ban
  and admin-only surfaces reaffirmed above.
