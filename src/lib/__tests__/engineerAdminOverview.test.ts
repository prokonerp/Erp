// TDD (written FIRST, alongside src/lib/engineersAdmin.ts overview section):
// real behavior assertions for the five Phase-1 overview aggregators — no
// mocks, no Supabase, no DOM. Convention mirrors engineersAdmin.test.ts
// (vitest `describe/it/expect`, plain object literals as inputs).
//
// "Current month" is derived from istDateKey() at runtime so the suite stays
// green across month boundaries; perEngineerSummary pins todayISO where the
// behavior under test needs a fixed date.

import { describe, it, expect } from "vitest";
import {
  rosterKpis,
  perEngineerSummary,
  attentionQueue,
  conveyanceMatrix,
  custodyLedger,
} from "@/lib/engineersAdmin";
import { istDateKey } from "@/lib/time";

const MONTH = istDateKey().slice(0, 7);
const day = (dd: string) => `${MONTH}-${dd}`;

// ── rosterKpis ───────────────────────────────────────────────────────────

describe("engineerAdminOverview/rosterKpis", () => {
  it("totals engineers, open tickets, and current-month km", () => {
    const kpis = rosterKpis(
      [
        { employee_id: "e1", name: "Asha", phone: null, email: null, active: true, auth_user_id: null, photo_path: null },
        { employee_id: "e2", name: "Ravi", phone: null, email: null, active: true, auth_user_id: null, photo_path: null },
      ],
      [{ status: "New" }, { status: "Closed" }, { status: "Cancelled" }, { status: "In Progress" }],
      [
        { log_date: day("05"), morning_odometer: 100, evening_odometer: 120 },
        { log_date: day("06"), morning_odometer: 200, evening_odometer: 230 },
      ],
    );
    expect(kpis.totalEngineers).toBe(2);
    expect(kpis.openTickets).toBe(2);
    expect(kpis.kmMonth).toBe(50);
  });

  it("returns zeros for empty inputs and never throws on bad input", () => {
    expect(rosterKpis([], [], [])).toEqual({
      totalEngineers: 0,
      openTickets: 0,
      attentionHigh: 0,
      kmMonth: 0,
    });
    expect(rosterKpis(null, null, null)).toEqual({
      totalEngineers: 0,
      openTickets: 0,
      attentionHigh: 0,
      kmMonth: 0,
    });
  });

  it("excludes out-of-month days from kmMonth", () => {
    const kpis = rosterKpis(
      [],
      [],
      [
        { log_date: day("05"), morning_odometer: 0, evening_odometer: 10 },
        { log_date: "2000-01-15", morning_odometer: 0, evening_odometer: 999 },
      ],
    );
    expect(kpis.kmMonth).toBe(10);
  });

  it("counts summaries carrying a high-severity item when provided", () => {
    const card = (
      attention: { severity: "high" | "medium" | "low"; key: string; label: string }[],
    ) => ({
      employeeId: "e1",
      name: "Asha",
      openTickets: 0,
      closed30d: 0,
      kmMonth: 0,
      expensesMonth: 0,
      docsMissing: [] as string[],
      attention,
      rateToday: null as number | null,
    });
    const kpis = rosterKpis([], [], [], null, [
      card([{ severity: "high", key: "missing-rate", label: "No rate." }]),
      card([{ severity: "medium", key: "missing-doc", label: "Docs missing." }]),
      card([
        { severity: "low", key: "missing-receipt", label: "Receipt missing." },
        { severity: "high", key: "unapproved-past-cutoff", label: "Settle it." },
      ]),
    ]);
    expect(kpis.attentionHigh).toBe(2);
  });

  it("preserves days-only behavior when summaries are absent", () => {
    const days = [{ log_date: day("05"), morning_odometer: 100, evening_odometer: 120 }];
    // No rates and no employee scope → missing-rate high fires on the day set.
    expect(rosterKpis([], [], days).attentionHigh).toBe(1);
    expect(rosterKpis([], [], days, null, []).attentionHigh).toBe(1);
    expect(rosterKpis([], [], days, null, null).attentionHigh).toBe(1);
  });
});

// ── perEngineerSummary ───────────────────────────────────────────────────

const ENG = {
  employee_id: "e1",
  name: "Asha",
  phone: null,
  email: null,
  active: true,
  auth_user_id: null,
  photo_path: null,
};

describe("engineerAdminOverview/perEngineerSummary", () => {
  it("counts open tickets and 30-day closes", () => {
    const s = perEngineerSummary({
      engineer: ENG,
      tickets: [
        { status: "New", closed_at: null },
        { status: "Closed", closed_at: "2026-09-01T10:00:00+05:30" },
        { status: "Closed", closed_at: "2026-01-05T10:00:00+05:30" },
        { status: "Cancelled", closed_at: null },
      ],
      todayISO: "2026-09-17",
    });
    expect(s.employeeId).toBe("e1");
    expect(s.name).toBe("Asha");
    expect(s.openTickets).toBe(1);
    expect(s.closed30d).toBe(1);
  });

  it("sums current-month km and expenses", () => {
    const s = perEngineerSummary({
      engineer: ENG,
      days: [
        { log_date: day("05"), morning_odometer: 100, evening_odometer: 120 },
        { log_date: day("06"), morning_odometer: 200, evening_odometer: 230 },
        { log_date: "2000-01-15", morning_odometer: 0, evening_odometer: 999 },
      ],
      expenses: [
        { expense_date: day("05"), charge_type: "Toll", amount: 120, receipt_path: "/r1" },
        { expense_date: "2000-01-15", charge_type: "Toll", amount: 9999, receipt_path: "/r2" },
      ],
      todayISO: `${MONTH}-17`,
    });
    expect(s.kmMonth).toBe(50);
    expect(s.expensesMonth).toBe(120);
  });

  it("passes docsMissing through docCompliance", () => {
    const s = perEngineerSummary({
      engineer: ENG,
      docs: [{ name: "Aadhaar", path: "/docs/aadhaar.pdf" }],
      todayISO: "2026-09-17",
    });
    expect(s.docsMissing).toEqual(["PAN", "Driving Licence", "Bank Passbook", "Photo", "Other"]);
  });

  it("resolves rateToday via rateInForce", () => {
    const rates = [
      { employee_id: "e1", rate_per_km: 5, effective_from: "2026-08-01" },
      { employee_id: "e1", rate_per_km: 7, effective_from: "2026-09-01" },
    ];
    expect(perEngineerSummary({ engineer: ENG, rates, todayISO: "2026-09-10" }).rateToday).toBe(7);
    expect(perEngineerSummary({ engineer: ENG, rates, todayISO: "2026-08-15" }).rateToday).toBe(5);
    expect(perEngineerSummary({ engineer: ENG, rates: [], todayISO: "2026-09-10" }).rateToday).toBeNull();
  });

  it("surfaces attention on missing docs", () => {
    const s = perEngineerSummary({ engineer: ENG, docs: [], todayISO: "2026-09-17" });
    expect(s.attention.some((a) => a.key === "missing-doc")).toBe(true);
  });

  it("returns an empty card on bad input without throwing", () => {
    const s = perEngineerSummary(null);
    expect(s.employeeId).toBe("");
    expect(s.openTickets).toBe(0);
    expect(s.attention).toEqual([]);
    expect(s.rateToday).toBeNull();
  });
});

// ── attentionQueue ───────────────────────────────────────────────────────

describe("engineerAdminOverview/attentionQueue", () => {
  it("orders high -> medium -> low, then name", () => {
    const q = attentionQueue([
      {
        employeeId: "e3",
        name: "Zara",
        openTickets: 0,
        closed30d: 0,
        kmMonth: 0,
        expensesMonth: 0,
        docsMissing: [],
        rateToday: null,
        attention: [{ severity: "low", key: "missing-receipt", label: "Receipt missing." }],
      },
      {
        employeeId: "e1",
        name: "Bhanu",
        openTickets: 0,
        closed30d: 0,
        kmMonth: 0,
        expensesMonth: 0,
        docsMissing: [],
        rateToday: null,
        attention: [{ severity: "high", key: "missing-rate", label: "No rate." }],
      },
      {
        employeeId: "e2",
        name: "Asha",
        openTickets: 0,
        closed30d: 0,
        kmMonth: 0,
        expensesMonth: 0,
        docsMissing: [],
        rateToday: null,
        attention: [{ severity: "medium", key: "missing-doc", label: "Docs missing." }],
      },
      {
        employeeId: "e4",
        name: "Asha-2",
        openTickets: 0,
        closed30d: 0,
        kmMonth: 0,
        expensesMonth: 0,
        docsMissing: [],
        rateToday: null,
        attention: [{ severity: "high", key: "unapproved-past-cutoff", label: "Settle it." }],
      },
    ]);
    expect(q.map((i) => i.severity)).toEqual(["high", "high", "medium", "low"]);
    expect(q[0].name).toBe("Asha-2");
    expect(q[1].name).toBe("Bhanu");
    expect(q[0]).toMatchObject({ employeeId: "e4", key: "unapproved-past-cutoff" });
  });

  it("returns [] for bad input", () => {
    expect(attentionQueue(null)).toEqual([]);
    expect(attentionQueue(undefined)).toEqual([]);
  });
});

// ── conveyanceMatrix ─────────────────────────────────────────────────────

describe("engineerAdminOverview/conveyanceMatrix", () => {
  it("computes km + flags and sorts by log_date asc", () => {
    const rows = conveyanceMatrix([
      { log_date: "2026-09-06", morning_odometer: 200, evening_odometer: 190 },
      { log_date: "2026-09-05", morning_odometer: 100, evening_odometer: 150 },
      { log_date: "2026-09-07", morning_odometer: 10, evening_odometer: null },
    ]);
    expect(rows.map((r) => r.log_date)).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(rows[0]).toEqual({ log_date: "2026-09-05", morning: 100, evening: 150, km: 50, flags: [] });
    expect(rows[1].km).toBeNull();
    expect(rows[1].flags).toEqual(["negative-km"]);
    expect(rows[2].km).toBeNull();
    expect(rows[2].flags).toEqual(["missing-reading"]);
  });

  it("skips rows with unparseable dates", () => {
    const rows = conveyanceMatrix([
      { log_date: "not-a-date", morning_odometer: 0, evening_odometer: 10 },
      { log_date: null, morning_odometer: 0, evening_odometer: 10 },
      { log_date: "2026-09-05", morning_odometer: 0, evening_odometer: 10 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].km).toBe(10);
  });
});

// ── custodyLedger ────────────────────────────────────────────────────────

describe("engineerAdminOverview/custodyLedger", () => {
  it("passes rows through null-tolerantly", () => {
    const rows = custodyLedger([
      {
        stock_item_id: "s1",
        custodian_employee_id: "e1",
        custodian_name: "Asha",
        part_serial_no: "SN1",
        ticket_id: "t1",
        set_at: "2026-09-01T10:00:00+05:30",
      },
      {
        stock_item_id: "s2",
        custodian_employee_id: null,
        custodian_name: null,
        part_serial_no: null,
        ticket_id: null,
        set_at: null,
      },
      {},
      null,
    ]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      stock_item_id: "s1",
      custodian_employee_id: "e1",
      custodian_name: "Asha",
      part_serial_no: "SN1",
      ticket_id: "t1",
      set_at: "2026-09-01T10:00:00+05:30",
      stock_type: null,
      stock_status: null,
      part_name: null,
    });
    expect(rows[2]).toEqual({
      stock_item_id: null,
      custodian_employee_id: null,
      custodian_name: null,
      part_serial_no: null,
      ticket_id: null,
      set_at: null,
      stock_type: null,
      stock_status: null,
      part_name: null,
    });
  });

  it("returns [] for non-array input", () => {
    expect(custodyLedger(null)).toEqual([]);
    expect(custodyLedger("nope")).toEqual([]);
  });
});
