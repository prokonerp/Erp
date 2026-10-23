/**
 * Serial identity rules — one place, shared by the indent builder, the
 * defective listing and the ticket forms.
 *
 * Operators have historically typed punctuation placeholders (",", ".", "..",
 * "...", ",,") into free-text serial fields. Those values are not identities:
 * two distinct physical units must never collapse into one row because both
 * carry the same placeholder. A serial counts as an identity only when it
 * contains at least one letter or digit.
 */

/** Upper-trim, matching SQL `normalize_serial()`. */
export function normSerial(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toUpperCase();
}

/** True when the value can identify a physical unit (has a letter or digit). */
export function isIdentifyingSerial(v: unknown): boolean {
  return /[A-Za-z0-9]/.test(normSerial(v));
}

/**
 * `MODEL|SERIAL` identity key, or `""` when the serial is not an identity.
 * Callers must treat `""` as "do not dedupe, do not match" — never as a key.
 */
export function identityKey(model: unknown, serial: unknown): string {
  if (!isIdentifyingSerial(serial)) return "";
  return `${normSerial(model)}|${normSerial(serial)}`;
}

/** Store-safe serial: a real value is upper-trimmed, a placeholder becomes "". */
export function sanitizeSerial(v: unknown): string {
  return isIdentifyingSerial(v) ? normSerial(v) : "";
}

/**
 * True for a non-empty value with no letter or digit: ",", ".", "..", "...",
 * ",,", " - ", etc. Empty/whitespace is NOT a placeholder — it means "unknown"
 * and is allowed by the DB CHECK constraints. Mirrors SQL `is_placeholder_serial`.
 */
export function isPlaceholderSerial(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return s !== "" && !/[A-Za-z0-9]/.test(s);
}

/**
 * Comma string -> comma string with placeholder tokens removed, order preserved,
 * case-insensitive duplicates collapsed by first occurrence. Mirrors SQL
 * `serial_strip_placeholder_tokens` (joins with "," and no space).
 */
export function stripPlaceholderTokens(v: unknown): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(v ?? "").split(",")) {
    const token = raw.trim();
    if (!isIdentifyingSerial(token)) continue;
    const key = token.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
  }
  return out.join(",");
}

/**
 * Raw `MODEL|SERIAL` key, matching SQL `normalize_serial_key()`. Unlike
 * `identityKey`, this does NOT reject placeholders — callers must check
 * `isIdentifyingSerial` first. Prefer `identityKey` for matching/dedupe.
 */
export function normalizeSerialKey(model: unknown, serial: unknown): string {
  return `${normSerial(model)}|${normSerial(serial)}`;
}

/**
 * Throws when a value cannot identify a physical unit. Use at submit/save
 * boundaries where a serial is required; for optional fields, check
 * `isPlaceholderSerial` and clear the value instead.
 */
export function assertIdentifyingSerial(v: unknown, field = "Serial number"): string {
  if (!isIdentifyingSerial(v)) {
    throw new Error(
      `${field} is not a valid serial. Enter at least one letter or digit (placeholders like "," or "." are not allowed).`,
    );
  }
  return normSerial(v);
}
