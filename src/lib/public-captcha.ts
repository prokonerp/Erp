// Stateless arithmetic captcha for the public raise-ticket form.
//
// The server issues { a, b, nonce, expiry, hmac } where
//   hmac = HMAC-SHA256(secret, "nonce.a.b.expiry").
// The client solves a+b and submits everything back; the server re-verifies
// WITHOUT any database round-trip or stored state. Expiry (default 5 min)
// bounds replay; per-IP rate limits (see public-rate-limit.ts) bound farming.
//
// Pure module: no supabase / env / DOM imports, so it unit-tests in plain node.

export type CaptchaChallenge = {
  a: number;
  b: number;
  nonce: string;
  expiry: number;
  hmac: string;
};

export type CaptchaAttempt = CaptchaChallenge & { answer: number };

export type CaptchaVerdict =
  | { ok: true }
  | { ok: false; reason: "expired" | "bad_hmac" | "wrong_answer" | "malformed" };

export const CAPTCHA_TTL_MS = 5 * 60 * 1000;

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function challengeMessage(c: { nonce: string; a: number; b: number; expiry: number }): string {
  return `${c.nonce}.${c.a}.${c.b}.${c.expiry}`;
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueCaptchaChallenge(
  secret: string,
  opts?: { ttlMs?: number },
): Promise<CaptchaChallenge> {
  if (!secret) throw new Error("[captcha] secret is required");
  // Operands are shown to the user, so Math.random is fine (no secrecy needed).
  const a = 1 + Math.floor(Math.random() * 9);
  const b = 1 + Math.floor(Math.random() * 9);
  const nonce = randomHex(16);
  const expiry = Date.now() + (opts?.ttlMs ?? CAPTCHA_TTL_MS);
  const hmac = await hmacHex(secret, challengeMessage({ nonce, a, b, expiry }));
  return { a, b, nonce, expiry, hmac };
}

export async function verifyCaptchaAnswer(
  secret: string,
  attempt: CaptchaAttempt,
): Promise<CaptchaVerdict> {
  const { a, b, nonce, expiry, hmac, answer } = attempt ?? ({} as CaptchaAttempt);
  if (
    !secret ||
    !Number.isInteger(a) ||
    !Number.isInteger(b) ||
    typeof nonce !== "string" ||
    nonce.length === 0 ||
    !Number.isFinite(expiry) ||
    typeof hmac !== "string" ||
    hmac.length === 0 ||
    !Number.isInteger(answer)
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (expiry <= Date.now()) return { ok: false, reason: "expired" };
  const expected = await hmacHex(secret, challengeMessage({ nonce, a, b, expiry }));
  if (!timingSafeEqualHex(expected, hmac)) return { ok: false, reason: "bad_hmac" };
  if (answer !== a + b) return { ok: false, reason: "wrong_answer" };
  return { ok: true };
}
