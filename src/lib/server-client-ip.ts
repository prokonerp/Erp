// Server-only helper: best-effort client IP for rate-limit keys.
//
// Reads x-forwarded-for (first entry) behind proxies, else x-real-ip.
// NEVER log or persist the return value as-is — it is used only as an
// in-memory rate-limit bucket key (see public-rate-limit.ts).

import { getRequest } from "@tanstack/react-start/server";

export function clientIpKey(): string {
  try {
    const headers = getRequest()?.headers;
    const fwd = headers?.get("x-forwarded-for");
    if (fwd && fwd.trim() !== "") return `ip:${fwd.split(",")[0].trim().slice(0, 64)}`;
    const real = headers?.get("x-real-ip");
    if (real && real.trim() !== "") return `ip:${real.trim().slice(0, 64)}`;
  } catch {
    // Outside request scope (SSR pre-pass / unit context) — shared bucket.
  }
  return "ip:unknown";
}
