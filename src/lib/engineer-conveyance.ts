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

/** Conveyance charge types offered in the expense dropdown. */
export const CHARGE_TYPES = ["Place Visit", "Parking", "Toll"] as const;

export type ChargeType = (typeof CHARGE_TYPES)[number];

const requiredOdometer = (message: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number({ error: message }).nonnegative(message),
  );

const optionalPhotoPath = z
  .preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
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
  .partial({ evening_odometer: true, evening_photo_path: true })
  .refine(
    (d) =>
      d.morning_odometer == null ||
      d.evening_odometer == null ||
      d.evening_odometer >= d.morning_odometer,
    {
      message: "Evening reading cannot be less than the morning reading",
      path: ["evening_odometer"],
    },
  );

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
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
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
        !!d && typeof d === "object" && typeof (d as Record<string, unknown>).path === "string",
    )
    .map((d) => ({
      name: typeof d.name === "string" && d.name.trim() !== "" ? d.name.trim() : "Document",
      path: d.path as string,
      uploaded_at: typeof d.uploaded_at === "string" ? d.uploaded_at : "",
    }));
}

// ---- Dashboard assembler (pure; the page stays thin) ----

/** Ticket statuses that leave the pending-calls count (exact match, mirrors the queue filter). */
export const TERMINAL_TICKET_STATUSES: ReadonlySet<string> = new Set(["Closed", "Cancelled"]);

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
};

/**
 * Assemble dashboard cards from independently-fetched parts. Every part is
 * optional (fail-soft) so one failed query degrades its card, never the page.
 */
export function assembleDashboardStats(input: {
  employeeName: string | null | undefined;
  tickets: DashboardTicket[] | null | undefined;
  completedVisits: number | null | undefined;
  dayLog: DashboardDayLog | undefined;
  materialHolding: number | null | undefined;
  materialPending: DashboardPendingMaterial[] | null | undefined;
  warnings: string[];
  todayLogDate: string;
}): DashboardStats {
  const tickets = input.tickets ?? [];
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
  };
}
