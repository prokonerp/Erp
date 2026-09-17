import { z } from "zod";
import { istDateKey } from "@/lib/time";

/**
 * Classify a conveyance-log load failure so UI banners never blame the
 * migration for RLS denials or network faults. Only missing-table errors
 * keep the migration message. Pure — unit-tested.
 */
export function conveyanceLoadMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const m = msg.toLowerCase();
  const isMissingTable =
    m.includes("42p01") ||
    m.includes("undefined_table") ||
    (m.includes("does not exist") && (m.includes("relation") || m.includes("table"))) ||
    m.includes("could not find the table") ||
    m.includes("schema cache");
  if (isMissingTable) {
    return "Conveyance storage isn't set up yet — ask your admin to run the latest migration, then retry.";
  }
  const isDenied =
    m.includes("42501") ||
    m.includes("insufficient_privilege") ||
    m.includes("permission denied") ||
    m.includes("not authorized") ||
    m.includes("unauthorized") ||
    m.includes("row-level security") ||
    m.includes("violates row-level") ||
    m.includes("forbidden") ||
    m.includes("jwt");
  if (isDenied) {
    return "Access denied loading conveyance — ask your admin to check your permissions, then retry.";
  }
  const isNetwork =
    err instanceof TypeError ||
    m.includes("failed to fetch") ||
    m.includes("fetch failed") ||
    m.includes("networkerror") ||
    m.includes("network error") ||
    m.includes("network request failed") ||
    m.includes("load failed") ||
    m.includes("offline") ||
    m.includes("timeout") ||
    m.includes("aborted");
  if (isNetwork) return "Couldn't load conveyance — check your connection and retry.";
  return msg !== "" ? msg : "Couldn't load conveyance — retry.";
}

// Pure conveyance layer: charge types, zod schemas, km math, and the
// pending-material serial matcher. No supabase, no DOM — total over sparse
// rows so the engineer portal never throws on missing data.

/** Conveyance charge types offered in the expense dropdown.
 * NOTE: 'Place Visit' was retired in 20260926000001 — places visited are now
 * a plain timestamp+note list (engineer_place_visits), never a charge. */
export const CHARGE_TYPES = ["Toll", "Parking"] as const;

export type ChargeType = (typeof CHARGE_TYPES)[number];

const requiredOdometer = (message: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number({ error: message }).nonnegative(message),
  );

const optionalPhotoPath = z
  .preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
    z.string().max(500).optional(),
  )
  .optional();

export const dailyLogEntrySchema = z
  .object({
    log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
    morning_odometer: requiredOdometer("Morning reading is required"),
    morning_photo_path: optionalPhotoPath,
    evening_odometer: requiredOdometer("Evening reading is required"),
    evening_photo_path: optionalPhotoPath,
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .partial({ evening_odometer: true, evening_photo_path: true });

/**
 * NOTE: evening < morning is ACCEPTED here (no refine). A reversal yields
 * km null via kmTravelled (payable 0) and is surfaced to admins as a
 * `negative-km` attention item (buildAttentionItems) — never silently dropped,
 * never wrap-around math.
 */

export type DailyLogEntry = z.infer<typeof dailyLogEntrySchema>;

export const expenseEntrySchema = z.object({
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  charge_type: z.enum(CHARGE_TYPES, { error: "Charge type is required" }),
  amount: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number({ error: "Charges are required" }).positive("Charges must be above 0"),
  ),
  receipt_path: z
    .preprocess(
      (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
      z.string().max(500).optional(),
    )
    .optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

export type ExpenseEntry = z.infer<typeof expenseEntrySchema>;

/** Daily km = evening − morning odometer. Null until both readings exist. */
export function kmTravelled(log: {
  morning_odometer?: number | null;
  evening_odometer?: number | null;
}): number | null {
  const m = log?.morning_odometer;
  const e = log?.evening_odometer;
  if (typeof m !== "number" || typeof e !== "number") return null;
  if (!Number.isFinite(m) || !Number.isFinite(e) || e < m) return null;
  return Math.round((e - m) * 10) / 10;
}

/** YYYY-MM-DD in IST (conveyance days follow the app timezone, not the device). */
export function todayLocal(): string {
  return istDateKey();
}

/**
 * Write-path guard: log_date must not be after today (IST). Throws — call
 * only from the save handler, never on read paths.
 */
export function assertLogDateNotFuture(logDate: string, today: string): void {
  if (logDate > today) {
    throw new Error(`Future log_date ${logDate} not allowed (today is ${today})`);
  }
}

/**
 * Settlement period row shape for the lock guard (subset of
 * engineer_conveyance_settlements columns — keep queries minimal).
 */
export type SettlementPeriod = {
  period_start: string;
  period_end: string;
  status: string | null | undefined;
  locked_at?: string | null | undefined;
  paid_at?: string | null | undefined;
};

/**
 * Settlement-lock guard: true when the date falls inside a locking period.
 * A settlement counts as locking when `status === "Approved"` OR `locked_at`
 * is set OR `paid_at` is set, and the date is within
 * [period_start, period_end] (date-only compare via slice(0, 10) so
 * timestamptz values compare as calendar dates). Pure — unit-tested.
 */
export function isDateInLockedPeriod(
  dateISO: string,
  settlements: SettlementPeriod[] | null | undefined,
): boolean {
  const day = (dateISO ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return (settlements ?? []).some((s) => {
    const start = (s?.period_start ?? "").slice(0, 10);
    const end = (s?.period_end ?? "").slice(0, 10);
    if (start === "" || end === "") return false;
    if (day < start || day > end) return false;
    if (s?.status === "Approved") return true;
    const lockedAt = typeof s?.locked_at === "string" ? s.locked_at.trim() : "";
    const paidAt = typeof s?.paid_at === "string" ? s.paid_at.trim() : "";
    return lockedAt !== "" || paidAt !== "";
  });
}

/**
 * Write-path guard: a non-blank daily-log photo must be the caller's own
 * upload (`engineer/<employeeId>/…`), mirroring the expense receipt check.
 * Blank stays legal (photo optional). Throws — save handler only.
 */
export function assertOwnLogPhoto(
  photoPath: string | null | undefined,
  employeeId: string,
  which: "morning" | "evening",
): void {
  if (photoPath == null || photoPath.trim() === "") return;
  if (!photoPath.startsWith(`engineer/${employeeId}/`)) {
    throw new Error(`Forbidden: ${which} photo must be your own upload`);
  }
}

export type FsrDefectiveLine = {
  case_id?: string | null;
  name?: string | null;
  serial?: string | null;
};

/**
 * Pending-material matcher: defective FSR serials on the engineer's tickets
 * minus serials already received into stock via GRN.
 * Lines without a serial are excluded (nothing to match a GRN against).
 */
export function pendingMaterialSerials<T extends FsrDefectiveLine>(
  defectiveLines: T[] | null | undefined,
  grnSerials: (string | null | undefined)[] | null | undefined,
): T[] {
  const received = new Set(
    (grnSerials ?? [])
      .map((s) => (typeof s === "string" ? s.trim().toLowerCase() : ""))
      .filter((s) => s !== ""),
  );
  return (defectiveLines ?? []).filter((l) => {
    const serial = typeof l?.serial === "string" ? l.serial.trim() : "";
    if (serial === "") return false;
    return !received.has(serial.toLowerCase());
  });
}

export type EmployeeDocument = {
  name: string;
  path: string;
  uploaded_at: string;
};

/** Fail-soft documents parser for employees.documents jsonb. */
export function asEmployeeDocuments(value: unknown): EmployeeDocument[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (d): d is Record<string, unknown> =>
        !!d &&
        typeof d === "object" &&
        typeof (d as Record<string, unknown>).path === "string" &&
        ((d as Record<string, unknown>).path as string).trim() !== "",
    )
    .map((d) => ({
      name: typeof d.name === "string" && d.name.trim() !== "" ? d.name.trim() : "Document",
      path: d.path as string,
      uploaded_at: typeof d.uploaded_at === "string" ? d.uploaded_at : "",
    }));
}

/** Fixed profile document blocks matched by name on the engineer profile page. */
export const PROFILE_DOC_TYPES = [
  "Aadhaar",
  "PAN",
  "Driving Licence",
  "Bank Passbook",
  "Photo",
  "Other",
] as const;

export type ProfileDocType = (typeof PROFILE_DOC_TYPES)[number];

/** Find a document by name (case-insensitive, trimmed). Undefined-safe. */
export function findDocByName(
  docs: EmployeeDocument[] | null | undefined,
  name: string,
): EmployeeDocument | undefined {
  const needle = name.trim().toLowerCase();
  return (docs ?? []).find((d) => d.name.trim().toLowerCase() === needle);
}

/**
 * Replace the matching document in place (preserving order) or append when
 * absent. Returns a new array — never mutates the input.
 */
export function upsertDocByName(
  docs: EmployeeDocument[] | null | undefined,
  entry: EmployeeDocument,
): EmployeeDocument[] {
  const list = docs ?? [];
  const needle = entry.name.trim().toLowerCase();
  const idx = list.findIndex((d) => d.name.trim().toLowerCase() === needle);
  if (idx === -1) return [...list, entry];
  return list.map((d, i) => (i === idx ? entry : d));
}

// ---- Place-visit list (timestamp + typed note, never a charge) ----

export const placeVisitSchema = z.object({
  visited_at: z.string().datetime({ message: "Visit time must be ISO" }).optional(),
  note: z.string().trim().min(1, "Place is required").max(300),
});

export type PlaceVisitEntry = z.infer<typeof placeVisitSchema>;

export type PlaceVisitRow = {
  id: string;
  visited_at: string;
  note: string;
};

// ---- Pending payout (unpaid settlements only) ----

export type SettlementPayoutRow = {
  computed_amount: number | null | undefined;
  flat_expenses: number | null | undefined;
  adjusted_amount: number | null | undefined;
  status: string | null | undefined;
  paid_at: string | null | undefined;
};

/**
 * Sum of settlement rows not yet marked paid. Rejected rows excluded.
 * Per row: (adjusted_amount ?? computed_amount ?? 0) + (flat_expenses ?? 0).
 * Pure — unit-tested.
 */
export function pendingPayoutTotal(rows: SettlementPayoutRow[] | null | undefined): number {
  return (rows ?? [])
    .filter((r) => !r?.paid_at && (r?.status ?? "") !== "Rejected")
    .reduce((sum, r) => {
      const base =
        typeof r?.adjusted_amount === "number"
          ? r.adjusted_amount
          : typeof r?.computed_amount === "number"
            ? r.computed_amount
            : 0;
      const flat = typeof r?.flat_expenses === "number" ? r.flat_expenses : 0;
      return sum + base + flat;
    }, 0);
}

// ---- Dashboard assembler (pure; the page stays thin) ----

/** Ticket statuses that leave the pending-calls count (exact match, mirrors the queue filter). */
export const TERMINAL_TICKET_STATUSES: ReadonlySet<string> = new Set(["Closed", "Cancelled"]);

/** Today-view: Assigned = all assigned today; Pending = not started (New/Call Log); Completed = Closed. */
export const NOT_STARTED_TICKET_STATUSES: ReadonlySet<string> = new Set(["New", "Call Log"]);

export type DashboardTicket = { id: string; status: string | null };

export type DashboardPendingMaterial = {
  ticket_id: string;
  case_id: string;
  name: string;
  serial: string;
};

export type DashboardDayLog = {
  morning_odometer: number | null;
  evening_odometer: number | null;
} | null;

export type DashboardStats = {
  employeeName: string;
  pendingCalls: number;
  completedVisits: number;
  materialHolding: number;
  materialPending: DashboardPendingMaterial[];
  todayKm: number | null;
  todayLogDate: string;
  warnings: string[];
  assignedToday: number;
  pendingToday: number;
  completedToday: number;
  pendingPayout: number;
};

/**
 * Assemble dashboard cards from independently-fetched parts. Every part is
 * optional (fail-soft) so one failed query degrades its card, never the page.
 */
export function assembleDashboardStats(input: {
  employeeName: string | null | undefined;
  tickets: DashboardTicket[] | null | undefined;
  todayTickets?: DashboardTicket[] | null | undefined;
  pendingPayout?: number | null | undefined;
  completedVisits: number | null | undefined;
  dayLog: DashboardDayLog | undefined;
  materialHolding: number | null | undefined;
  materialPending: DashboardPendingMaterial[] | null | undefined;
  warnings: string[];
  todayLogDate: string;
}): DashboardStats {
  const tickets = input.tickets ?? [];
  const todayTickets = input.todayTickets ?? [];
  return {
    employeeName: input.employeeName ?? "",
    pendingCalls: tickets.filter((t) => !TERMINAL_TICKET_STATUSES.has(t.status ?? "")).length,
    completedVisits: typeof input.completedVisits === "number" ? input.completedVisits : 0,
    materialHolding: typeof input.materialHolding === "number" ? input.materialHolding : 0,
    materialPending: input.materialPending ?? [],
    todayKm: input.dayLog
      ? kmTravelled({
          morning_odometer: input.dayLog.morning_odometer,
          evening_odometer: input.dayLog.evening_odometer,
        })
      : null,
    todayLogDate: input.todayLogDate,
    warnings: input.warnings,
    assignedToday: todayTickets.length,
    pendingToday: todayTickets.filter((t) =>
      NOT_STARTED_TICKET_STATUSES.has((t.status ?? "").trim()),
    ).length,
    completedToday: todayTickets.filter((t) => (t.status ?? "").trim() === "Closed").length,
    pendingPayout: typeof input.pendingPayout === "number" ? input.pendingPayout : 0,
  };
}
