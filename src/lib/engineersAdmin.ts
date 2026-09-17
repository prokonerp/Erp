// Pure admin-payable helpers for the Engineers admin module (Task B0-3).
//
// Zero imports from React / Supabase / components. Only IST date helpers
// from @/lib/time plus shapes defined locally in this file. Every function
// is fail-soft: bad input yields null/empty, never a throw.

import { istDateKey } from "@/lib/time";

// ---- Local shapes (mirror source field names, no rival names) ----
// Rates/settlements mirror engineer_conveyance_rates /
// engineer_conveyance_settlements columns (migration 20260925000001):
// employee_id, rate_per_km, effective_from / period_start, period_end,
// status (Pending/Approved/Rejected), reference_no.
// Day logs + expenses mirror DailyLogEntry / ExpenseEntry field names in
// engineer-conveyance.ts (log_date, morning_odometer, evening_odometer /
// expense_date, charge_type, amount, receipt_path). Docs mirror
// EmployeeDocument ({ name, path }).

export type AdminRate = {
  employee_id?: string | null;
  rate_per_km?: number | string | null;
  effective_from?: string | null;
};

type PayableDay = {
  log_date?: string | null;
  morning_odometer?: number | null;
  evening_odometer?: number | null;
};

type PayableExpense = {
  expense_date?: string | null;
  charge_type?: string | null;
  amount?: number | string | null;
  receipt_path?: string | null;
};

type AdminDoc = {
  name?: string | null;
  path?: string | null;
};

type AdminSettlement = {
  period_start?: string | null;
  period_end?: string | null;
  status?: string | null;
};

type AttentionInput = {
  employeeId?: string | null;
  rates?: AdminRate[] | null;
  days?: PayableDay[] | null;
  expenses?: PayableExpense[] | null;
  docs?: AdminDoc[] | null;
  settlement?: AdminSettlement | null;
  pendingParts?: { serial?: string | null }[] | null;
  todayISO?: string | null;
};

// Fixed profile document blocks, mirrored from PROFILE_DOC_TYPES in
// engineer-conveyance.ts (kept local: this module takes no value imports
// except @/lib/time).
const PROFILE_DOC_NAMES = [
  "Aadhaar",
  "PAN",
  "Driving Licence",
  "Bank Passbook",
  "Photo",
  "Other",
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function asDateKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const k = v.slice(0, 10);
  return DATE_RE.test(k) ? k : null;
}

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? (n as number) : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Day km = evening − morning; null until both readings exist and agree. */
function dayKm(morning: unknown, evening: unknown): number | null {
  if (typeof morning !== "number" || typeof evening !== "number") return null;
  if (!Number.isFinite(morning) || !Number.isFinite(evening) || evening < morning) return null;
  return Math.round((evening - morning) * 10) / 10;
}

/**
 * Latest rate_per_km with effective_from <= onDate for the employee.
 * Missing-rate signal is null — never throws.
 */
export function rateInForce(
  rates: AdminRate[] | null | undefined,
  employeeId: string | null | undefined,
  onDateISO: string | null | undefined,
): number | null {
  if (!employeeId || typeof employeeId !== "string") return null;
  const onDate = asDateKey(onDateISO);
  if (!onDate) return null;
  let bestFrom = "";
  let bestRate: number | null = null;
  for (const r of rates ?? []) {
    if (!r || r.employee_id !== employeeId) continue;
    const from = asDateKey(r.effective_from);
    if (!from || from > onDate) continue;
    const rate = asFiniteNumber(r.rate_per_km);
    if (rate === null || rate <= 0) continue;
    if (bestRate === null || from > bestFrom) {
      bestFrom = from;
      bestRate = rate;
    }
  }
  return bestRate;
}

/**
 * Period payable: km×rate per day via rateInForce plus flat expenses.
 * Days with no rate in force contribute amount 0 with rate null (the
 * missing-rate flag — callers surface it via buildAttentionItems).
 */
export function payableForPeriod(input: {
  employeeId: string | null | undefined;
  rates?: AdminRate[] | null;
  days?: PayableDay[] | null;
  expenses?: PayableExpense[] | null;
}): {
  perDay: { date: string; km: number; rate: number | null; amount: number }[];
  flatTotal: number;
  amountTotal: number;
  grandTotal: number;
} {
  const src = input ?? ({} as NonNullable<typeof input>);
  const days = [...(src.days ?? [])]
    .filter((d) => !!d && asDateKey(d.log_date) !== null)
    .sort((a, b) => (asDateKey(a.log_date) as string) < (asDateKey(b.log_date) as string) ? -1 : 1);
  const perDay = days.map((d) => {
    const date = asDateKey(d.log_date) as string;
    const km = dayKm(d.morning_odometer, d.evening_odometer) ?? 0;
    const rate =
      typeof src.employeeId === "string" ? rateInForce(src.rates, src.employeeId, date) : null;
    return { date, km, rate, amount: rate === null ? 0 : round2(km * rate) };
  });
  let flatTotal = 0;
  for (const e of src.expenses ?? []) {
    if (!e) continue;
    flatTotal += asFiniteNumber(e.amount) ?? 0;
  }
  flatTotal = round2(flatTotal);
  const amountTotal = round2(perDay.reduce((s, d) => s + d.amount, 0));
  return { perDay, flatTotal, amountTotal, grandTotal: round2(amountTotal + flatTotal) };
}

/**
 * Admin override wins only with a non-blank reason; otherwise current stands.
 */
export function resolveAdjustment(
  current: number | null | undefined,
  override: number | string | null | undefined,
  reason: string | null | undefined,
): { value: number | null; overridden: boolean } {
  const fallback = asFiniteNumber(current);
  const reasonOk = typeof reason === "string" && reason.trim() !== "";
  const next = asFiniteNumber(override);
  if (reasonOk && next !== null) return { value: next, overridden: true };
  return { value: fallback, overridden: false };
}

/** Day-level odometer flags: negative, missing, or outlier (>300 km/day). */
export function kmFlags(
  morning: number | null | undefined,
  evening: number | null | undefined,
): string[] {
  const mOk = typeof morning === "number" && Number.isFinite(morning);
  const eOk = typeof evening === "number" && Number.isFinite(evening);
  if (!mOk || !eOk) return ["missing-reading"];
  if ((evening as number) < (morning as number)) return ["negative-km"];
  if ((evening as number) - (morning as number) > 300) return ["km-outlier"];
  return [];
}

/** Which of the 6 fixed profile doc blocks are present (non-blank path). */
export function docCompliance(docs: AdminDoc[] | null | undefined): {
  present: string[];
  missing: string[];
} {
  const have = new Set(
    (docs ?? [])
      .filter((d) => !!d && typeof d.path === "string" && d.path.trim() !== "")
      .map((d) => String(d.name ?? "").trim().toLowerCase()),
  );
  const present: string[] = [];
  const missing: string[] = [];
  for (const t of PROFILE_DOC_NAMES) {
    if (have.has(t.toLowerCase())) present.push(t);
    else missing.push(t);
  }
  return { present, missing };
}

/**
 * One attention item per defect kind (never duplicates for the same kind):
 * missing rate, missing evening reading, missing receipt, missing doc,
 * km outlier, odometer reversal (negative-km), unapproved settlement past
 * cut-off, unreturned parts.
 * Today defaults to the IST calendar date (time.ts); tests pin todayISO.
 */
export function buildAttentionItems(
  input: AttentionInput | null | undefined,
): { key: string; severity: "high" | "medium" | "low"; label: string }[] {
  const src: AttentionInput = input ?? {};
  const days = src.days ?? [];
  const expenses = src.expenses ?? [];
  const items: { key: string; severity: "high" | "medium" | "low"; label: string }[] = [];

  const missingRateDays = days.filter(
    (d) =>
      !!d &&
      asDateKey(d.log_date) !== null &&
      (typeof src.employeeId !== "string" ||
        rateInForce(src.rates, src.employeeId, asDateKey(d.log_date) as string) === null),
  );
  if (missingRateDays.length > 0) {
    items.push({
      key: "missing-rate",
      severity: "high",
      label: `No conveyance rate in force for ${missingRateDays.length} day(s) — set a rate before approving.`,
    });
  }

  if (days.some((d) => !!d && (typeof d.evening_odometer !== "number" || !Number.isFinite(d.evening_odometer)))) {
    items.push({
      key: "missing-evening",
      severity: "medium",
      label: "Evening odometer reading missing for at least one day.",
    });
  }

  if (
    expenses.some(
      (e) => !!e && (typeof e.receipt_path !== "string" || e.receipt_path.trim() === ""),
    )
  ) {
    items.push({
      key: "missing-receipt",
      severity: "low",
      label: "Receipt missing for at least one expense.",
    });
  }

  const missingDocs = docCompliance(src.docs).missing;
  if (missingDocs.length > 0) {
    items.push({
      key: "missing-doc",
      severity: "medium",
      label: `Profile documents missing: ${missingDocs.join(", ")}.`,
    });
  }

  if (
    days.some((d) => {
      const km = !!d ? dayKm(d.morning_odometer, d.evening_odometer) : null;
      return km !== null && km > 300;
    })
  ) {
    items.push({
      key: "km-outlier",
      severity: "medium",
      label: "At least one day exceeds 300 km — verify odometer readings.",
    });
  }

  // Odometer reversal (evening < morning): accepted server-side, km null /
  // payable 0, flagged here exactly once no matter how many days reverse.
  const negativeKmDays = days.filter(
    (d) => !!d && kmFlags(d.morning_odometer, d.evening_odometer).includes("negative-km"),
  );
  if (negativeKmDays.length > 0) {
    items.push({
      key: "negative-km",
      severity: "medium",
      label: `Odometer reversal on ${negativeKmDays.length} day(s) — evening reading below morning, verify readings.`,
    });
  }

  const today = asDateKey(src.todayISO) ?? istDateKey();
  const periodEnd = asDateKey(src.settlement?.period_end);
  if (periodEnd !== null && periodEnd < today && src.settlement?.status !== "Approved") {
    items.push({
      key: "unapproved-past-cutoff",
      severity: "high",
      label: `Settlement period ended ${periodEnd} and is still ${src.settlement?.status ?? "undecided"} — approve or reject.`,
    });
  }

  if (
    (src.pendingParts ?? []).some(
      (p) => !!p && typeof p.serial === "string" && p.serial.trim() !== "",
    )
  ) {
    items.push({
      key: "unreturned-parts",
      severity: "medium",
      label: "Defective parts still pending return to stock.",
    });
  }

  return items;
}

/** Flat expenses grouped by charge_type with row count and summed total. */
export function groupExpensesByType(
  expenses: PayableExpense[] | null | undefined,
): Record<string, { count: number; total: number }> {
  const out: Record<string, { count: number; total: number }> = {};
  for (const e of expenses ?? []) {
    if (!e) continue;
    const type =
      typeof e.charge_type === "string" && e.charge_type.trim() !== "" ? e.charge_type.trim() : "Unknown";
    const amount = asFiniteNumber(e.amount) ?? 0;
    const slot = out[type] ?? { count: 0, total: 0 };
    slot.count += 1;
    slot.total = round2(slot.total + amount);
    out[type] = slot;
  }
  return out;
}

// ---- Admin hook shapes (TASK 1) ---------------------------------------
// Roster rows mirror list_engineers() (migration 20260925000001 §6):
// employee_id, name, phone, email, active, auth_user_id, photo_path.
// Warnings are per-section fail-soft signals — never inferred from
// count === 0 because RLS-denied reads return 0 rows.

export type AdminEngineer = {
  employee_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  active: boolean | null;
  auth_user_id: string | null;
  photo_path: string | null;
};

export type AdminWarning = {
  section: string;
  message: string;
};

/**
 * Normalize an IST calendar window for SQL date bounds. String compare is
 * deliberate: YYYY-MM-DD bounds compare lexicographically, so an inverted
 * window swaps instead of querying backwards. A single bad bound falls back
 * to the valid side; both bad fall back to today's IST date. Never throws.
 */
export function payableWindow(
  from: string | null | undefined,
  to: string | null | undefined,
): { from: string; to: string } {
  const fallback = istDateKey();
  const f = asDateKey(from) ?? asDateKey(to) ?? fallback;
  const t = asDateKey(to) ?? asDateKey(from) ?? fallback;
  return f <= t ? { from: f, to: t } : { from: t, to: f };
}
