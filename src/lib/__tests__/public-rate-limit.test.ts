import { describe, it, expect } from "vitest";
import { checkRateLimit } from "@/lib/public-rate-limit";

describe("checkRateLimit", () => {
  it("allows hits up to the cap", () => {
    const hits = new Map<string, number[]>();
    const limit = { windowMs: 60_000, max: 3 };
    expect(checkRateLimit(hits, "k", 1000, limit).allowed).toBe(true);
    expect(checkRateLimit(hits, "k", 2000, limit).allowed).toBe(true);
    expect(checkRateLimit(hits, "k", 3000, limit).allowed).toBe(true);
  });

  it("blocks the hit past the cap and reports retryAfterMs", () => {
    const hits = new Map<string, number[]>();
    const limit = { windowMs: 60_000, max: 2 };
    checkRateLimit(hits, "k", 0, limit);
    checkRateLimit(hits, "k", 10_000, limit);
    const res = checkRateLimit(hits, "k", 20_000, limit);
    expect(res.allowed).toBe(false);
    // oldest hit at t=0 exits the 60s window at t=60000 → retry in 40000ms
    expect(res.retryAfterMs).toBe(40_000);
  });

  it("allows again once the window slides", () => {
    const hits = new Map<string, number[]>();
    const limit = { windowMs: 60_000, max: 1 };
    expect(checkRateLimit(hits, "k", 0, limit).allowed).toBe(true);
    expect(checkRateLimit(hits, "k", 1000, limit).allowed).toBe(false);
    expect(checkRateLimit(hits, "k", 60_001, limit).allowed).toBe(true);
  });

  it("isolates keys from each other", () => {
    const hits = new Map<string, number[]>();
    const limit = { windowMs: 60_000, max: 1 };
    expect(checkRateLimit(hits, "a", 0, limit).allowed).toBe(true);
    expect(checkRateLimit(hits, "a", 1, limit).allowed).toBe(false);
    expect(checkRateLimit(hits, "b", 1, limit).allowed).toBe(true);
  });

  it("prunes stale entries so memory stays bounded", () => {
    const hits = new Map<string, number[]>();
    const limit = { windowMs: 60_000, max: 100 };
    checkRateLimit(hits, "k", 0, limit);
    checkRateLimit(hits, "k", 61_000, limit);
    expect(hits.get("k")).toEqual([61_000]);
  });

  it("does not record blocked hits", () => {
    const hits = new Map<string, number[]>();
    const limit = { windowMs: 60_000, max: 1 };
    checkRateLimit(hits, "k", 0, limit);
    checkRateLimit(hits, "k", 1, limit);
    checkRateLimit(hits, "k", 2, limit);
    expect(hits.get("k")).toEqual([0]);
  });
});
