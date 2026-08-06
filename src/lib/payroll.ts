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
};

export type Advance = {
  id: string;
  employee_id: string;
  advance_date: string;
  amount: number;
  period_year: number | null;
  period_month: number | null;
  notes: string | null;
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
};

export function computeRow(
  emp: Employee,
  year: number,
  month: number,
  attendance: Record<number, AttCode>,
  advance: number,
  deductions: number,
  record: SalaryRecord | null,
): ComputedRow {
  const dim = daysInMonth(year, month);
  const monthly = Number(emp.monthly_salary ?? 0);
  const perDay = dim > 0 ? monthly / dim : 0;
  const eligible = eligibleRange(emp, year, month);
  let workingDays = 0;
  for (let d = eligible.start; d <= eligible.end; d++) workingDays += codeValue(attendance[d]);
  const totalSalary = perDay * workingDays;
  const netSalary = totalSalary - advance - deductions;
  return { emp, daysInMonth: dim, perDay, workingDays, totalSalary, advance, deductions, netSalary, eligible, attendance, record };
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

export async function listAdvances(year: number, month: number): Promise<Advance[]> {
  const { data, error } = await supabase
    .from("employee_advances")
    .select("id,employee_id,advance_date,amount,period_year,period_month,notes")
    .eq("period_year", year)
    .eq("period_month", month)
    .order("advance_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Advance[];
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
    working_days: row.workingDays,
    total_salary: Number(row.totalSalary.toFixed(2)),
    advance: row.advance,
    deductions: row.deductions,
    net_salary: Number(row.netSalary.toFixed(2)),
    ...(status ? { status } : {}),
    ...(status === "approved" ? { approved_at: new Date().toISOString() } : {}),
    ...(status === "paid" ? { paid_at: new Date().toISOString() } : {}),
  };
  const { error } = await supabase
    .from("salary_records")
    .upsert(payload, { onConflict: "employee_id,period_year,period_month" });
  if (error) throw error;
}
