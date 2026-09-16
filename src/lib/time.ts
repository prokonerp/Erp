// Single timezone source for the whole app.
//
// India operations run on IST (Asia/Kolkata, UTC+5:30, no DST) no matter where
// the engineer's device happens to be. Before this module, queue "Today" used
// Asia/Kolkata, conveyance days used device-local, on-screen clocks used
// device-local, and the printed FSR used UTC — the same visit disagreed with
// itself by 5:30 between screen and paper. Every display path below pins IST.
//
// Pure module: no React, no Supabase, unit-tests in plain node.

export const APP_TIME_ZONE = "Asia/Kolkata";

type Dateish = string | number | Date | null | undefined;

function toDate(v: Dateish): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** IST calendar date as YYYY-MM-DD (queue sections, conveyance days). */
export function istDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** IST clock as HH:mm (24h). Falls back to `emptyValue` on bad input. */
export function formatISTTime(iso: Dateish, emptyValue = "—"): string {
  const d = toDate(iso);
  if (!d) return emptyValue;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** IST date as DD/MM/YYYY (print + summaries). Falls back on bad input. */
export function formatISTDate(iso: Dateish, emptyValue = "—"): string {
  const d = toDate(iso);
  if (!d) return emptyValue;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

/** Full timestamp pinned to IST (same shape as device toLocaleString). */
export function formatISTDateTime(iso: Dateish, emptyValue = "—"): string {
  const d = toDate(iso);
  if (!d) return emptyValue;
  return d.toLocaleString("en-IN", { timeZone: APP_TIME_ZONE });
}
