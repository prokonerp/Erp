export type RangeMode = "all" | "week" | "month" | "custom";

export type DateRange = { from: string; to: string }; // YYYY-MM-DD inclusive

const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

export const currentWeek = (): DateRange => {
  const now = new Date();
  const dow = now.getDay(); // 0 = Sun
  const start = new Date(now); start.setDate(now.getDate() - dow); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(start.getDate() + 6);
  return { from: iso(start), to: iso(end) };
};

export const currentMonth = (): DateRange => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: iso(start), to: iso(end) };
};

export const resolveRange = (mode: RangeMode, custom?: Partial<DateRange>): DateRange => {
  if (mode === "all") return { from: "1900-01-01", to: "2100-12-31" };
  if (mode === "week") return currentWeek();
  if (mode === "month") return currentMonth();
  return { from: custom?.from || currentMonth().from, to: custom?.to || currentMonth().to };
};

// Does [aStart, aEnd] overlap [bStart, bEnd] (inclusive, string YYYY-MM-DD)
export const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) =>
  aStart <= bEnd && bStart <= aEnd;

export const inRange = (d: string, r: DateRange) => d >= r.from && d <= r.to;

/**
 * Calendar date (YYYY-MM-DD) of a Date in its own local timezone.
 * Use this instead of `d.toISOString().slice(0, 10)` — toISOString converts to
 * UTC, which shifts a local-midnight date back one day for positive offsets
 * (e.g. IST: local 00:00 -> UTC previous-day 18:30).
 */
export const localDateIso = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
};

/**
 * Business timezone for all document dates (B-12). Documents created between
 * 00:00–05:30 IST must not fall back to "yesterday" just because the device /
 * UTC clock says so, and staff abroad must see the same business date as HQ.
 */
export const BUSINESS_TZ = "Asia/Kolkata";

const istFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar date (YYYY-MM-DD) of an instant in the business timezone (IST). */
export const istDateIso = (d: Date | number | string = new Date()): string => {
  const date = typeof d === "string" || typeof d === "number" ? new Date(d) : d;
  if (isNaN(date.getTime())) return "";
  return istFormatter.format(date);
};

/** Today's date in the business timezone (IST) as YYYY-MM-DD. */
export const istTodayIso = (): string => istDateIso(new Date());

/** Date N days before today, in the business timezone (IST). */
export const daysAgoIst = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return istDateIso(d);
};