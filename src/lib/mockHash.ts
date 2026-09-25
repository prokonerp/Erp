/**
 * Deterministic 64-char hex hash — a browser-safe stand-in for the retired
 * `node:crypto` SHA-256 inside the mock transport.
 *
 * WHY THIS EXISTS
 *   `gspMock.ts` originally imported `createHash` from `node:crypto`. That was
 *   fine while the mock was only reached from inside `createServerFn().handler`
 *   bodies (stripped from the client bundle). Once the connection probe
 *   (`runGspConnectionTest`) is exported and called from a component, the mock
 *   module became client-reachable and the browser build failed with
 *   `"createHash" is not exported by "__vite-browser-external"`.
 *
 * WHAT THIS IS NOT
 *   This is NOT cryptographic and is NEVER used for anything that reaches a
 *   statutory system. It exists only so the mock's fabricated IRN / AckNo /
 *   EWB / token values are 64-char lowercase hex, deterministic across runs,
 *   and non-repeating — the exact shape the real GSP returns, so downstream
 *   format checks and the DB's anti-fabrication CHECK constraint behave
 *   identically. The retired mock's bug (`hash8.repeat(8)`) was that its output
 *   *looked* like a real IRN; real cryptographic strength is irrelevant here
 *   because none of these values are ever legitimately registered.
 *
 * The transform is a fixed 4-round FNV-1a-style avalanche over 8 independently
 * seeded lanes, so a 1-character input change reshuffles the whole digest and
 * the first 8 characters are never a repeated 8-character block.
 *
 * @module src/lib/mockHash
 */

/** Multiply and mix, in 32-bit space, using Math.imul for exactness. */
function mix(value: number, lane: number): number {
  let x = (value ^ lane) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** FNV-1a 32-bit — cheap, dependency-free, and good enough for a mock digest. */
function fnv1a(input: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return mix(hash, seed);
}

const HEX = "0123456789abcdef";

function toHex8(value: number): string {
  let out = "";
  for (let shift = 28; shift >= 0; shift -= 4) {
    out += HEX[(value >>> shift) & 0xf];
  }
  return out;
}

/**
 * Returns a deterministic 64-character lowercase-hex string for `input`.
 * The same input always yields the same output; different inputs yield
 * effectively different digests, and the result is never a repeated block.
 */
export function mockHashHex(input: string): string {
  const prefix = `mockhash:${input}`;
  let out = "";
  for (let lane = 0; lane < 8; lane += 1) {
    out += toHex8(fnv1a(prefix, (lane * 0x9e3779b1) >>> 0));
  }
  return out;
}
