import { describe, it, expect } from "vitest";
import {
  CHARGE_TYPES,
  asEmployeeDocuments,
  assembleDashboardStats,
  dailyLogEntrySchema,
  expenseEntrySchema,
  kmTravelled,
  pendingMaterialSerials,
  todayLocal,
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

  it("rejects evening reading below morning reading", () => {
    const r = dailyLogEntrySchema.safeParse({
      log_date: "2026-09-16",
      morning_odometer: "12540",
      evening_odometer: "12500",
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0].path).toEqual(["evening_odometer"]);
  });

  it("rejects blank morning reading and bad date format", () => {
    expect(
      dailyLogEntrySchema.safeParse({ log_date: "2026-09-16", morning_odometer: "" }).success,
    ).toBe(false);
    expect(
      dailyLogEntrySchema.safeParse({ log_date: "16-09-2026", morning_odometer: "10" }).success,
    ).toBe(false);
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

  it("exposes exactly the three charge types", () => {
    expect([...CHARGE_TYPES]).toEqual(["Place Visit", "Parking", "Toll"]);
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
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("Aadhaar");
  });

  it("returns [] for non-arrays", () => {
    expect(asEmployeeDocuments(null)).toEqual([]);
    expect(asEmployeeDocuments({})).toEqual([]);
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

  it("degrades every card to 0/[]/null when parts are missing", () => {
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
  });
});
