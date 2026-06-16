/**
 * Preserve the user's original input. We intentionally do NOT change case
 * for company / person / address / email / remark fields — only collapse
 * surrounding whitespace so blank submissions still normalise.
 */
export function toTitleCase(input: string | null | undefined): string {
  return (input ?? "").toString().trim();
}

/** Preserve original casing — see toTitleCase. */
export function toTitleCaseSmart(input: string | null | undefined): string {
  return (input ?? "").toString().trim();
}

/** Preserve original casing for multi-line addresses — only trims edges. */
export function titleCaseAddress(input: string | null | undefined): string {
  return (input ?? "").toString().replace(/[ \t]+\n/g, "\n").trim();
}

export function upperTrim(input: string | null | undefined): string {
  return (input || "").toString().trim().toUpperCase();
}