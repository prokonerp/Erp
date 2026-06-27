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