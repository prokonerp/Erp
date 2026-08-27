import {
  dayValueFor,
  isAbsentDay,
  applySundayRules,
  computePaidDays,
  advanceSummary,
  emiDueFor,
  allocateEmi,
  computeRow,
  daysInMonth,
  type Advance,
  type Employee,
} from "@/lib/payroll";

const emp = (over: Partial<Employee> = {}): Employee => ({
  id: "e1",
  name: "Test Employee",
  role: null,
  department: null,
  active: true,
  joining_date: null,
  exit_date: null,
  monthly_salary: 31000, // Jan 2026 has 31 days → perDay = 1000
  last_increment_date: null,
  increment_cycle_months: null,
  ...over,
});

const advance = (over: Partial<Advance> = {}): Advance => ({
  id: "a1",
  employee_id: "e1",
  advance_date: "2026-01-05",
  amount: 12000,
  period_year: null,
  period_month: null,
  notes: null,
  emi_months: 6,
  emi_amount: 2000,
  remaining_months: 6,
  start_year: 2026,
  start_month: 1,
  status: "active",
  paid_amount: 0,
  paid_installments: 0,
  ...over,
});

describe("payroll/dayValueFor", () => {
  it("weekday: hours take priority over the code", () => {
    expect(dayValueFor("P", 8, false)).toBe(1);
    expect(dayValueFor("A", 4, false)).toBe(0.5); // worked half a shift
    expect(dayValueFor("H", null, false)).toBe(0.5);
    expect(dayValueFor("A", null, false)).toBe(0);
    expect(dayValueFor("P", 12, false)).toBe(1.5);
  });
  it("sunday: always credits 1 plus worked hours", () => {
    expect(dayValueFor("A", null, true)).toBe(1);
    expect(dayValueFor("SW", 8, true)).toBe(2);
  });
  it("clamps absurd hour values into [0, 24]", () => {
    // Non-positive / NaN hours are treated as "no hours info" and fall back
    // to the attendance code; only positive hours are credited.
    expect(dayValueFor("P", -5, false)).toBe(1);
    expect(dayValueFor("P", Number.NaN, false)).toBe(1);
    expect(dayValueFor("A", -5, false)).toBe(0);
    expect(dayValueFor("P", 99, false)).toBe(3);
  });
});

describe("payroll/applySundayRules — sandwich rule", () => {
  const y = 2026, m = 1; // Jan 4, 11, 18, 25 are Sundays
  it("zeroes a Sunday flanked by absent Saturday AND Monday", () => {
    // Jan 2026: Sun=4, Sat=3, Mon=5
    const att = { 3: { code: "A" as const, hours: null, dayValue: 0 }, 5: { code: "A" as const, hours: null, dayValue: 0 } };
    const out = applySundayRules(att, y, m);
    expect(out[4].dayValue).toBe(0);
  });
  it("keeps Sunday credit when either side is present", () => {
    const att = { 3: { code: "P" as const, hours: null, dayValue: 1 }, 5: { code: "A" as const, hours: null, dayValue: 0 } };
    const out = applySundayRules(att, y, m);
    expect(out[4].dayValue).toBe(1);
  });
});

describe("payroll/computePaidDays", () => {
  it("no present days → no pay, no benefit", () => {
    expect(computePaidDays(0, 31, 31)).toEqual({ paidDays: 0, benefit: 0 });
  });
  it("full month gets +1 benefit capped at month length", () => {
    expect(computePaidDays(31, 31, 31)).toEqual({ paidDays: 31, benefit: 0 });
    expect(computePaidDays(30, 31, 31).paidDays).toBe(31);
  });
  it("mid-month join caps at eligible working days + 1", () => {
    // joined on day 21 → 11 eligible days in a 31-day month
    const r = computePaidDays(11, 31, 11);
    expect(r.paidDays).toBe(12);
  });
});

describe("payroll/advanceSummary", () => {
  it("computes balance, EMI and pending installments", () => {
    const s = advanceSummary(advance({ paid_amount: 4000 }));
    expect(s.total).toBe(12000);
    expect(s.balance).toBe(8000);
    expect(s.emi).toBe(2000);
    expect(s.pendingInstallments).toBe(4);
    expect(s.closed).toBe(false);
  });
  it("flags closed when fully paid", () => {
    const s = advanceSummary(advance({ paid_amount: 12000 }));
    expect(s.balance).toBe(0);
    expect(s.closed).toBe(true);
  });
  it("never reports more paid than the advance total", () => {
    const s = advanceSummary(advance({ paid_amount: 99999 }));
    expect(s.paid).toBe(12000);
    expect(s.balance).toBe(0);
  });
});

describe("payroll/emiDueFor", () => {
  it("charges EMI inside the schedule, capped at balance", () => {
    expect(emiDueFor(advance(), 2026, 3)).toBe(2000);
    expect(emiDueFor(advance({ paid_amount: 11000 }), 2026, 6)).toBe(1000);
  });
  it("returns 0 before schedule starts / after it ends / when closed", () => {
    expect(emiDueFor(advance({ start_year: 2026, start_month: 3 }), 2026, 2)).toBe(0);
    expect(emiDueFor(advance(), 2026, 7)).toBe(0);
    expect(emiDueFor(advance({ status: "closed" }), 2026, 2)).toBe(0);
  });
  it("honours an admin skip for that period", () => {
    expect(
      emiDueFor(advance(), 2026, 2, { payments: [{ id: "p1", advance_id: "a1", employee_id: "e1", period_year: 2026, period_month: 2, amount: 0, kind: "skip", notes: null, created_at: "" }] }),
    ).toBe(0);
  });
  it("recovers the FULL balance in the employee's exit month", () => {
    expect(
      emiDueFor(advance({ emi_months: 6 }), 2026, 4, { employee: emp({ exit_date: "2026-04-15" }) }),
    ).toBe(12000);
  });
});

describe("payroll/allocateEmi", () => {
  it("spreads a deduction across advances oldest-first and caps each at its due", () => {
    const older = advance({ id: "old", advance_date: "2025-12-01", amount: 2000, emi_amount: 1000, emi_months: 2, start_year: 2026, start_month: 1 });
    const newer = advance({ id: "new", advance_date: "2026-01-10", amount: 6000, emi_amount: 2000, emi_months: 3, start_year: 2026, start_month: 1 });
    const alloc = allocateEmi([newer, older], 2500, 2026, 1);
    expect(alloc.find((x) => x.advance.id === "old")!.amount).toBe(1000);
    expect(alloc.find((x) => x.advance.id === "new")!.amount).toBe(1500);
  });
  it("leaves surplus unallocated rather than over-deducting", () => {
    const a = advance();
    const alloc = allocateEmi([a], 5000, 2026, 1);
    expect(alloc[0].amount).toBe(2000); // only the EMI due
  });
});

describe("payroll/computeRow", () => {
  const buildMonth = (entries: Record<number, { code: any; hours: number | null }>) => {
    const att: Record<number, { code: any; hours: number | null; dayValue: number; edited?: boolean }> = {};
    for (let d = 1; d <= daysInMonth(2026, 1); d++) {
      const e = entries[d];
      att[d] = e
        ? { ...e, dayValue: dayValueFor(e.code, e.hours, [4, 11, 18, 25].includes(d)) }
        : { code: "A" as const, hours: null, dayValue: 0 };
    }
    return att;
  };

  it("full attendance month: salary = perDay × paidDays, EMI deducted", () => {
    const entries: Record<number, { code: any; hours: number | null }> = {};
    for (let d = 1; d <= 31; d++) entries[d] = { code: "P", hours: null };
    const row = computeRow(emp(), 2026, 1, buildMonth(entries), 2000, 0, null);
    expect(row.perDay).toBeCloseTo(1000, 5);
    // Present days are capped at the month length — Sundays already credit 1
    // as weekly-off, and the +1 benefit never double-counts them.
    expect(row.presentDays).toBe(31);
    expect(row.paidDays).toBe(31);
    expect(row.grossSalary).toBeCloseTo(31000, 5);
    expect(row.emiDeduction).toBe(2000);
    expect(row.netSalary).toBeCloseTo(29000, 5);
  });

  it("EMI never drives net salary negative — excess carries forward", () => {
    const entries: Record<number, { code: any; hours: number | null }> = {};
    for (let d = 1; d <= 31; d++) entries[d] = { code: "P", hours: null };
    const row = computeRow(emp(), 2026, 1, buildMonth(entries), 40000, 0, null);
    expect(row.emiDeduction).toBeLessThanOrEqual(row.grossSalary);
    expect(row.netSalary).toBeGreaterThanOrEqual(0);
    expect(row.emiCarryForward).toBeCloseTo(40000 - row.emiDeduction, 5);
  });

  it("admin override wins for paid days and net", () => {
    const entries: Record<number, { code: any; hours: number | null }> = {};
    for (let d = 1; d <= 31; d++) entries[d] = { code: "P", hours: null };
    const row = computeRow(emp(), 2026, 1, buildMonth(entries), 0, 0, null, { paidDays: 20, net: 15000 });
    expect(row.paidDays).toBe(20);
    expect(row.grossSalary).toBeCloseTo(20000, 5);
    expect(row.netSalary).toBe(15000);
  });
});

describe("payroll/applySundayRules — M17 missing Sat/Mon is NOT absent", () => {
  const y = 2026, m = 1; // Jan 4 is a Sunday
  it("keeps the Sunday credit when Saturday is missing entirely", () => {
    const out = applySundayRules({}, y, m);
    expect(out[4].dayValue).toBe(1);
  });
  it("keeps the Sunday credit when only Monday is explicitly absent", () => {
    const att = { 5: { code: "A" as const, hours: null, dayValue: 0 } };
    const out = applySundayRules(att, y, m);
    expect(out[4].dayValue).toBe(1);
  });
  it("keeps the Sunday credit when only Saturday is explicitly absent", () => {
    const att = { 3: { code: "A" as const, hours: null, dayValue: 0 } };
    const out = applySundayRules(att, y, m);
    expect(out[4].dayValue).toBe(1);
  });
  it("still zeroes the Sunday only when BOTH sides are explicitly absent", () => {
    const att = {
      3: { code: "A" as const, hours: null, dayValue: 0 },
      5: { code: "A" as const, hours: null, dayValue: 0 },
    };
    const out = applySundayRules(att, y, m);
    expect(out[4].dayValue).toBe(0);
  });
});
