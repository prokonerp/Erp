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
