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
    .sort((a, b) =>
      (asDateKey(a.log_date) as string) < (asDateKey(b.log_date) as string) ? -1 : 1,
    );
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
    // Clamp per-row negatives to 0 (legacy history guard; schema blocks new negatives).
    flatTotal += Math.max(0, asFiniteNumber(e.amount) ?? 0);
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
      .map((d) =>
        String(d.name ?? "")
          .trim()
          .toLowerCase(),
      ),
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

  if (
    days.some(
      (d) =>
        !!d && (typeof d.evening_odometer !== "number" || !Number.isFinite(d.evening_odometer)),
    )
  ) {
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
      typeof e.charge_type === "string" && e.charge_type.trim() !== ""
        ? e.charge_type.trim()
        : "Unknown";
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
  /**
   * Portal-link annotation added by migration 20260925000007:
   * 'linked' = has a portal login (auth_user_id), 'unlinked' = roster row that
   * exists only via the engineer-role fallback. OPTIONAL on purpose — it is
   * `undefined` until that migration is applied, and every reader must treat
   * unknown as "don't claim anything" rather than defaulting to linked.
   */
  link_status?: string | null;
};

export type AdminWarning = {
  section: string;
  message: string;
};

/**
 * Append-only guard for engineer_conveyance_rates: one row per
 * (employee_id, effective_from) — mirrors the DB constraint
 * engineer_conveyance_rates_one_per_day (migration 20260925000001).
 * Rates are never updated or deleted; a correction is a new row.
 * Malformed existing rows are skipped; bad input yields ok:false, never a throw.
 */
export function validateRateAppend(
  rates: AdminRate[] | null | undefined,
  employeeId: string | null | undefined,
  effectiveFrom: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!employeeId || typeof employeeId !== "string") {
    return { ok: false, error: "Select an engineer first." };
  }
  const day = asDateKey(effectiveFrom);
  if (!day) return { ok: false, error: "Effective date must be YYYY-MM-DD." };
  for (const r of rates ?? []) {
    if (!r || r.employee_id !== employeeId) continue;
    if (asDateKey(r.effective_from) === day) {
      return { ok: false, error: `A rate already exists for ${day} — append a new day instead.` };
    }
  }
  return { ok: true };
}

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

/**
 * Settlement status-change guard (TASK 3): locked periods are immutable.
 * - paid_at set (non-blank) → refuse re-pay (already-paid rows are terminal).
 * - locked_at set (non-blank) → refuse any change.
 * - status Approved → refuse (terminal; corrections belong in a new period).
 * - Pending/Rejected → Approved/Rejected ok.
 * - A finite override amount wins only with a non-blank reason (the
 *   resolveAdjustment rule) — override without reason refuses, so the
 *   computed total stands. Bad input yields ok:false, never a throw.
 */
export function settlementStatusChangeAllowed(
  settlement:
    | { status?: string | null; locked_at?: string | null; paid_at?: string | null }
    | null
    | undefined,
  nextStatus: "Approved" | "Rejected",
  opts?: { overriddenAmount?: number | string | null; reason?: string | null },
): { ok: true } | { ok: false; error: string } {
  if (nextStatus !== "Approved" && nextStatus !== "Rejected") {
    return { ok: false, error: "Status must be Approved or Rejected." };
  }
  const paidAt =
    typeof settlement?.paid_at === "string" ? settlement.paid_at.trim() : settlement?.paid_at;
  if (paidAt != null && paidAt !== "") {
    return { ok: false, error: "Settlement is already paid — it cannot be paid again." };
  }
  const lockedAt =
    typeof settlement?.locked_at === "string" ? settlement.locked_at.trim() : settlement?.locked_at;
  if (lockedAt != null && lockedAt !== "") {
    return { ok: false, error: "Settlement period is locked — it cannot be changed." };
  }
  if (settlement?.status === "Approved") {
    return { ok: false, error: "Approved settlements are final — open a new period instead." };
  }
  const raw = opts?.overriddenAmount;
  const override =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : NaN;
  if (Number.isFinite(override)) {
    // Mirrors resolveAdjustment: the override wins only with a reason.
    const r = resolveAdjustment(null, override, opts?.reason);
    if (!r.overridden) return { ok: false, error: "An override amount needs a reason." };
  }
  return { ok: true };
}

/**
 * Mark-paid guard: only an exactly-"Approved", unpaid, unlocked settlement
 * may be marked paid. Paid/locked refusal semantics mirror
 * settlementStatusChangeAllowed (paid first, then locked). Bad input yields
 * ok:false, never a throw.
 */
export function markPaidAllowed(
  settlement:
    | { status?: string | null; locked_at?: string | null; paid_at?: string | null }
    | null
    | undefined,
): { ok: true } | { ok: false; error: string } {
  const paidAt =
    typeof settlement?.paid_at === "string" ? settlement.paid_at.trim() : settlement?.paid_at;
  if (paidAt != null && paidAt !== "") {
    return { ok: false, error: "Settlement is already paid — it cannot be paid again." };
  }
  const lockedAt =
    typeof settlement?.locked_at === "string" ? settlement.locked_at.trim() : settlement?.locked_at;
  if (lockedAt != null && lockedAt !== "") {
    return { ok: false, error: "Settlement period is locked — it cannot be changed." };
  }
  if (settlement?.status !== "Approved") {
    return { ok: false, error: "Only Approved settlements can be marked paid." };
  }
  return { ok: true };
}

// ---- Engineers console Phase 1: overview foundation -------------------
// Pure, fail-soft overview aggregators. Bad input yields null/empty, never
// a throw. Reuse only the helpers above (rateInForce, dayKm, kmFlags,
// docCompliance, buildAttentionItems, groupExpensesByType is intentionally
// unused here — no by-type breakdown in Phase 1) plus istDateKey/asDateKey.
// IST rule: only YYYY-MM-DD string compare for date columns; closed_at
// (timestamptz) is truncated via asDateKey before comparing.

export type RosterKpis = {
  totalEngineers: number;
  openTickets: number;
  attentionHigh: number;
  kmMonth: number;
};

export type PerEngineerSummaryInput = {
  engineer: AdminEngineer;
  rates?: AdminRate[] | null;
  days?: PayableDay[] | null;
  expenses?: PayableExpense[] | null;
  docs?: AdminDoc[] | null;
  settlement?: AdminSettlement | null;
  tickets?: { status?: string | null; closed_at?: string | null }[] | null;
  todayISO?: string | null;
};

export type PerEngineerSummary = {
  employeeId: string;
  name: string;
  openTickets: number;
  closed30d: number;
  kmMonth: number;
  expensesMonth: number;
  docsMissing: string[];
  attention: { severity: "high" | "medium" | "low"; key: string; label: string }[];
  rateToday: number | null;
};

export type AttentionQueueItem = {
  employeeId: string;
  name: string;
  severity: "high" | "medium" | "low";
  key: string;
  label: string;
};

export type ConveyanceMatrixRow = {
  log_date: string;
  morning: number | null;
  evening: number | null;
  km: number | null;
  flags: string[];
};

export type CustodyLedgerRow = {
  stock_item_id: string | null;
  custodian_employee_id: string | null;
  custodian_name: string | null;
  part_serial_no: string | null;
  ticket_id: string | null;
  set_at: string | null;
};

/** Open = anything not Closed/Cancelled (tickets dashboard convention). */
function isOpenTicket(status: unknown): boolean {
  return status !== "Closed" && status !== "Cancelled";
}

/** Sum of dayKm for days inside the IST month of `todayKey` (YYYY-MM-DD). */
function monthKm(days: PayableDay[] | null | undefined, todayKey: string): number {
  const prefix = todayKey.slice(0, 7);
  let sum = 0;
  for (const d of days ?? []) {
    if (!d) continue;
    const key = asDateKey(d.log_date);
    if (!key || !key.startsWith(prefix)) continue;
    // dayKm is fail-soft (null until both readings exist and agree).
    sum += dayKm(d.morning_odometer, d.evening_odometer) ?? 0;
  }
  return Math.round(sum * 10) / 10;
}

/**
 * Console KPIs from roster + ticket statuses + day logs. attentionHigh
 * defaults to the count of high-severity items from buildAttentionItems over
 * the same day set (0 when no days carry a high-severity defect); pass a
 * non-empty per-engineer summaries list to count summaries carrying at least
 * one high-severity item instead. The real per-engineer queue comes from
 * attentionQueue via useAttentionQueue.
 * todayISO pins "current month" for tests; defaults to the IST date.
 */
export function rosterKpis(
  roster: AdminEngineer[] | null | undefined,
  tickets: { status?: string | null }[] | null | undefined,
  days: PayableDay[] | null | undefined,
  todayISO?: string | null,
  summaries?: PerEngineerSummary[] | null,
): RosterKpis {
  const list = Array.isArray(roster) ? roster : [];
  const tix = Array.isArray(tickets) ? tickets : [];
  const today = asDateKey(todayISO) ?? istDateKey();
  const attentionHigh =
    Array.isArray(summaries) && summaries.length > 0
      ? summaries.filter(
          (s) =>
            !!s &&
            Array.isArray(s.attention) &&
            s.attention.some((a) => !!a && a.severity === "high"),
        ).length
      : buildAttentionItems({ days: Array.isArray(days) ? days : [], todayISO: today }).filter(
          (a) => a.severity === "high",
        ).length;
  return {
    totalEngineers: list.length,
    openTickets: tix.filter((t) => !!t && isOpenTicket(t.status)).length,
    attentionHigh,
    kmMonth: monthKm(Array.isArray(days) ? days : [], today),
  };
}

/**
 * One engineer's console card inputs. closed30d counts status === "Closed"
 * rows whose closed_at date key falls in [today − 30d, today]. expensesMonth
 * sums current-month expense amounts (round2, like groupExpensesByType
 * totals). Bad engineer input yields an empty card, never a throw.
 */
export function perEngineerSummary(
  input: PerEngineerSummaryInput | null | undefined,
): PerEngineerSummary {
  const empty = {
    employeeId: "",
    name: "",
    openTickets: 0,
    closed30d: 0,
    kmMonth: 0,
    expensesMonth: 0,
    docsMissing: [] as string[],
    attention: [] as PerEngineerSummary["attention"],
    rateToday: null as number | null,
  };
  const src = input ?? ({} as PerEngineerSummaryInput);
  const eng = src.engineer;
  if (!eng || typeof eng.employee_id !== "string" || eng.employee_id === "") return empty;
  const employeeId = eng.employee_id;
  const today = asDateKey(src.todayISO) ?? istDateKey();
  const prefix = today.slice(0, 7);
  const tix = Array.isArray(src.tickets) ? src.tickets : [];

  const dayMs = new Date(`${today}T00:00:00+05:30`).getTime();
  const cutoff = Number.isFinite(dayMs) ? istDateKey(new Date(dayMs - 30 * 86_400_000)) : today;
  const closed30d = tix.filter(
    (t) =>
      !!t &&
      t.status === "Closed" &&
      (asDateKey(t.closed_at) ?? "") >= cutoff &&
      (asDateKey(t.closed_at) ?? "") <= today,
  ).length;

  let expensesMonth = 0;
  for (const e of src.expenses ?? []) {
    if (!e) continue;
    const key = asDateKey(e.expense_date);
    if (!key || !key.startsWith(prefix)) continue;
    expensesMonth += asFiniteNumber(e.amount) ?? 0;
  }
  expensesMonth = round2(expensesMonth);

  const docs = Array.isArray(src.docs) ? src.docs : [];
  return {
    employeeId,
    name: typeof eng.name === "string" && eng.name !== "" ? eng.name : employeeId,
    openTickets: tix.filter((t) => !!t && isOpenTicket(t.status)).length,
    closed30d,
    kmMonth: monthKm(Array.isArray(src.days) ? src.days : [], today),
    expensesMonth,
    docsMissing: docCompliance(docs).missing,
    attention: buildAttentionItems({
      employeeId,
      rates: src.rates,
      days: src.days,
      expenses: src.expenses,
      docs,
      settlement: src.settlement,
      todayISO: today,
    }),
    rateToday: rateInForce(src.rates, employeeId, today),
  };
}

const SEVERITY_RANK: Record<AttentionQueueItem["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Flatten per-engineer attention lists into one queue sorted
 * high → medium → low, then name. Unknown severities are dropped.
 */
export function attentionQueue(
  summaries: PerEngineerSummary[] | null | undefined,
): AttentionQueueItem[] {
  if (!Array.isArray(summaries)) return [];
  const out: AttentionQueueItem[] = [];
  for (const s of summaries) {
    if (!s || !Array.isArray(s.attention)) continue;
    const employeeId = typeof s.employeeId === "string" ? s.employeeId : "";
    const name = typeof s.name === "string" ? s.name : "";
    for (const a of s.attention) {
      if (!a || (a.severity !== "high" && a.severity !== "medium" && a.severity !== "low"))
        continue;
      if (typeof a.key !== "string" || typeof a.label !== "string") continue;
      out.push({ employeeId, name, severity: a.severity, key: a.key, label: a.label });
    }
  }
  out.sort(
    (x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || x.name.localeCompare(y.name),
  );
  return out;
}

/**
 * Day-log matrix for the conveyance tab: one row per parseable log_date
 * (unparseable dates skipped), sorted ascending. km via dayKm, flags via
 * kmFlags — non-numeric readings coerce to null (missing-reading flag).
 */
export function conveyanceMatrix(days: PayableDay[] | null | undefined): ConveyanceMatrixRow[] {
  if (!Array.isArray(days)) return [];
  const rows: ConveyanceMatrixRow[] = [];
  for (const d of days) {
    if (!d) continue;
    const date = asDateKey(d.log_date);
    if (!date) continue;
    const morning =
      typeof d.morning_odometer === "number" && Number.isFinite(d.morning_odometer)
        ? d.morning_odometer
        : null;
    const evening =
      typeof d.evening_odometer === "number" && Number.isFinite(d.evening_odometer)
        ? d.evening_odometer
        : null;
    rows.push({
      log_date: date,
      morning,
      evening,
      km: dayKm(morning, evening),
      flags: kmFlags(morning, evening),
    });
  }
  rows.sort((a, b) => (a.log_date < b.log_date ? -1 : a.log_date > b.log_date ? 1 : 0));
  return rows;
}

/**
 * Normalize admin_stock_custody RPC rows: null-tolerant passthrough —
 * missing fields become null, non-object rows are skipped, non-array input
 * yields []. Never throws.
 */
export function custodyLedger(rows: unknown): CustodyLedgerRow[] {
  if (!Array.isArray(rows)) return [];
  const asStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const out: CustodyLedgerRow[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    out.push({
      stock_item_id: asStr(o.stock_item_id),
      custodian_employee_id: asStr(o.custodian_employee_id),
      custodian_name: asStr(o.custodian_name),
      part_serial_no: asStr(o.part_serial_no),
      ticket_id: asStr(o.ticket_id),
      set_at: asStr(o.set_at),
    });
  }
  return out;
}

// ---- FSR print polish: warning/orphan helpers -------------------------
// Pure, fail-soft list helpers for the FSR print path. Bad input yields
// empty results, never a throw.

/**
 * Flatten warning lists into one list, dropping duplicates by
 * `${section}::${message}`. First-seen order wins. Null/undefined lists
 * and entries are skipped, never throw.
 */
export function dedupeWarnings(lists: AdminWarning[][] | null | undefined): AdminWarning[] {
  const seen = new Set<string>();
  const out: AdminWarning[] = [];
  for (const list of lists ?? []) {
    if (!Array.isArray(list)) continue;
    for (const w of list) {
      if (!w || typeof w !== "object") continue;
      const key = `${w.section}::${w.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(w);
    }
  }
  return out;
}

/**
 * employee_id → display name for roster lookups. Entries with a
 * missing/blank employee_id are skipped; a blank/null name falls back to
 * the employee_id itself. Never throws.
 */
export function rosterNameMap(roster: AdminEngineer[] | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of roster ?? []) {
    if (!r || typeof r !== "object") continue;
    const id = r.employee_id;
    if (typeof id !== "string" || id.trim() === "") continue;
    const key = id.trim();
    const name = r.name;
    out.set(key, typeof name === "string" && name.trim() !== "" ? name.trim() : key);
  }
  return out;
}

/**
 * Split rows into roster hits vs orphans (ids absent from the roster
 * map). A row is an orphan iff its id is missing/blank OR not in
 * nameById; only exact roster hits land in roster. Never drops a row,
 * never throws (idOf errors fail soft to orphans as blank ids).
 */
export function partitionOrphans<T>(
  rows: T[] | null | undefined,
  nameById: Map<string, string> | null | undefined,
  idOf: (r: T) => string | null | undefined,
): { roster: T[]; orphans: T[] } {
  const roster: T[] = [];
  const orphans: T[] = [];
  const map = nameById instanceof Map ? nameById : new Map<string, string>();
  if (!Array.isArray(rows)) return { roster, orphans };
  for (const row of rows) {
    let id: string | null | undefined;
    try {
      id = row == null ? undefined : idOf(row);
    } catch {
      id = undefined;
    }
    if (typeof id !== "string" || id.trim() === "" || !map.has(id)) orphans.push(row);
    else roster.push(row);
  }
  return { roster, orphans };
}
