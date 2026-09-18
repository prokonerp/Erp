# Runbook — Public Ticket Form Hardening

Scope: the unauthenticated `raise-ticket` flow (captcha, uploads, delete tokens)
and its rate limiting. All code changes are already in the repo; this file lists
the **environment variables you must set** and how to verify each behaviour.

Nothing here requires a database write. `scripts/preflight-live.sql` is
read-only.

---

## 1. Environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production +
Preview). Apply them yourself — automation is not permitted to write Vercel env.

### `PUBLIC_TOKEN_HMAC_SECRET` — required

Dedicated HMAC key for captcha challenges **and** staged-upload delete tokens.

- Previously both used `SUPABASE_SERVICE_ROLE_KEY`. That couples two trust
  domains: rotating the service-role key invalidates every outstanding
  captcha/token, and a token-key leak is indistinguishable from a
  service-role leak.
- Value: any random string, **32+ characters**. Generate with:
  `openssl rand -hex 32`
- Behaviour while unset: the code logs a one-time warning and falls back to
  `SUPABASE_SERVICE_ROLE_KEY`, so nothing breaks — but set it.
- Rotating this secret invalidates in-flight captchas (≤5 min) and outstanding
  delete tokens (≤24 h). Acceptable; no user-visible failure.

### `PUBLIC_RATE_LIMIT_FAIL_CLOSED` — optional, default off

The durable limiter is `public.check_public_rate_limit` (migration
`20260928000006`). If that RPC is unreachable, the code falls back to a
per-instance in-memory window — a *soft* limit on serverless.

- Leave unset (or `0`) → fail **open** (availability first). The public form
  keeps working during a database blip.
- Set to `1` → fail **closed**: requests are denied when the durable check
  cannot be performed.

**Only enable `=1` after confirming the RPC exists.** Run
`scripts/preflight-live.sql`; row **25** (`check_public_rate_limit RPC exists`)
must read `true`. If it reads `false`, the migration is missing and enabling
strict mode would block the public form entirely.

### `TRUSTED_IP_HEADER` — optional

Overrides which header supplies the rate-limit bucket key. Default resolution
(pick the first that exists):

1. `TRUSTED_IP_HEADER` (if set)
2. `x-real-ip` — set by Vercel's edge, not client-supplied
3. the **rightmost** `x-forwarded-for` entry

Why not the leftmost `x-forwarded-for` entry: that value is client-writable.
An attacker sending `X-Forwarded-For: <random>` rotates the bucket key and
bypasses the throttle. See `src/lib/__tests__/server-client-ip.test.ts`
("rotating the spoofed first hop does NOT change the bucket key").

Only set this if your platform's authoritative header is something else.

---

## 2. Verify after deploying

```sql
-- Rate-limit hits are being recorded (non-zero after a few form loads):
SELECT count(*) FROM public.public_rate_limit_hits;
```

Then, from a browser on `/raise-ticket`:

1. Submit the form normally → ticket is created.
2. Submit 6 times within 10 minutes → 6th is rejected with the throttle message.
3. Reload and request a challenge repeatedly → throttled after 20 in 10 min.
4. Upload a 6 MB image → rejected with a message naming the **5 MB** cap
   (was previously "8 MB" — the copy now derives from
   `MAX_ACCEPTED_BYTES`).

---

## 3. What changed (for review)

| Area | Before | After |
|---|---|---|
| Token/captcha HMAC key | `SUPABASE_SERVICE_ROLE_KEY` | `PUBLIC_TOKEN_HMAC_SECRET` (fallback retained) |
| Delete token lifetime | never expires | 24 h, expiry inside the HMAC |
| Delete token binding | path only | path **and** expiry |
| Rate-limit key | leftmost `x-forwarded-for` (spoofable) | `x-real-ip` → rightmost `x-forwarded-for` |
| Rate-limit fallback | always in-memory | in-memory by default, deny-when-strict via env |
| Oversize copy | "under 8 MB" (cap is 5 MB) | derives from the real cap |

Rollback: unset the two optional env vars and redeploy. The
`PUBLIC_TOKEN_HMAC_SECRET` change is backwards-compatible, but tokens issued
before it was set stop verifying (≤24 h window).
