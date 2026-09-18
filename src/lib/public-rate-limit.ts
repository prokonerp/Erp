// In-memory sliding-window rate limiter for the public (unauthenticated)
// raise-ticket server functions.
//
// Pure module: the hit store is an injected Map, so it unit-tests without
// timers and the server layer owns the singleton lifetime. Stale timestamps
// are pruned on every check, which keeps memory bounded without a sweeper.
//
// NOTE: counts live per server instance. On multi-instance / serverless
// deployments a cold start resets counters — the captcha HMAC (see
// public-captcha.ts) still holds cryptographically, so this degrades to a
// softer limit rather than an open gate.

export type RateLimit = {
  /** sliding window length in ms */
  windowMs: number;
  /** max allowed hits inside the window */
  max: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** ms until the oldest hit exits the window (0 when allowed) */
  retryAfterMs: number;
};

export function checkRateLimit(
  hits: Map<string, number[]>,
  key: string,
  nowMs: number,
  limit: RateLimit,
): RateLimitResult {
  const windowStart = nowMs - limit.windowMs;
  const fresh = (hits.get(key) ?? []).filter((t) => t > windowStart);
  if (fresh.length >= limit.max) {
    const oldest = Math.min(...fresh);
    hits.set(key, fresh);
    return { allowed: false, retryAfterMs: Math.max(0, oldest + limit.windowMs - nowMs) };
  }
  fresh.push(nowMs);
  hits.set(key, fresh);
  return { allowed: true, retryAfterMs: 0 };
}

// ---------------------------------------------------------------------------
// Durable (Postgres-backed) check for serverless deployments.
//
// The in-memory Map above resets on every cold start / instance, so per-IP
// throttles are soft on Vercel. Migration 20260928000006 adds a
// public.check_public_rate_limit RPC over public.public_rate_limit_hits
// (service_role-only). This wrapper prefers the RPC and falls back to the
// pure in-memory check when the RPC is unreachable or malformed —
// checkRateLimit itself is untouched so unit tests stay timer-free.
//
// `client` is typed unknown so the real Supabase client type never leaks
// into this module; pass supabaseAdmin (or null outside request scope).
// ---------------------------------------------------------------------------

function parseRateLimitVerdict(data: unknown): RateLimitResult | null {
  const raw = typeof data === "string" ? tryParseJson(data) : data;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const allowed = rec.allowed;
  if (typeof allowed !== "boolean") return null;
  const retryRaw = rec.retry_after_ms ?? rec.retryAfterMs ?? rec.retry_after;
  const retryAfterMs =
    typeof retryRaw === "number" && Number.isFinite(retryRaw)
      ? Math.max(0, Math.round(retryRaw))
      : 0;
  return { allowed, retryAfterMs: allowed ? 0 : retryAfterMs };
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function checkRateLimitDurable(
  client: unknown,
  hits: Map<string, number[]>,
  key: string,
  nowMs: number,
  limit: RateLimit,
  opts?: { onError?: "open" | "closed" },
): Promise<RateLimitResult> {
  // When the durable store is unreachable the in-memory map is per-instance,
  // so on serverless it is a soft limit at best. `strict` (explicit opt-in via
  // PUBLIC_RATE_LIMIT_FAIL_CLOSED=1, or per-call `onError: "closed"`) denies
  // instead — only enable it once public.check_public_rate_limit exists on the
  // database (scripts/preflight-live.sql reports this), otherwise the public
  // form would be blocked by a missing RPC.
  const strict =
    opts?.onError === "closed" || (process.env.PUBLIC_RATE_LIMIT_FAIL_CLOSED || "") === "1";

  const rpc = (client as { rpc?: unknown } | null | undefined)?.rpc;
  if (typeof rpc !== "function") {
    if (strict) {
      console.warn("[public-rate-limit] no durable client — denying (strict mode)");
      return { allowed: false, retryAfterMs: limit.windowMs };
    }
    return checkRateLimit(hits, key, nowMs, limit);
  }
  try {
    const res = (await (
      rpc as (
        fn: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>
    ).call(client, "check_public_rate_limit", {
      p_key: key,
      p_window_seconds: Math.max(1, Math.round(limit.windowMs / 1000)),
      p_max: limit.max,
    })) as { data: unknown; error: { message?: string } | null };
    if (res?.error) throw new Error(res.error.message || "rate-limit RPC failed");
    const verdict = parseRateLimitVerdict(res?.data);
    if (!verdict) throw new Error("malformed rate-limit RPC result");
    // Mirror the verdict locally so a later RPC outage falls back warm.
    const windowStart = nowMs - limit.windowMs;
    const fresh = (hits.get(key) ?? []).filter((t) => t > windowStart);
    if (verdict.allowed) fresh.push(nowMs);
    hits.set(key, fresh);
    return verdict;
  } catch (e) {
    if (strict) {
      console.warn("[public-rate-limit] durable check failed — denying (strict mode):", e);
      return { allowed: false, retryAfterMs: limit.windowMs };
    }
    console.warn("[public-rate-limit] durable check failed, in-memory fallback:", e);
    return checkRateLimit(hits, key, nowMs, limit);
  }
}
