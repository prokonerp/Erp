import { describe, expect, it } from "vitest";
import { pickClientIp } from "@/lib/server-client-ip";

function headersOf(map: Record<string, string>): (n: string) => string | null {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) lower[k.toLowerCase()] = v;
  return (n) => lower[n.toLowerCase()] ?? null;
}

describe("pickClientIp", () => {
  it("prefers x-real-ip (platform-set) over x-forwarded-for", () => {
    expect(
      pickClientIp(
        headersOf({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4, 5.6.7.8" }),
      ),
    ).toBe("ip:203.0.113.9");
  });

  it("reads the RIGHTMOST x-forwarded-for entry, never the client-supplied first one", () => {
    // attacker sends '1.2.3.4'; the proxy appends the real client ip last
    expect(pickClientIp(headersOf({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" }))).toBe(
      "ip:198.51.100.7",
    );
  });

  it("rotating the spoofed first hop does NOT change the bucket key", () => {
    const a = pickClientIp(headersOf({ "x-forwarded-for": "1.1.1.1, 198.51.100.7" }));
    const b = pickClientIp(headersOf({ "x-forwarded-for": "9.9.9.9, 198.51.100.7" }));
    expect(a).toBe(b);
  });

  it("honours an explicit TRUSTED_IP_HEADER over both defaults", () => {
    expect(
      pickClientIp(
        headersOf({ "x-vercel-forwarded-for": "192.0.2.5", "x-real-ip": "203.0.113.9" }),
        "x-vercel-forwarded-for",
      ),
    ).toBe("ip:192.0.2.5");
  });

  it("falls back to the shared bucket when no header is present", () => {
    expect(pickClientIp(headersOf({}))).toBe("ip:unknown");
    expect(pickClientIp(headersOf({ "x-forwarded-for": "  " }))).toBe("ip:unknown");
  });

  it("caps absurdly long values", () => {
    const key = pickClientIp(headersOf({ "x-real-ip": "a".repeat(500) }));
    expect(key.length).toBeLessThanOrEqual(3 + 64);
  });
});
