import { describe, expect, it } from "vitest";
import {
  DELETE_TOKEN_TTL_MS,
  issueDeleteToken,
  verifyDeleteToken,
} from "@/lib/public-delete-token";

const SECRET = "test-secret-at-least-32-characters-long!!";
const PATH = "public/staged/2026/09/18/abc-SERIAL-1.jpg";
const NOW = 1_760_000_000_000;

describe("public delete tokens", () => {
  it("verifies a freshly issued token for the same path", async () => {
    const t = await issueDeleteToken(SECRET, PATH, NOW);
    expect(await verifyDeleteToken(SECRET, PATH, t, NOW)).toBe(true);
  });

  it("rejects after the TTL elapses", async () => {
    const t = await issueDeleteToken(SECRET, PATH, NOW, 60_000);
    expect(await verifyDeleteToken(SECRET, PATH, t, NOW + 59_000)).toBe(true);
    expect(await verifyDeleteToken(SECRET, PATH, t, NOW + 60_001)).toBe(false);
  });

  it("defaults to a 24h TTL", async () => {
    const t = await issueDeleteToken(SECRET, PATH, NOW);
    const expiry = Number(t.slice(0, t.indexOf(".")));
    expect(expiry - NOW).toBe(DELETE_TOKEN_TTL_MS);
  });

  it("is bound to the path — a token never authorizes another object", async () => {
    const t = await issueDeleteToken(SECRET, PATH, NOW);
    expect(await verifyDeleteToken(SECRET, "public/staged/other.jpg", t, NOW)).toBe(false);
  });

  it("rejects a different secret", async () => {
    const t = await issueDeleteToken(SECRET, PATH, NOW);
    expect(await verifyDeleteToken("another-secret-32-chars-minimum!!!!!", PATH, t, NOW)).toBe(
      false,
    );
  });

  it("rejects malformed tokens", async () => {
    for (const bad of ["", "no-dot", ".", "abc.def", "0.", `${NOW}.`]) {
      expect(await verifyDeleteToken(SECRET, PATH, bad, NOW)).toBe(false);
    }
  });

  it("rejects a tampered expiry (signature covers the timestamp)", async () => {
    const t = await issueDeleteToken(SECRET, PATH, NOW, 1000);
    const sig = t.slice(t.indexOf(".") + 1);
    const forged = `${NOW + 999_999}.${sig}`;
    expect(await verifyDeleteToken(SECRET, PATH, forged, NOW)).toBe(false);
  });
});
