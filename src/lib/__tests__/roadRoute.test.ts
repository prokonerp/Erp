/**
 * Unit tests for src/lib/roadRoute.ts — no network, no jsdom.
 *
 * Each test uses realistic fixtures shaped like verified OSRM responses.
 */
import { describe, expect, it, vi } from "vitest";
import {
  buildMatchUrl,
  buildRouteUrl,
  chunkTrace,
  decimateTrace,
  fetchRoadRoute,
  hashTrace,
  mergeGeometries,
  parseOsrmGeometry,
  prepareTrace,
} from "@/lib/roadRoute";
import type { LatLng } from "@/lib/roadRoute";

// ---------------------------------------------------------------------------
// Fixtures — OSRM response shapes (verified live)
// ---------------------------------------------------------------------------

/** A match/v1 success with two matchings (a trace with a gap yields two). */
function okMatchResponse(): unknown {
  return {
    code: "Ok",
    matchings: [
      {
        confidence: 0.9,
        legs: [],
        geometry: {
          coordinates: [
            [77.209, 28.613], // lon, lat
            [77.215, 28.62],
            [77.222, 28.628],
          ],
        },
      },
      {
        confidence: 0.85,
        legs: [],
        geometry: {
          coordinates: [
            [77.23, 28.637], // lon, lat
            [77.24, 28.65],
          ],
        },
      },
    ],
    tracepoints: [{ location: [77.209, 28.613] }],
  };
}

/** A route/v1 success — single geometry spanning every leg. */
function okRouteResponse(): unknown {
  return {
    code: "Ok",
    routes: [
      {
        geometry: {
          coordinates: [
            [77.209, 28.613],
            [77.218, 28.625],
            [77.24, 28.65],
          ],
        },
        distance: 2794.2,
      },
    ],
    waypoints: [],
  };
}

function noMatchResponse(): unknown {
  return { code: "NoMatch" };
}

// ---------------------------------------------------------------------------
// prepareTrace
// ---------------------------------------------------------------------------

describe("prepareTrace", () => {
  it("drops NaN coords", () => {
    const input: LatLng[] = [
      [28.6, 77.2],
      [NaN, 77.3],
      [28.7, NaN],
    ];
    const out = prepareTrace(input);
    expect(out).toEqual([[28.6, 77.2]]);
  });

  it("drops out-of-range coords", () => {
    const input: LatLng[] = [
      [28.6, 77.2],
      [100, 77.3],
      [28.7, -200],
    ];
    const out = prepareTrace(input);
    expect(out).toEqual([[28.6, 77.2]]);
  });

  it("drops duplicate consecutive points", () => {
    const input: LatLng[] = [
      [28.6, 77.2],
      [28.6, 77.2], // exact dup
      [28.7, 77.3],
    ];
    const out = prepareTrace(input);
    expect(out).toEqual([
      [28.6, 77.2],
      [28.7, 77.3],
    ]);
  });

  it("keeps order", () => {
    const input: LatLng[] = [
      [28.7, 77.3],
      [28.6, 77.2],
    ];
    const out = prepareTrace(input);
    expect(out[0]).toEqual([28.7, 77.3]);
    expect(out[1]).toEqual([28.6, 77.2]);
  });

  it("passes through clean trace", () => {
    const input: LatLng[] = [
      [28.6, 77.2],
      [28.65, 77.25],
    ];
    const out = prepareTrace(input);
    expect(out).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// decimateTrace
// ---------------------------------------------------------------------------

describe("decimateTrace", () => {
  it("returns short traces untouched", () => {
    const input: LatLng[] = [
      [28.6, 77.2],
      [28.7, 77.3],
    ];
    expect(decimateTrace(input)).toEqual(input);
  });

  it("never exceeds maxCoords", () => {
    const input = Array.from(
      { length: 5000 },
      (_, i) => [28 + i * 0.001, 77 + i * 0.001] as LatLng,
    );
    const out = decimateTrace(input, 100);
    expect(out.length).toBeLessThanOrEqual(100);
  });

  it("always keeps first and last point", () => {
    const input: LatLng[] = [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
    ];
    const out = decimateTrace(input, 3);
    expect(out[0]).toEqual([1, 1]);
    expect(out[out.length - 1]).toEqual([5, 5]);
  });
});

// ---------------------------------------------------------------------------
// chunkTrace
// ---------------------------------------------------------------------------

describe("chunkTrace", () => {
  it("single chunk when under cap", () => {
    const pts: LatLng[] = [
      [28.6, 77.2],
      [28.7, 77.3],
    ];
    const chunks = chunkTrace(pts, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(pts);
  });

  it("respects OSRM_MAX_COORDS per chunk", () => {
    const pts = Array.from({ length: 150 }, (_, i) => [28 + i * 0.001, 77 + i * 0.001] as LatLng);
    const chunks = chunkTrace(pts, 100);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(100);
  });

  it("chunks overlap by exactly one boundary point", () => {
    const pts = Array.from({ length: 6 }, (_, i) => [28 + i * 0.001, 77 + i * 0.001] as LatLng);
    const chunks = chunkTrace(pts, 3);
    expect(chunks).toHaveLength(3);
    // Chunk 0 ends at pts[2]; chunk 1 starts at pts[2] → overlap
    expect(chunks[0][2]).toEqual(chunks[1][0]);
    // Chunk 1 ends at pts[4]; chunk 2 starts at pts[4] → overlap
    expect(chunks[1][2]).toEqual(chunks[2][0]);
  });
});

// ---------------------------------------------------------------------------
// buildMatchUrl / buildRouteUrl — literal URL assertions
// ---------------------------------------------------------------------------

describe("buildMatchUrl", () => {
  it("emits lon,lat order (not lat,lon)", () => {
    const url = buildMatchUrl("https://example.com", [[28.6, 77.2]]);
    // OSRM expects lon,lat — verify 77.2 comes BEFORE 28.6 in coordinate string
    expect(url).toContain("77.2,28.6");
    // And NOT 28.6,77.2 in the coordinate sequence
    const coordPart = url.split("/match/v1/driving/")[1]?.split("?")[0];
    expect(coordPart).toBe("77.2,28.6");
  });

  it("includes geometries=geojson and overview=full", () => {
    const url = buildMatchUrl("https://example.com", [
      [28.6, 77.2],
      [28.7, 77.3],
    ]);
    expect(url).toContain("geometries=geojson");
    expect(url).toContain("overview=full");
  });

  it("includes tidy=true", () => {
    const url = buildMatchUrl("https://example.com", [
      [28.6, 77.2],
      [28.7, 77.3],
    ]);
    expect(url).toContain("tidy=true");
  });

  it("includes one radius per coordinate", () => {
    const url = buildMatchUrl(
      "https://example.com",
      [
        [28.6, 77.2],
        [28.7, 77.3],
        [28.8, 77.4],
      ],
      30,
    );
    expect(url).toContain("radiuses=30;30;30");
  });
});

describe("buildRouteUrl", () => {
  it("emits lon,lat order", () => {
    const url = buildRouteUrl("https://example.com", [[28.6, 77.2]]);
    const coordPart = url.split("/route/v1/driving/")[1]?.split("?")[0];
    expect(coordPart).toBe("77.2,28.6");
  });

  it("includes geometries=geojson and overview=full", () => {
    const url = buildRouteUrl("https://example.com", [
      [28.6, 77.2],
      [28.7, 77.3],
    ]);
    expect(url).toContain("geometries=geojson");
    expect(url).toContain("overview=full");
  });
});

// ---------------------------------------------------------------------------
// parseOsrmGeometry
// ---------------------------------------------------------------------------

describe("parseOsrmGeometry", () => {
  it("extracts multiple matchings and concatenates them in order", () => {
    const body = okMatchResponse();
    const result = parseOsrmGeometry(body);
    expect(result).toBeTruthy();
    // matchings[0] has 3 coords, matchings[1] has 2 → total 5
    expect(result!.length).toBe(5);
    // Verify axis reversal: [77.209, 28.613] (lon,lat) → [28.613, 77.209] (lat,long)
    expect(result![0]).toEqual([28.613, 77.209]);
    expect(result![result!.length - 1]).toEqual([28.65, 77.24]);
  });

  it("falls back to routes[0] when no matchings", () => {
    const body = okRouteResponse();
    const result = parseOsrmGeometry(body);
    expect(result).toBeTruthy();
    expect(result!.length).toBe(3);
    // Verify axis reversal on route geometry too
    expect(result![0]).toEqual([28.613, 77.209]);
  });

  it("returns null for NoMatch code", () => {
    const body = noMatchResponse();
    expect(parseOsrmGeometry(body)).toBeNull();
  });

  it("returns null for missing geometry", () => {
    const body = { code: "Ok" };
    expect(parseOsrmGeometry(body)).toBeNull();
  });

  it("returns null for malformed coordinate (non-array)", () => {
    const body = {
      code: "Ok",
      matchings: [{ geometry: { coordinates: [["bad"] as unknown] } }],
    } as unknown;
    expect(parseOsrmGeometry(body)).toBeNull();
  });

  it("reverses axis order [lon,lat] → [lat,long]", () => {
    const body = {
      code: "Ok",
      routes: [
        {
          geometry: { coordinates: [[77.5, 28.5]] }, // lon=77.5, lat=28.5
        },
      ],
    };
    const result = parseOsrmGeometry(body);
    // Output must be [28.5, 77.5] — [lat, long]
    expect(result?.[0]).toEqual([28.5, 77.5]);
  });
});

// ---------------------------------------------------------------------------
// mergeGeometries
// ---------------------------------------------------------------------------

describe("mergeGeometries", () => {
  it("joins without duplicating shared boundary points", () => {
    const parts: LatLng[][] = [
      [
        [28.6, 77.2],
        [28.65, 77.25],
      ],
      [
        [28.65, 77.25],
        [28.7, 77.3],
      ],
    ];
    const merged = mergeGeometries(parts);
    expect(merged).toEqual([
      [28.6, 77.2],
      [28.65, 77.25],
      [28.7, 77.3],
    ]);
    expect(merged.length).toBe(3);
  });

  it("skips empty parts", () => {
    const parts: LatLng[][] = [[], [[28.6, 77.2]], []];
    expect(mergeGeometries(parts)).toEqual([[28.6, 77.2]]);
  });
});

// ---------------------------------------------------------------------------
// hashTrace
// ---------------------------------------------------------------------------

describe("hashTrace", () => {
  it("produces a stable 8-char hex digest", () => {
    const pts: LatLng[] = [
      [28.6, 77.2],
      [28.7, 77.3],
    ];
    const h1 = hashTrace(pts);
    const h2 = hashTrace(pts);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(8);
    expect(/^[0-9a-f]{8}$/.test(h1)).toBe(true);
  });

  it("different points produce different hashes", () => {
    const h1 = hashTrace([[28.6, 77.2]] as LatLng[]);
    const h2 = hashTrace([[28.7, 77.3]] as LatLng[]);
    expect(h1).not.toBe(h2);
  });
});

// ---------------------------------------------------------------------------
// fetchRoadRoute — stubbed fetch
// ---------------------------------------------------------------------------

describe("fetchRoadRoute", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubFetch(responses: Record<string, Response>) {
    return vi.spyOn(global, "fetch").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest spy types are overly strict
      async (url: any) => {
        const key = typeof url === "string" ? url : url.toString();
        const found = responses[key];
        if (found) return Promise.resolve(found);
        // Return a 404 for unmatched URLs.
        return Promise.resolve(
          new Response(JSON.stringify({ code: "InvalidQuery" }), { status: 400 }),
        );
      },
    );
  }

  function okResponse(data: unknown): Response {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function badResponse(code: string): Response {
    return new Response(JSON.stringify({ code }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("match succeeds → matched:true", async () => {
    const stub = stubFetch({
      "/match/v1/driving/": okResponse(okMatchResponse()),
    });
    const pts: LatLng[] = [
      [28.6, 77.2],
      [28.7, 77.3],
    ];
    // Build the expected URL prefix for assertion on the mock.
    const url = `https://router.project-osrm.org/match/v1/driving/77.2,28.6;77.3,28.7?geometries=geojson&overview=full&tidy=true&radiuses=30;30`;
    (stub as ReturnType<typeof vi.spyOn>).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest spy types are overly strict
      (input: any) => {
        if (typeof input === "string" && input.includes("/match/"))
          return Promise.resolve(okResponse(okMatchResponse()));
        throw new Error("unexpected call");
      },
    );

    const res = await fetchRoadRoute(pts);
    expect(res.matched).toBe(true);
    expect(res.geometry.length).toBeGreaterThan(0);
  });

  it("match fails but route succeeds → road geometry with matched:true", async () => {
    const stub = vi.spyOn(global, "fetch").mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vitest spy types are overly strict
      (input: any) => {
        if (typeof input === "string" && input.includes("/match/"))
          return Promise.resolve(badResponse("NoMatch"));
        return Promise.resolve(okResponse(okRouteResponse()));
      },
    );

    const pts: LatLng[] = [
      [28.6, 77.2],
      [28.7, 77.3],
    ];

    const res = await fetchRoadRoute(pts);
    expect(res.matched).toBe(true);
    expect(res.geometry.length).toBeGreaterThan(1);
    stub.mockRestore();
  });

  it("both fail → raw points with matched:false", async () => {
    const stub = vi.spyOn(global, "fetch").mockImplementation(async () => badResponse("NoSegment"));

    const pts: LatLng[] = [
      [28.6, 77.2],
      [28.7, 77.3],
    ];

    const res = await fetchRoadRoute(pts);
    expect(res.matched).toBe(false);
    expect(res.geometry).toEqual(pts);
    stub.mockRestore();
  });

  it("network error → raw points, no rejection", async () => {
    const stub = vi.spyOn(global, "fetch").mockRejectedValue(new TypeError("Network error"));

    const pts: LatLng[] = [
      [28.6, 77.2],
      [28.7, 77.3],
    ];

    // Must not throw.
    await expect(fetchRoadRoute(pts)).resolves.not.toThrow();
    const res = await fetchRoadRoute(pts);
    expect(res.matched).toBe(false);
    expect(res.geometry).toEqual(pts);
    stub.mockRestore();
  });

  it("AbortSignal.aborted → raw points, no rejection", async () => {
    const controller = new AbortController();
    controller.abort();

    const pts: LatLng[] = [
      [28.6, 77.2],
      [28.7, 77.3],
    ];

    const res = await fetchRoadRoute(pts, { signal: controller.signal });
    expect(res.matched).toBe(false);
    expect(res.geometry).toEqual(pts);
  });
});
