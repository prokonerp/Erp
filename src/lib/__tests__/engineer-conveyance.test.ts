import { describe, it, expect } from "vitest";
import {
  CHARGE_TYPES,
  PROFILE_DOC_TYPES,
  asEmployeeDocuments,
  assembleDashboardStats,
  assertLogDateNotFuture,
  assertOwnLogPhoto,
  dailyLogEntrySchema,
  expenseEntrySchema,
  findDocByName,
  kmTravelled,
  pendingMaterialSerials,
  pendingPayoutTotal,
  pendingPayoutWithUnsettled,
  placeVisitSchema,
  todayLocal,
  upsertDocByName,
} from "@/lib/engineer-conveyance";

describe("dailyLogEntrySchema", () => {
  it("parses a morning-only entry (evening comes later)", () => {
    const r = dailyLogEntrySchema.safeParse({
      log_date: "2026-09-16",
      morning_odometer: "12540.5",
      morning_photo_path: "engineer/e1/morning_reading/2026-09-16/a.jpg",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.morning_odometer).toBe(12540.5);
  });

  it("parses a full day entry with evening >= morning", () => {
    const r = dailyLogEntrySchema.safeParse({
      log_date: "2026-09-16",
      morning_odometer: "12540",
      evening_odometer: "12615",
    });
    expect(r.success).toBe(true);
  });

  it("ACCEPTS evening reading below morning (flagged downstream, never rejected)", () => {
    const r = dailyLogEntrySchema.safeParse({
      log_date: "2026-09-16",
      morning_odometer: "12540",
      evening_odometer: "12500",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.morning_odometer).toBe(12540);
    expect(r.data.evening_odometer).toBe(12500);
    // Reversal still yields null km (payable 0) — no wrap math.
    expect(
      kmTravelled({
        morning_odometer: r.data.morning_odometer ?? null,
        evening_odometer: r.data.evening_odometer ?? null,
      }),
    ).toBeNull();
  });

  it("rejects blank morning reading and bad date format", () => {
    expect(
      dailyLogEntrySchema.safeParse({ log_date: "2026-09-16", morning_odometer: "" }).success,
    ).toBe(false);
    expect(
      dailyLogEntrySchema.safeParse({ log_date: "16-09-2026", morning_odometer: "10" }).success,
    ).toBe(false);
  });

  it("still rejects negative readings and non-numeric input", () => {
    expect(
      dailyLogEntrySchema.safeParse({ log_date: "2026-09-16", morning_odometer: "-5" }).success,
    ).toBe(false);
    expect(
      dailyLogEntrySchema.safeParse({
        log_date: "2026-09-16",
        morning_odometer: "10",
        evening_odometer: "-1",
      }).success,
    ).toBe(false);
  });
});

describe("assertOwnLogPhoto (save-handler ownership guard)", () => {
  it("rejects a foreign morning photo with the exact handler error", () => {
    expect(() => assertOwnLogPhoto("engineer/other/morning_reading/2026-09-16/a.jpg", "e1", "morning")).toThrow(
      "Forbidden: morning photo must be your own upload",
    );
  });

  it("rejects a foreign evening photo with the exact handler error", () => {
    expect(() => assertOwnLogPhoto("engineer/other/evening_reading/2026-09-16/b.jpg", "e1", "evening")).toThrow(
      "Forbidden: evening photo must be your own upload",
    );
  });

  it("accepts own uploads and blank (photo optional)", () => {
    expect(() =>
      assertOwnLogPhoto("engineer/e1/morning_reading/2026-09-16/a.jpg", "e1", "morning"),
    ).not.toThrow();
    expect(() =>
      assertOwnLogPhoto("engineer/e1/evening_reading/2026-09-16/b.jpg", "e1", "evening"),
    ).not.toThrow();
    expect(() => assertOwnLogPhoto("", "e1", "morning")).not.toThrow();
    expect(() => assertOwnLogPhoto("   ", "e1", "evening")).not.toThrow();
    expect(() => assertOwnLogPhoto(undefined, "e1", "morning")).not.toThrow();
    expect(() => assertOwnLogPhoto(null, "e1", "evening")).not.toThrow();
  });
});

describe("assertLogDateNotFuture (save-handler future-date guard)", () => {
  it("rejects a future log_date, naming received date and today", () => {
    expect(() => assertLogDateNotFuture("2026-09-18", "2026-09-17")).toThrow(
      "Future log_date 2026-09-18 not allowed (today is 2026-09-17)",
    );
  });

  it("accepts today and past dates", () => {
    expect(() => assertLogDateNotFuture("2026-09-17", "2026-09-17")).not.toThrow();
    expect(() => assertLogDateNotFuture("2026-09-16", "2026-09-17")).not.toThrow();
  });
});

describe("expenseEntrySchema", () => {
  it("parses a toll entry with receipt", () => {
    const r = expenseEntrySchema.safeParse({
      expense_date: "2026-09-16",
      charge_type: "Toll",
      amount: "120",
      receipt_path: "engineer/e1/receipt/2026-09-16/r.jpg",
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.amount).toBe(120);
  });

  it("rejects unknown charge types and zero amount", () => {
    expect(
      expenseEntrySchema.safeParse({
        expense_date: "2026-09-16",
        charge_type: "Fuel",
        amount: "100",
      }).success,
    ).toBe(false);
    expect(
      expenseEntrySchema.safeParse({
        expense_date: "2026-09-16",
        charge_type: "Parking",
        amount: "0",
      }).success,
    ).toBe(false);
  });

  it("exposes exactly the two reimbursable charge types", () => {
    expect([...CHARGE_TYPES]).toEqual(["Toll", "Parking"]);
  });
});

describe("kmTravelled", () => {
  it("computes evening minus morning, rounded to 1 decimal", () => {
    expect(kmTravelled({ morning_odometer: 12540.5, evening_odometer: 12615.25 })).toBe(74.8);
  });

  it("returns null until both readings exist or when inverted", () => {
    expect(kmTravelled({ morning_odometer: 100 })).toBeNull();
    expect(kmTravelled({})).toBeNull();
    expect(kmTravelled({ morning_odometer: 200, evening_odometer: 150 })).toBeNull();
  });
});

describe("todayLocal", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("pendingMaterialSerials", () => {
  it("keeps defective serials with no GRN match, case-insensitive", () => {
    const out = pendingMaterialSerials(
      [
        { case_id: "C1", name: "Battery", serial: "OLD1" },
        { case_id: "C1", name: "PCB", serial: " old2 " },
        { case_id: "C2", name: "Fan", serial: "OLD3" },
      ],
      ["old1", "OLD2"],
    );
    expect(out).toEqual([{ case_id: "C2", name: "Fan", serial: "OLD3" }]);
  });

  it("excludes lines with no serial (nothing to match a GRN against)", () => {
    const out = pendingMaterialSerials(
      [
        { case_id: "C1", name: "Battery", serial: null },
        { case_id: "C1", name: "X" },
      ],
      [],
    );
    expect(out).toEqual([]);
  });

  it("returns everything when no GRNs received yet", () => {
    const out = pendingMaterialSerials([{ case_id: "C1", name: "Battery", serial: "A1" }], null);
    expect(out).toHaveLength(1);
  });
});

describe("asEmployeeDocuments", () => {
  it("parses document rows, drops entries without a path", () => {
    const out = asEmployeeDocuments([
      { name: "Aadhaar", path: "engineer/e1/document/2026-09-16/a.jpg", uploaded_at: "x" },
      { path: "" },
      "nope",
      null,
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Aadhaar");
  });

  it("filters out entries with empty or whitespace-only paths", () => {
    const out = asEmployeeDocuments([
      { name: "Aadhaar", path: "engineer/e1/document/2026-09-16/a.jpg", uploaded_at: "x" },
      { path: "" },
      { path: "   " },
      { name: "PAN" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Aadhaar");
  });

  it("returns [] for non-arrays", () => {
    expect(asEmployeeDocuments(null)).toEqual([]);
    expect(asEmployeeDocuments({})).toEqual([]);
  });
});

describe("findDocByName / upsertDocByName", () => {
  const docs = [
    { name: "Aadhaar", path: "a.jpg", uploaded_at: "t1" },
    { name: "PAN", path: "p.jpg", uploaded_at: "t2" },
  ];

  it("finds an exact name match", () => {
    expect(findDocByName(docs, "Aadhaar")?.path).toBe("a.jpg");
  });

  it("matches case-insensitively with surrounding whitespace", () => {
    expect(findDocByName(docs, "  pan ")?.path).toBe("p.jpg");
  });

  it("returns undefined for null/undefined/empty input", () => {
    expect(findDocByName(null, "Aadhaar")).toBeUndefined();
    expect(findDocByName(undefined, "Aadhaar")).toBeUndefined();
    expect(findDocByName([], "Aadhaar")).toBeUndefined();
    expect(findDocByName(docs, "Photo")).toBeUndefined();
  });

  it("appends when there is no match", () => {
    const out = upsertDocByName(docs, { name: "Photo", path: "ph.jpg", uploaded_at: "t3" });
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ name: "Photo", path: "ph.jpg", uploaded_at: "t3" });
  });

  it("replaces in place and preserves order", () => {
    const out = upsertDocByName(docs, { name: "aadhaar", path: "a2.jpg", uploaded_at: "t9" });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: "aadhaar", path: "a2.jpg", uploaded_at: "t9" });
    expect(out[1]).toEqual(docs[1]);
    expect([...PROFILE_DOC_TYPES]).toEqual([
      "Aadhaar",
      "PAN",
      "Driving Licence",
      "Bank Passbook",
      "Photo",
      "Other",
    ]);
  });

  it("treats null/undefined docs as [] and never mutates the input", () => {
    const out = upsertDocByName(null, { name: "PAN", path: "p.jpg", uploaded_at: "t" });
    expect(out).toHaveLength(1);
    expect(
      upsertDocByName(undefined, { name: "PAN", path: "p.jpg", uploaded_at: "t" }),
    ).toHaveLength(1);
    const snapshot = [...docs];
    upsertDocByName(docs, { name: "PAN", path: "p2.jpg", uploaded_at: "t" });
    expect(docs).toEqual(snapshot);
  });

  it("returns the FIRST match when two entries normalize equal", () => {
    const legacy = [
      { name: "Aadhaar", path: "first.jpg", uploaded_at: "t1" },
      { name: "  aadhaar ", path: "second.jpg", uploaded_at: "t2" },
    ];
    expect(findDocByName(legacy, "AADHAAR")?.path).toBe("first.jpg");
    expect(findDocByName(legacy, "  aadhaar ")?.path).toBe("first.jpg");
  });

  it("replaces ONLY the first duplicate normalized name, leaving the second untouched", () => {
    const legacy = [
      { name: "Aadhaar", path: "first.jpg", uploaded_at: "t1" },
      { name: "  aadhaar ", path: "second.jpg", uploaded_at: "t2" },
    ];
    const out = upsertDocByName(legacy, { name: "Aadhaar", path: "new.jpg", uploaded_at: "t9" });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: "Aadhaar", path: "new.jpg", uploaded_at: "t9" });
    expect(out[1]).toEqual({ name: "  aadhaar ", path: "second.jpg", uploaded_at: "t2" });
  });

  it("replaces (not appends) on whitespace-padded normalized match, keeping the new casing", () => {
    const out = upsertDocByName(docs, { name: "  PAN ", path: "p2.jpg", uploaded_at: "t9" });
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ name: "  PAN ", path: "p2.jpg", uploaded_at: "t9" });
  });
});

describe("assembleDashboardStats", () => {
  const base = {
    completedVisits: 4,
    dayLog: { morning_odometer: 100, evening_odometer: 160 },
    materialHolding: 2,
    materialPending: [{ ticket_id: "t1", case_id: "C1", name: "Battery", serial: "OLD1" }],
    warnings: [] as string[],
    todayLogDate: "2026-09-16",
  };

  it("counts only non-terminal tickets as pending calls", () => {
    const s = assembleDashboardStats({
      employeeName: "Est Eng",
      ...base,
      tickets: [
        { id: "a", status: "In Progress" },
        { id: "b", status: "Closed" },
        { id: "c", status: "Cancelled" },
        { id: "d", status: "Waiting for Parts" },
        { id: "e", status: null },
      ],
    });
    expect(s.pendingCalls).toBe(3);
    expect(s.completedVisits).toBe(4);
    expect(s.materialHolding).toBe(2);
    expect(s.materialPending).toHaveLength(1);
    expect(s.todayKm).toBe(60);
  });

  it("counts today Assigned / Pending / Completed + pending payout", () => {
    const s = assembleDashboardStats({
      employeeName: "Est Eng",
      ...base,
      tickets: [{ id: "a", status: "In Progress" }],
      todayTickets: [
        { id: "t1", status: "New" },
        { id: "t2", status: "Call Log" },
        { id: "t3", status: "In Progress" },
        { id: "t4", status: "Closed" },
      ],
      pendingPayout: 1250.5,
    });
    expect(s.assignedToday).toBe(4);
    expect(s.pendingToday).toBe(2);
    expect(s.completedToday).toBe(1);
    expect(s.pendingPayout).toBe(1250.5);
  });

  it("defaults today counts + payout to 0 when missing", () => {
    const s = assembleDashboardStats({
      employeeName: null,
      tickets: null,
      completedVisits: null,
      dayLog: null,
      materialHolding: null,
      materialPending: null,
      warnings: ["holding: boom"],
      todayLogDate: "2026-09-16",
    });
    expect(s.pendingCalls).toBe(0);
    expect(s.completedVisits).toBe(0);
    expect(s.materialHolding).toBe(0);
    expect(s.materialPending).toEqual([]);
    expect(s.todayKm).toBeNull();
    expect(s.warnings).toEqual(["holding: boom"]);
    expect(s.assignedToday).toBe(0);
    expect(s.pendingToday).toBe(0);
    expect(s.completedToday).toBe(0);
    expect(s.pendingPayout).toBe(0);
  });
});

describe("pendingPayoutTotal", () => {
  it("sums adjusted ?? computed + flat for unpaid, skips paid + rejected", () => {
    expect(
      pendingPayoutTotal([
        {
          computed_amount: 1000,
          flat_expenses: 200,
          adjusted_amount: null,
          status: "Approved",
          paid_at: null,
        },
        {
          computed_amount: 500,
          flat_expenses: 0,
          adjusted_amount: 700,
          status: "Pending",
          paid_at: null,
        },
        {
          computed_amount: 900,
          flat_expenses: 100,
          adjusted_amount: null,
          status: "Approved",
          paid_at: "2026-09-01T00:00:00Z",
        },
        {
          computed_amount: 300,
          flat_expenses: 0,
          adjusted_amount: null,
          status: "Rejected",
          paid_at: null,
        },
      ]),
    ).toBe(1900);
  });

  it("returns 0 for null/empty", () => {
    expect(pendingPayoutTotal(null)).toBe(0);
    expect(pendingPayoutTotal([])).toBe(0);
  });
});

describe("pendingPayoutWithUnsettled", () => {
  const rates = [{ employee_id: "e1", rate_per_km: 10, effective_from: "2026-09-01" }];
  const day = { log_date: "2026-09-10", morning_odometer: 100, evening_odometer: 150 };
  const expense = { expense_date: "2026-09-10", amount: 120 };

  it("sums live km x rate + expenses when no settlement exists", () => {
    expect(
      pendingPayoutWithUnsettled({
        employeeId: "e1",
        settlements: [],
        days: [day],
        expenses: [expense],
        rates,
      }),
    ).toBe(620);
  });

  it("excludes a paid period entirely (no double count, no phantom from a paid override)", () => {
    expect(
      pendingPayoutWithUnsettled({
        employeeId: "e1",
        settlements: [
          {
            computed_amount: 500,
            flat_expenses: 120,
            adjusted_amount: 700,
            status: "Approved",
            paid_at: "2026-09-11T00:00:00Z",
            period_start: "2026-09-01",
            period_end: "2026-09-10",
          },
        ],
        days: [day],
        expenses: [expense],
        rates,
      }),
    ).toBe(0);
  });

  it("counts a Rejected period live (still owed)", () => {
    expect(
      pendingPayoutWithUnsettled({
        employeeId: "e1",
        settlements: [
          {
            computed_amount: 500,
            flat_expenses: 120,
            adjusted_amount: null,
            status: "Rejected",
            paid_at: null,
            period_start: "2026-09-01",
            period_end: "2026-09-10",
          },
        ],
        days: [day],
        expenses: [expense],
        rates,
      }),
    ).toBe(620);
  });

  it("adds live days outside a Pending settlement period to the settlement amount", () => {
    expect(
      pendingPayoutWithUnsettled({
        employeeId: "e1",
        settlements: [
          {
            computed_amount: 500,
            flat_expenses: 0,
            adjusted_amount: null,
            status: "Pending",
            paid_at: null,
            period_start: "2026-09-01",
            period_end: "2026-09-09",
          },
        ],
        days: [day],
        expenses: [{ expense_date: "2026-09-10", amount: 50 }],
        rates,
      }),
    ).toBe(1050);
  });

  it("still counts expenses when no rate is in force", () => {
    expect(
      pendingPayoutWithUnsettled({
        employeeId: "e1",
        settlements: [],
        days: [day],
        expenses: [expense],
        rates: [],
      }),
    ).toBe(120);
  });

  it("returns 0 for null/empty input", () => {
    expect(
      pendingPayoutWithUnsettled({
        employeeId: "e1",
        settlements: null,
        days: null,
        expenses: null,
        rates: null,
      }),
    ).toBe(0);
  });
});

describe("placeVisitSchema", () => {
  it("parses a note-only entry", () => {
    expect(placeVisitSchema.safeParse({ note: "ABC Motors, Sector 62" }).success).toBe(true);
  });

  it("rejects blank notes and over-long notes", () => {
    expect(placeVisitSchema.safeParse({ note: "   " }).success).toBe(false);
    expect(placeVisitSchema.safeParse({ note: "x".repeat(301) }).success).toBe(false);
  });
});
