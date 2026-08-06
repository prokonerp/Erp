import { supabase } from "@/integrations/supabase/client";

/** Attendance type. OT = overtime entry, SW = Sunday work. */
export type AttCode = "P" | "A" | "H" | "OT" | "SW";

/** One standard shift. Work hours are converted to days against this. */
export const STANDARD_SHIFT_HOURS = 8;
export const MAX_WORK_HOURS = 24;

export type AttEntry = {
  code: AttCode;
  /** Numeric work hours; when set it takes priority over the type. */
  hours: number | null;
  /** Final day credit for the date (decimals allowed). */
  dayValue: number;
  /** True when the row has been edited after first entry. */
  edited?: boolean;
};

export type Employee = {
  id: string;
  name: string;
  role: string | null;
  department: string | null;
  active: boolean;
  joining_date: string | null;
  exit_date: string | null;
  monthly_salary: number | null;
  last_increment_date: string | null;
  increment_cycle_months: number | null;
};

export type SalaryRecord = {
  id: string;
  employee_id: string;
  period_year: number;
  period_month: number;
  days_in_month: number;
  monthly_salary: number;
  per_day_salary: number;
  working_days: number;
  total_salary: number;
  advance: number;
  deductions: number;
  net_salary: number;
  status: "draft" | "approved" | "paid" | string;
  approved_at: string | null;
  paid_at: string | null;
  present_days?: number;
  paid_leave_benefit?: number;
  paid_days?: number;
  gross_salary?: number;
  emi_deduction?: number;
  emi_carry_forward?: number;
  override_paid_days?: number | null;
  override_emi?: number | null;
  override_net?: number | null;
};

export type Advance = {
  id: string;
  employee_id: string;
  advance_date: string;
  amount: number;
  period_year: number | null;
  period_month: number | null;
  notes: string | null;
  emi_months: number;
  emi_amount: number;
  remaining_months: number;
  start_year: number | null;
  start_month: number | null;
  status: string;
};

export type SalaryRecordExtra = {
  present_days?: number;
  paid_leave_benefit?: number;
  paid_days?: number;
  gross_salary?: number;
  emi_deduction?: number;
  emi_carry_forward?: number;
  override_paid_days?: number | null;
  override_emi?: number | null;
  override_net?: number | null;
};

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Auto month-length incl. leap years. month is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export const isoDate = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Sunday auto-detect straight off the calendar. */
export const isSundayDate = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d).getDay() === 0;

/**
 * Day credit for one date.
 * Sunday: 1 (weekly off credit) + hours / 8 — unless the sandwich rule zeroes it.
 * Weekday priority: work hours (hours / 8) → attendance type.
 * Type fallback: Present = 1, Half Day = 0.5, Absent = 0.
 */
export function dayValueFor(code: AttCode | undefined, hours: number | null | undefined, sunday: boolean): number {
  const h = hours == null || hours === ("" as unknown as number) ? null : Number(hours);
  const worked = h != null && !Number.isNaN(h) && h > 0 ? Math.min(MAX_WORK_HOURS, Math.max(0, h)) / STANDARD_SHIFT_HOURS : 0;
  if (sunday) return round2(1 + worked);
  if (h != null && !Number.isNaN(h) && h > 0) {
    return round2(worked);
  }
  if (code === "SW") return 1;
  if (code === "P") return 1;
  if (code === "H") return 0.5;
  if (code === "OT") return 1;
  return 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A day counts as absent when it has no entry, or an Absent entry with no work hours. */
export function isAbsentDay(e: AttEntry | undefined): boolean {
  if (!e) return true;
  if (e.hours != null && Number(e.hours) > 0) return false;
  return e.code === "A";
}

/**
 * Sandwich rule: Saturday absent AND Monday absent → that Sunday is ignored (0 days).
 * Returns a new attendance map with Sunday day values corrected.
 */
export function applySundayRules(
  attendance: Record<number, AttEntry>,
  year: number,
  month: number,
): Record<number, AttEntry> {
  const out: Record<number, AttEntry> = { ...attendance };
  const total = daysInMonth(year, month);
  for (let d = 1; d <= total; d++) {
    if (!isSundayDate(year, month, d)) continue;
    const e = out[d];
    const sat = d - 1 >= 1 ? out[d - 1] : undefined;
    const mon = d + 1 <= total ? out[d + 1] : undefined;
    const satAbsent = d - 1 >= 1 ? isAbsentDay(sat) : false;
    const monAbsent = d + 1 <= total ? isAbsentDay(mon) : false;
    const sandwich = satAbsent && monAbsent;
    const base = e ?? { code: "A" as AttCode, hours: null, dayValue: 0 };
    out[d] = {
      ...base,
      dayValue: sandwich ? 0 : dayValueFor(base.code, base.hours, true),
    };
  }
  return out;
}

export function makeEntry(code: AttCode, hours: number | null, sunday: boolean, edited = false): AttEntry {
  return { code, hours: hours == null ? null : Number(hours), dayValue: dayValueFor(code, hours, sunday), edited };
}

/** Legacy helper kept for simple P/H/A day credit. */
export const codeValue = (c: AttCode | undefined): number => dayValueFor(c, null, false);

export const money = (n: number) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Math.round(n * 100) / 100);

/** Days in the month that the employee is actually eligible for (mid-month join / exit). */
export function eligibleRange(emp: Employee, year: number, month: number) {
  const total = daysInMonth(year, month);
  let start = 1;
  let end = total;
  if (emp.joining_date) {
    const d = new Date(emp.joining_date + "T00:00:00");
    if (d.getFullYear() > year || (d.getFullYear() === year && d.getMonth() + 1 > month)) return { start: 0, end: -1, total };
    if (d.getFullYear() === year && d.getMonth() + 1 === month) start = d.getDate();
  }
  if (emp.exit_date) {
    const d = new Date(emp.exit_date + "T00:00:00");
    if (d.getFullYear() < year || (d.getFullYear() === year && d.getMonth() + 1 < month)) return { start: 0, end: -1, total };
    if (d.getFullYear() === year && d.getMonth() + 1 === month) end = d.getDate();
  }
  return { start, end, total };
}

export type ComputedRow = {
  emp: Employee;
  daysInMonth: number;
  perDay: number;
  workingDays: number;
  totalSalary: number;
  advance: number;
  deductions: number;
  netSalary: number;
  eligible: { start: number; end: number; total: number };
  attendance: Record<number, AttEntry>;
  record: SalaryRecord | null;
  /** Attendance-derived present days (P = 1, H = 0.5). */
  presentDays: number;
  /** +1 paid leave benefit actually granted (0 when present days = 0). */
  paidLeaveBenefit: number;
  /** Final paid days after cases, mid-month cap and admin override. */
  paidDays: number;
  grossSalary: number;
  emiDeduction: number;
  /** EMI that could not be deducted this month (net would go negative). */
  emiCarryForward: number;
  overrides: { paidDays: number | null; emi: number | null; net: number | null };
};

export const monthIndex = (y: number, m: number) => y * 12 + (m - 1);

/** Is this advance's EMI schedule active for the given period? */
export function emiDueFor(a: Advance, year: number, month: number): number {
  if ((a.status ?? "active") !== "active") return 0;
  const sy = a.start_year ?? a.period_year;
  const sm = a.start_month ?? a.period_month;
  if (!sy || !sm) return 0;
  const start = monthIndex(sy, sm);
  const cur = monthIndex(year, month);
  const months = Math.max(1, Number(a.emi_months ?? 1));
  if (cur < start || cur >= start + months) return 0;
  const emi = Number(a.emi_amount ?? 0) || Number(a.amount ?? 0) / months;
  return Math.max(0, emi);
}

/**
 * Paid-days rules:
 *  present = 0                  -> 0 (no paid-leave benefit)
 *  present = total              -> total + 1
 *  present = total - 1          -> total
 *  otherwise                    -> present + 1
 * Mid-month join/exit caps paid days at (eligible working days + 1),
 * and the absolute cap is always total + 1.
 */
export function computePaidDays(presentDays: number, totalDays: number, eligibleWorkingDays: number) {
  if (presentDays <= 0) return { paidDays: 0, benefit: 0 };
  // Present days already include Sunday credit, so the +1 benefit must never
  // push the month beyond its real length (no duplicate counting).
  let paid = presentDays >= totalDays ? totalDays : round2(presentDays + 1);
  const maxAllowed = Math.min(totalDays, eligibleWorkingDays + 1);
  paid = round2(Math.min(paid, maxAllowed));
  return { paidDays: paid, benefit: Math.max(0, paid - presentDays) };
}

export function computeRow(
  emp: Employee,
  year: number,
  month: number,
  rawAttendance: Record<number, AttEntry>,
  advanceEmi: number,
  deductions: number,
  record: SalaryRecord | null,
  overrides?: { paidDays?: number | null; emi?: number | null; net?: number | null },
): ComputedRow {
  const attendance = applySundayRules(rawAttendance, year, month);
  const dim = daysInMonth(year, month);
  const monthly = Number(emp.monthly_salary ?? 0);
  const perDay = dim > 0 ? monthly / dim : 0;
  const eligible = eligibleRange(emp, year, month);
  let presentDays = 0;
  for (let d = eligible.start; d <= eligible.end; d++) presentDays += Number(attendance[d]?.dayValue ?? 0);
  presentDays = round2(Math.max(0, Math.min(presentDays, dim)));
  const eligibleWorkingDays = Math.max(0, eligible.end - eligible.start + 1);

  const auto = computePaidDays(presentDays, dim, eligibleWorkingDays);
  const overridePaid = overrides?.paidDays ?? record?.override_paid_days ?? null;
  const paidDays = overridePaid != null
    ? Math.min(Number(overridePaid), dim)
    : auto.paidDays;
  const paidLeaveBenefit = overridePaid != null ? Math.max(0, paidDays - presentDays) : auto.benefit;

  const grossSalary = perDay * paidDays;

  const overrideEmi = overrides?.emi ?? record?.override_emi ?? null;
  const wantedEmi = overrideEmi != null ? Number(overrideEmi) : advanceEmi;
  // Never allow a negative salary: cap EMI at what's payable, carry the rest forward.
  const payableAfterDeductions = Math.max(0, grossSalary - deductions);
  const emiDeduction = Math.min(wantedEmi, payableAfterDeductions);
  const emiCarryForward = Math.max(0, wantedEmi - emiDeduction);

  const overrideNet = overrides?.net ?? record?.override_net ?? null;
  const netSalary = overrideNet != null
    ? Number(overrideNet)
    : Math.max(0, grossSalary - deductions - emiDeduction);

  return {
    emp, daysInMonth: dim, perDay,
    workingDays: paidDays,
    totalSalary: grossSalary,
    advance: emiDeduction,
    deductions, netSalary, eligible, attendance, record,
    presentDays, paidLeaveBenefit, paidDays, grossSalary, emiDeduction, emiCarryForward,
    overrides: { paidDays: overridePaid, emi: overrideEmi, net: overrideNet },
  };
}

/** Salary revision due when today >= (last increment ?? DOJ) + cycle months. */
export function incrementDue(emp: Employee): { due: boolean; dueDate: Date | null } {
  const base = emp.last_increment_date ?? emp.joining_date;
  if (!base) return { due: false, dueDate: null };
  const cycle = emp.increment_cycle_months ?? 12;
  const d = new Date(base + "T00:00:00");
  const dueDate = new Date(d);
  dueDate.setMonth(dueDate.getMonth() + cycle);
  return { due: new Date() >= dueDate, dueDate };
}

export async function listEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from("employees")
    .select("id,name,role,department,active,joining_date,exit_date,monthly_salary,last_increment_date,increment_cycle_months")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as Employee[];
}

export async function listAttendance(year: number, month: number) {
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, daysInMonth(year, month));
  const { data, error } = await supabase
    .from("attendance")
    .select("employee_id,work_date,code,work_hours,day_value,created_at,updated_at")
    .gte("work_date", from)
    .lte("work_date", to);
  if (error) throw error;
  const map: Record<string, Record<number, AttEntry>> = {};
  type Row = { employee_id: string; work_date: string; code: string; work_hours: number | null; day_value: number | null; created_at: string; updated_at: string };
  for (const r of (data ?? []) as Row[]) {
    const day = Number(r.work_date.slice(8, 10));
    const code = (r.code as AttCode) ?? "A";
    const hours = r.work_hours == null ? null : Number(r.work_hours);
    const sunday = isSundayDate(year, month, day);
    (map[r.employee_id] ??= {})[day] = {
      code,
      hours,
      dayValue: r.day_value == null ? dayValueFor(code, hours, sunday) : Number(r.day_value),
      edited: !!r.updated_at && !!r.created_at && new Date(r.updated_at).getTime() - new Date(r.created_at).getTime() > 1000,
    };
  }
  return map;
}

export type AttendanceWrite = { employee_id: string; work_date: string; code: AttCode; hours: number | null };

async function currentActor() {
  const { data } = await supabase.auth.getUser();
  return { id: data.user?.id ?? null, email: data.user?.email ?? null };
}

/**
 * Upsert attendance and record an audit batch (old → new) so the action can be undone.
 * Returns the batch id.
 */
export async function saveAttendance(rows: AttendanceWrite[], action = "edit"): Promise<string | null> {
  if (rows.length === 0) return null;
  for (const r of rows) {
    const h = r.hours;
    if (h != null && (Number.isNaN(Number(h)) || Number(h) < 0 || Number(h) > MAX_WORK_HOURS)) {
      throw new Error(`Work hours must be between 0 and ${MAX_WORK_HOURS}`);
    }
  }
  const actor = await currentActor();
  const dates = rows.map((r) => r.work_date);
  const empIds = Array.from(new Set(rows.map((r) => r.employee_id)));
  const { data: existing } = await supabase
    .from("attendance")
    .select("employee_id,work_date,code,work_hours,day_value")
    .in("employee_id", empIds)
    .gte("work_date", dates.reduce((a, b) => (a < b ? a : b)))
    .lte("work_date", dates.reduce((a, b) => (a > b ? a : b)));
  const prev = new Map<string, { code: string; work_hours: number | null; day_value: number | null }>();
  for (const e of (existing ?? []) as any[]) prev.set(`${e.employee_id}|${e.work_date}`, e);

  const payload = rows.map((r) => {
    const [y, m, d] = r.work_date.split("-").map(Number);
    const sunday = isSundayDate(y, m, d);
    return {
      employee_id: r.employee_id,
      work_date: r.work_date,
      code: r.code,
      work_hours: r.hours,
      day_value: dayValueFor(r.code, r.hours, sunday),
      is_sunday: sunday,
      updated_by: actor.id,
    };
  });
  const { error } = await supabase.from("attendance").upsert(payload, { onConflict: "employee_id,work_date" });
  if (error) throw error;

  const batchId = crypto.randomUUID();
  const audit = payload.map((p) => {
    const old = prev.get(`${p.employee_id}|${p.work_date}`);
    return {
      batch_id: batchId,
      employee_id: p.employee_id,
      work_date: p.work_date,
      action,
      old_code: old?.code ?? null,
      old_hours: old?.work_hours ?? null,
      old_day_value: old?.day_value ?? null,
      new_code: p.code,
      new_hours: p.work_hours,
      new_day_value: p.day_value,
      changed_by: actor.id,
      changed_by_email: actor.email,
    };
  });
  const { error: aErr } = await supabase.from("attendance_audit").insert(audit);
  if (aErr) throw aErr;
  return batchId;
}

export type AuditRow = {
  id: string; batch_id: string; employee_id: string; work_date: string; action: string;
  old_code: string | null; old_hours: number | null; old_day_value: number | null;
  new_code: string | null; new_hours: number | null; new_day_value: number | null;
  changed_by_email: string | null; undone: boolean; created_at: string;
};

export async function listAttendanceAudit(year: number, month: number): Promise<AuditRow[]> {
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, daysInMonth(year, month));
  const { data, error } = await supabase
    .from("attendance_audit")
    .select("*")
    .gte("work_date", from)
    .lte("work_date", to)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as AuditRow[];
}

/** Restore every entry touched by a batch back to its previous value. */
export async function undoBatch(batchId: string) {
  const { data, error } = await supabase.from("attendance_audit").select("*").eq("batch_id", batchId).eq("undone", false);
  if (error) throw error;
  const rows = (data ?? []) as unknown as AuditRow[];
  if (rows.length === 0) throw new Error("Nothing to undo in this action");
  const actor = await currentActor();
  const restore = rows.filter((r) => r.old_code != null);
  const remove = rows.filter((r) => r.old_code == null);
  if (restore.length) {
    const { error: uErr } = await supabase.from("attendance").upsert(
      restore.map((r) => {
        const [y, m, d] = r.work_date.split("-").map(Number);
        return {
          employee_id: r.employee_id, work_date: r.work_date,
          code: r.old_code as string, work_hours: r.old_hours,
          day_value: r.old_day_value ?? dayValueFor(r.old_code as AttCode, r.old_hours, isSundayDate(y, m, d)),
          is_sunday: isSundayDate(y, m, d), updated_by: actor.id,
        };
      }),
      { onConflict: "employee_id,work_date" },
    );
    if (uErr) throw uErr;
  }
  for (const r of remove) {
    const { error: dErr } = await supabase.from("attendance").delete()
      .eq("employee_id", r.employee_id).eq("work_date", r.work_date);
    if (dErr) throw dErr;
  }
  const { error: mErr } = await supabase.from("attendance_audit").update({ undone: true }).eq("batch_id", batchId);
  if (mErr) throw mErr;
  return rows.length;
}

/** Clear attendance for an employee (or everyone when employeeId is null) for a month, with audit. */
export async function clearAttendance(year: number, month: number, employeeId: string | null) {
  const from = isoDate(year, month, 1);
  const to = isoDate(year, month, daysInMonth(year, month));
  let q = supabase.from("attendance").select("employee_id,work_date,code,work_hours,day_value").gte("work_date", from).lte("work_date", to);
  if (employeeId) q = q.eq("employee_id", employeeId);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as any[];
  if (rows.length === 0) throw new Error("No attendance to undo for this period");
  const actor = await currentActor();
  const batchId = crypto.randomUUID();
  const { error: aErr } = await supabase.from("attendance_audit").insert(
    rows.map((r) => ({
      batch_id: batchId, employee_id: r.employee_id, work_date: r.work_date,
      action: employeeId ? "undo_employee_month" : "undo_full_month",
      old_code: r.code, old_hours: r.work_hours, old_day_value: r.day_value,
      new_code: null, new_hours: null, new_day_value: null,
      changed_by: actor.id, changed_by_email: actor.email,
    })),
  );
  if (aErr) throw aErr;
  let del = supabase.from("attendance").delete().gte("work_date", from).lte("work_date", to);
  if (employeeId) del = del.eq("employee_id", employeeId);
  const { error: dErr } = await del;
  if (dErr) throw dErr;
  return rows.length;
}

export type AttendanceLock = { period_year: number; period_month: number; locked: boolean; locked_by_email: string | null; locked_at: string };

export async function getAttendanceLock(year: number, month: number): Promise<AttendanceLock | null> {
  const { data, error } = await supabase
    .from("attendance_locks")
    .select("period_year,period_month,locked,locked_by_email,locked_at")
    .eq("period_year", year).eq("period_month", month).maybeSingle();
  if (error) throw error;
  return (data ?? null) as AttendanceLock | null;
}

export async function setAttendanceLock(year: number, month: number, locked: boolean) {
  const actor = await currentActor();
  const { error } = await supabase.from("attendance_locks").upsert(
    {
      period_year: year, period_month: month, locked,
      locked_by: actor.id, locked_by_email: actor.email, locked_at: new Date().toISOString(),
    },
    { onConflict: "period_year,period_month" },
  );
  if (error) throw error;
}

/** All advances (EMI schedules can span months, so we filter client-side per period). */
export async function listAdvances(): Promise<Advance[]> {
  const { data, error } = await supabase
    .from("employee_advances")
    .select("id,employee_id,advance_date,amount,period_year,period_month,notes,emi_months,emi_amount,remaining_months,start_year,start_month,status")
    .order("advance_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Advance[];
}

/** Close out EMI schedules for a paid period: decrement remaining months, mark closed at zero. */
export async function settleEmiForPeriod(advances: Advance[], year: number, month: number) {
  const due = advances.filter((a) => emiDueFor(a, year, month) > 0);
  for (const a of due) {
    const months = Math.max(1, Number(a.emi_months ?? 1));
    const start = monthIndex(a.start_year ?? a.period_year ?? year, a.start_month ?? a.period_month ?? month);
    const remaining = Math.max(0, start + months - monthIndex(year, month) - 1);
    const { error } = await supabase
      .from("employee_advances")
      .update({ remaining_months: remaining, status: remaining === 0 ? "closed" : "active" })
      .eq("id", a.id);
    if (error) throw error;
  }
}

export async function listSalaryRecords(year: number, month: number): Promise<SalaryRecord[]> {
  const { data, error } = await supabase
    .from("salary_records")
    .select("*")
    .eq("period_year", year)
    .eq("period_month", month);
  if (error) throw error;
  return (data ?? []) as unknown as SalaryRecord[];
}

export async function upsertSalaryRecord(row: ComputedRow, year: number, month: number, status?: string) {
  const payload = {
    employee_id: row.emp.id,
    period_year: year,
    period_month: month,
    days_in_month: row.daysInMonth,
    monthly_salary: Number(row.emp.monthly_salary ?? 0),
    per_day_salary: Number(row.perDay.toFixed(2)),
    working_days: row.paidDays,
    total_salary: Number(row.grossSalary.toFixed(2)),
    advance: Number(row.emiDeduction.toFixed(2)),
    deductions: row.deductions,
    net_salary: Number(row.netSalary.toFixed(2)),
    present_days: row.presentDays,
    paid_leave_benefit: row.paidLeaveBenefit,
    paid_days: row.paidDays,
    gross_salary: Number(row.grossSalary.toFixed(2)),
    emi_deduction: Number(row.emiDeduction.toFixed(2)),
    emi_carry_forward: Number(row.emiCarryForward.toFixed(2)),
    override_paid_days: row.overrides.paidDays,
    override_emi: row.overrides.emi,
    override_net: row.overrides.net,
    ...(status ? { status } : {}),
    ...(status === "approved" ? { approved_at: new Date().toISOString() } : {}),
    ...(status === "paid" ? { paid_at: new Date().toISOString() } : {}),
  };
  const { error } = await supabase
    .from("salary_records")
    .upsert(payload, { onConflict: "employee_id,period_year,period_month" });
  if (error) throw error;
}
