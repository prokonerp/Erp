// Server-only helper: best-effort client IP for rate-limit keys.
//
// SPOOFING NOTE (why this is not `x-forwarded-for.split(",")[0]`):
// `x-forwarded-for` is client-writable. A caller can send
// `X-Forwarded-For: 1.2.3.4` and, when a proxy appends rather than replaces,
// the header becomes `1.2.3.4, <real client ip>`. Reading the FIRST entry
// therefore hands the attacker the rate-limit bucket key — rotate the header
// value and the per-IP throttle is bypassed.
//
// Preference order (see pickClientIp):
//   1. TRUSTED_IP_HEADER (env) — the platform's authoritative header.
//   2. `x-real-ip` — set/overwritten by Vercel's edge, not client-supplied.
//   3. RIGHTMOST `x-forwarded-for` entry — appended by the closest (trusted)
//      proxy, not the client-controlled left-hand entries.
//
// NEVER log or persist the return value as-is — it is used only as a
// rate-limit bucket key (see public-rate-limit.ts).

import { getRequest } from "@tanstack/react-start/server";

function trimIp(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  return t === "" ? null : t.slice(0, 64);
}

/** Alias of `Headers.get` — injected so this is unit-testable. */
export type HeaderGetter = (name: string) => string | null;

/**
 * Pure IP selection. Returns a `ip:<value>` bucket key, or `ip:unknown` when
 * no trustworthy header is present (callers must treat `ip:unknown` as a
 * shared bucket, never as an identity).
 */
export function pickClientIp(get: HeaderGetter, trustedHeader?: string | null): string {
  const trusted = (trustedHeader || "").trim().toLowerCase();
  if (trusted) {
    const v = trimIp(get(trusted));
    if (v) return `ip:${v}`;
  }

  const real = trimIp(get("x-real-ip"));
  if (real) return `ip:${real}`;

  const fwd = get("x-forwarded-for");
  if (fwd && fwd.trim() !== "") {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    const rightmost = parts.length > 0 ? parts[parts.length - 1] : null;
    if (rightmost) return `ip:${rightmost.slice(0, 64)}`;
  }

  return "ip:unknown";
}

export function clientIpKey(): string {
  try {
    const headers = getRequest()?.headers;
    return pickClientIp((name) => headers?.get(name) ?? null, process.env.TRUSTED_IP_HEADER);
  } catch {
    // Outside request scope (SSR pre-pass / unit context) — shared bucket.
    return "ip:unknown";
  }
}
