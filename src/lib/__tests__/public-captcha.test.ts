import { describe, it, expect } from "vitest";
import { issueCaptchaChallenge, verifyCaptchaAnswer } from "@/lib/public-captcha";

const SECRET = "test-secret-for-captcha-unit-tests-only";

describe("issueCaptchaChallenge", () => {
  it("issues a solvable challenge with a 5-minute expiry", async () => {
    const before = Date.now();
    const c = await issueCaptchaChallenge(SECRET);
    expect(c.a).toBeGreaterThanOrEqual(1);
    expect(c.a).toBeLessThanOrEqual(9);
    expect(c.b).toBeGreaterThanOrEqual(1);
    expect(c.b).toBeLessThanOrEqual(9);
    expect(c.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(c.expiry).toBeGreaterThan(before + 4 * 60 * 1000);
    expect(c.expiry).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000 + 1000);
    expect(c.hmac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("issues unique nonces per challenge", async () => {
    const c1 = await issueCaptchaChallenge(SECRET);
    const c2 = await issueCaptchaChallenge(SECRET);
    expect(c1.nonce).not.toBe(c2.nonce);
  });
});

describe("verifyCaptchaAnswer", () => {
  it("accepts the correct answer", async () => {
    const c = await issueCaptchaChallenge(SECRET);
    const res = await verifyCaptchaAnswer(SECRET, { ...c, answer: c.a + c.b });
    expect(res).toEqual({ ok: true });
  });

  it("rejects a wrong answer", async () => {
    const c = await issueCaptchaChallenge(SECRET);
    const res = await verifyCaptchaAnswer(SECRET, { ...c, answer: c.a + c.b + 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("wrong_answer");
  });

  it("rejects a tampered operand", async () => {
    const c = await issueCaptchaChallenge(SECRET);
    const res = await verifyCaptchaAnswer(SECRET, {
      ...c,
      a: c.a === 9 ? 1 : c.a + 1,
      answer: c.a + c.b,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects a tampered nonce", async () => {
    const c = await issueCaptchaChallenge(SECRET);
    const res = await verifyCaptchaAnswer(SECRET, {
      ...c,
      nonce: "0".repeat(32),
      answer: c.a + c.b,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects an extended expiry", async () => {
    const c = await issueCaptchaChallenge(SECRET);
    const res = await verifyCaptchaAnswer(SECRET, {
      ...c,
      expiry: Date.now() + 60 * 60 * 1000,
      answer: c.a + c.b,
    });
    expect(res.ok).toBe(false);
  });

  it("rejects an expired challenge", async () => {
    const c = await issueCaptchaChallenge(SECRET, { ttlMs: -1000 });
    const res = await verifyCaptchaAnswer(SECRET, { ...c, answer: c.a + c.b });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("expired");
  });

  it("rejects a challenge signed with a different secret", async () => {
    const c = await issueCaptchaChallenge("another-secret");
    const res = await verifyCaptchaAnswer(SECRET, { ...c, answer: c.a + c.b });
    expect(res.ok).toBe(false);
  });

  it("rejects a malformed hmac without throwing", async () => {
    const c = await issueCaptchaChallenge(SECRET);
    const res = await verifyCaptchaAnswer(SECRET, { ...c, hmac: "not-hex", answer: c.a + c.b });
    expect(res.ok).toBe(false);
  });
});
