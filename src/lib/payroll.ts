import { supabase } from "@/integrations/supabase/client";

export type AttCode = "P" | "A" | "H";

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

export const codeValue = (c: AttCode | undefined): number =>
  c === "P" ? 1 : c === "H" ? 0.5 : 0;

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
  attendance: Record<number, AttCode>;
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
  let paid: number;
  if (presentDays >= totalDays) paid = totalDays + 1;
  else if (presentDays === totalDays - 1) paid = totalDays;
  else paid = presentDays + 1;
  const maxAllowed = Math.min(totalDays + 1, eligibleWorkingDays + 1);
  paid = Math.min(paid, maxAllowed);
  return { paidDays: paid, benefit: Math.max(0, paid - presentDays) };
}

export function computeRow(
  emp: Employee,
  year: number,
  month: number,
  attendance: Record<number, AttCode>,
  advanceEmi: number,
  deductions: number,
  record: SalaryRecord | null,
): ComputedRow {
  const dim = daysInMonth(year, month);
  const monthly = Number(emp.monthly_salary ?? 0);
  const perDay = dim > 0 ? monthly / dim : 0;
  const eligible = eligibleRange(emp, year, month);
  let presentDays = 0;
  for (let d = eligible.start; d <= eligible.end; d++) presentDays += codeValue(attendance[d]);
  const eligibleWorkingDays = Math.max(0, eligible.end - eligible.start + 1);

  const auto = computePaidDays(presentDays, dim, eligibleWorkingDays);
  const overridePaid = record?.override_paid_days ?? null;
  const paidDays = overridePaid != null ? Number(overridePaid) : auto.paidDays;
  const paidLeaveBenefit = overridePaid != null ? Math.max(0, paidDays - presentDays) : auto.benefit;

  const grossSalary = perDay * paidDays;

  const overrideEmi = record?.override_emi ?? null;
  const wantedEmi = overrideEmi != null ? Number(overrideEmi) : advanceEmi;
  // Never allow a negative salary: cap EMI at what's payable, carry the rest forward.
  const payableAfterDeductions = Math.max(0, grossSalary - deductions);
  const emiDeduction = Math.min(wantedEmi, payableAfterDeductions);
  const emiCarryForward = Math.max(0, wantedEmi - emiDeduction);

  const overrideNet = record?.override_net ?? null;
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
    .select("employee_id,work_date,code")
    .gte("work_date", from)
    .lte("work_date", to);
  if (error) throw error;
  const map: Record<string, Record<number, AttCode>> = {};
  for (const r of (data ?? []) as { employee_id: string; work_date: string; code: string }[]) {
    const day = Number(r.work_date.slice(8, 10));
    (map[r.employee_id] ??= {})[day] = (r.code as AttCode) ?? "A";
  }
  return map;
}

export async function saveAttendance(rows: { employee_id: string; work_date: string; code: AttCode }[]) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "employee_id,work_date" });
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
