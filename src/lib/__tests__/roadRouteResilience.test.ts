/**
 * Guardrail tests for src/lib/roadRoute.ts — persistent cache, circuit
 * breaker, session request budget, 429/Retry-After handling.
 *
 * Vitest env is "node" (no localStorage) — a minimal in-memory stub is
 * installed here so the persistent cache path is actually exercised.
 * No real network: every fetch is spied.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CIRCUIT_FAILURE_THRESHOLD,
  fetchRoadRoute,
  resetGuardrails,
  type LatLng,
} from "@/lib/roadRoute";

// ---------------------------------------------------------------------------
// localStorage stub (node env)
// ---------------------------------------------------------------------------

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

type StorageHost = { localStorage?: unknown };
const host = globalThis as StorageHost;
const hadStorage = "localStorage" in globalThis;
const originalStorage = host.localStorage;
host.localStorage = new MemoryStorage();

afterAll(() => {
  if (hadStorage) host.localStorage = originalStorage;
  else delete host.localStorage;
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PTS: LatLng[] = [
  [28.6, 77.2],
  [28.7, 77.3],
];

/** Distinct trace → distinct cache key (offset so keys never collide). */
function offsetPts(n: number): LatLng[] {
  return [
    [28.6 + n * 0.01, 77.2 + n * 0.01],
    [28.7 + n * 0.01, 77.3 + n * 0.01],
  ];
}

function okMatch(): Response {
  return new Response(
    JSON.stringify({
      code: "Ok",
      matchings: [
        {
          confidence: 0.9,
          legs: [],
          geometry: {
            coordinates: [
              [77.2, 28.6],
              [77.3, 28.7],
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function noMatch(): Response {
  return new Response(JSON.stringify({ code: "NoMatch" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  resetGuardrails();
  vi.spyOn(global, "fetch").mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Persistent cache
// ---------------------------------------------------------------------------

describe("persistent cache", () => {
  it("second identical call is served from cache with zero fetches", async () => {
    const stub = vi.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(okMatch()));

    const first = await fetchRoadRoute(PTS);
    expect(first.matched).toBe(true);
    expect(stub).toHaveBeenCalledTimes(1); // match tier only (2 pts ≤ match cap)

    const second = await fetchRoadRoute(PTS);
    expect(second.matched).toBe(true);
    expect(second.degraded).toBe("cache");
    expect(stub).toHaveBeenCalledTimes(1); // no new network request
  });

  it("does not cache unmatched (service returned no geometry) results", async () => {
    const stub = vi.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(noMatch()));

    const first = await fetchRoadRoute(offsetPts(1));
    expect(first.matched).toBe(false);
    expect(first.degraded).toBeUndefined(); // NoMatch is not a guardrail trip

    const second = await fetchRoadRoute(offsetPts(1));
    expect(second.matched).toBe(false);
    // Fetched again both times: match + route per call → ≥ 4 requests.
    expect(stub.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

describe("circuit breaker", () => {
  it(`opens after ${CIRCUIT_FAILURE_THRESHOLD} consecutive failures and then stops fetching`, async () => {
    const stub = vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("network down"));

    // Distinct traces so the cache can never mask the circuit.
    for (let i = 0; i < 4; i++) {
      await fetchRoadRoute(offsetPts(10 + i));
    }
    const callsWhenOpen = stub.mock.calls.length;

    const res = await fetchRoadRoute(offsetPts(99));
    expect(stub.mock.calls.length).toBe(callsWhenOpen); // zero new fetches
    expect(res.matched).toBe(false);
    expect(res.degraded).toBe("service");
    expect(res.geometry).toEqual(offsetPts(99)); // raw fallback, never blank
  });

  it("429 with Retry-After holds the circuit until the header elapses", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-23T10:00:00.000Z"));
      const stub = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "120" },
        }),
      );

      const r1 = await fetchRoadRoute(offsetPts(20));
      expect(r1.degraded).toBe("service");
      expect(r1.matched).toBe(false);
      expect(stub).toHaveBeenCalledTimes(1); // match 429 → circuit opens, route skipped

      vi.setSystemTime(new Date("2026-09-23T10:01:59.000Z")); // 119s < 120s
      const r2 = await fetchRoadRoute(offsetPts(21));
      expect(stub).toHaveBeenCalledTimes(1);
      expect(r2.degraded).toBe("service");

      vi.setSystemTime(new Date("2026-09-23T10:02:01.000Z")); // 121s > 120s
      await fetchRoadRoute(offsetPts(22));
      expect(stub.mock.calls.length).toBeGreaterThan(1); // circuit closed again
    } finally {
      vi.useRealTimers();
    }
  });

  it("resetGuardrails clears an open circuit", async () => {
    const stub = vi.spyOn(global, "fetch");
    stub.mockRejectedValue(new TypeError("down"));
    for (let i = 0; i < 4; i++) await fetchRoadRoute(offsetPts(30 + i));

    const blocked = await fetchRoadRoute(offsetPts(40));
    expect(blocked.degraded).toBe("service");

    resetGuardrails();
    stub.mockImplementation(() => Promise.resolve(okMatch()));
    const after = await fetchRoadRoute(offsetPts(41));
    expect(after.matched).toBe(true);
    expect(after.degraded).toBeUndefined(); // healthy path again
  });
});

// ---------------------------------------------------------------------------
// Session request budget
// ---------------------------------------------------------------------------

describe("session request budget", () => {
  it("exhausted budget returns raw with degraded:'budget' and makes no fetch", async () => {
    resetGuardrails({ budget: 2 });
    const stub = vi.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(okMatch()));

    const a = await fetchRoadRoute(offsetPts(50)); // consumes 1
    expect(a.matched).toBe(true);
    const b = await fetchRoadRoute(offsetPts(51)); // consumes 2 → spent
    expect(b.matched).toBe(true);

    const c = await fetchRoadRoute(offsetPts(52));
    expect(stub).toHaveBeenCalledTimes(2); // zero new fetches
    expect(c.matched).toBe(false);
    expect(c.degraded).toBe("budget");
    expect(c.geometry).toEqual(offsetPts(52)); // raw fallback, never blank
  });

  it("cache hits do not consume budget", async () => {
    resetGuardrails({ budget: 1 });
    const stub = vi.spyOn(global, "fetch").mockImplementation(() => Promise.resolve(okMatch()));

    await fetchRoadRoute(offsetPts(60)); // budget: 1 → 0
    const cached = await fetchRoadRoute(offsetPts(60));
    expect(cached.degraded).toBe("cache"); // served from cache, not blocked
    expect(cached.matched).toBe(true);
    expect(stub).toHaveBeenCalledTimes(1);

    const blocked = await fetchRoadRoute(offsetPts(61)); // miss + no budget
    expect(blocked.degraded).toBe("budget");
    expect(stub).toHaveBeenCalledTimes(1);
  });
});
