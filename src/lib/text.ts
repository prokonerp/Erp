/** Convert "john  DOE" -> "John Doe". Skips numbers/serials. Safe on empty input. */
export function toTitleCase(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b([a-z])([a-z0-9'’-]*)/g, (_, a, rest) => a.toUpperCase() + rest);
}

/** Title-case but preserve common all-caps tokens like UPS, AMC, GST, INR, LLP, PVT, LTD. */
const KEEP_UPPER = new Set([
  "UPS", "AMC", "GST", "GSTIN", "INR", "LLP", "PVT", "LTD", "PLC",
  "CCTV", "OOW", "PM", "AC", "DC", "USB", "LED", "TV", "HQ", "IT",
]);
export function toTitleCaseSmart(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toString()
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => {
      const up = w.toUpperCase().replace(/[.,]/g, "");
      if (KEEP_UPPER.has(up)) return w.toUpperCase();
      return toTitleCase(w);
    })
    .join(" ");
}

/** Title-case an address — splits on commas / newlines and title-cases each segment. */
export function titleCaseAddress(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toString()
    .split(/(\n|,)/)
    .map((seg) => (seg === "\n" || seg === "," ? seg : toTitleCaseSmart(seg)))
    .join("")
    .trim();
}

export function upperTrim(input: string | null | undefined): string {
  return (input || "").toString().trim().toUpperCase();
}