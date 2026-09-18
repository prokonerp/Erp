// Path-bound, time-bound delete tokens for public uploads.
//
// Token = `${expiryMs}.${hmacHex(secret, `${expiryMs}.${path}`)}`.
// Binding BOTH the path and the expiry means a leaked token cannot be
// replayed against another object, and cannot be replayed forever.
//
// Pure module (WebCrypto only): no supabase / env / DOM imports, so it
// unit-tests in plain node with an injected secret + clock.

export const DELETE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

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

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Issue a token for `path` that expires at `nowMs + ttlMs` (default 24h). */
export async function issueDeleteToken(
  secret: string,
  path: string,
  nowMs: number = Date.now(),
  ttlMs: number = DELETE_TOKEN_TTL_MS,
): Promise<string> {
  if (!secret) throw new Error("[delete-token] secret is required");
  const expiryMs = nowMs + ttlMs;
  return `${expiryMs}.${await hmacHex(secret, `${expiryMs}.${path}`)}`;
}

/** Verify a token for `path` at `nowMs`. False on any malformed/expired/mismatch. */
export async function verifyDeleteToken(
  secret: string,
  path: string,
  token: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!secret || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiryMs = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(expiryMs) || expiryMs <= 0 || sig === "") return false;
  if (nowMs > expiryMs) return false;
  return timingSafeEqualHex(await hmacHex(secret, `${expiryMs}.${path}`), sig);
}
