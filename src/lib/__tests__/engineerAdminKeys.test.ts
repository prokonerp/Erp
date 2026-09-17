// TDD RED (written FIRST): adminEngKeys key factory + payableWindow pure
// helper for the Engineers admin module (TASK 1). No mocks, no Supabase,
// no DOM — mirrors engineersAdmin.test.ts conventions.
import { describe, it, expect } from "vitest";
import { adminEngKeys } from "@/lib/queryKeys";
import { payableWindow, settlementStatusChangeAllowed, validateRateAppend } from "@/lib/engineersAdmin";

describe("engineerAdminKeys/adminEngKeys", () => {
  it("exposes a stable roster key", () => {
    expect(adminEngKeys.roster()).toEqual(["admin-eng", "roster"]);
  });

  it("scopes payables by employee + IST window", () => {
    expect(adminEngKeys.payables("e1", "2026-09-01", "2026-09-30")).toEqual([
      "admin-eng",
      "payables",
      "e1",
      "2026-09-01",
      "2026-09-30",
    ]);
  });

  it("scopes ledger by IST window", () => {
    expect(adminEngKeys.ledger("2026-09-01", "2026-09-30")).toEqual([
      "admin-eng",
      "ledger",
      "2026-09-01",
      "2026-09-30",
    ]);
  });
});

describe("engineersAdmin/payableWindow", () => {
  it("passes through an ordered YYYY-MM-DD window", () => {
    expect(payableWindow("2026-09-01", "2026-09-30")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("swaps an inverted window via string compare for SQL date", () => {
    expect(payableWindow("2026-09-30", "2026-09-01")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("falls back to the valid bound when one side is bad", () => {
    expect(payableWindow("nope", "2026-09-30")).toEqual({
      from: "2026-09-30",
      to: "2026-09-30",
    });
    expect(payableWindow("2026-09-01", "")).toEqual({
      from: "2026-09-01",
      to: "2026-09-01",
    });
  });
});

describe("engineersAdmin/validateRateAppend", () => {
  const rates = [
    { employee_id: "e1", rate_per_km: 5, effective_from: "2026-08-01" },
    { employee_id: "e1", rate_per_km: 7, effective_from: "2026-09-01" },
    { employee_id: "e2", rate_per_km: 9, effective_from: "2026-09-01" },
  ];

  it("rejects a same-day second rate for the same employee", () => {
    expect(validateRateAppend(rates, "e1", "2026-09-01")).toEqual({
      ok: false,
      error: expect.stringContaining("2026-09-01"),
    });
  });

  it("accepts a new day with no clash", () => {
    expect(validateRateAppend(rates, "e1", "2026-09-15")).toEqual({ ok: true });
  });

  it("accepts a backfill past day with no clash", () => {
    expect(validateRateAppend(rates, "e1", "2026-07-15")).toEqual({ ok: true });
  });

  it("ignores other employees' same-day rows and rejects bad input", () => {
    expect(validateRateAppend(rates, "e2", "2026-08-01")).toEqual({ ok: true });
    expect(validateRateAppend(rates, "", "2026-09-02").ok).toBe(false);
    expect(validateRateAppend(rates, "e1", "not-a-date").ok).toBe(false);
    expect(validateRateAppend(null, "e1", "2026-09-02")).toEqual({ ok: true });
  });
});

describe("engineerAdminKeys/adminEngKeys.settlements", () => {
  it("scopes settlements by employee", () => {
    expect(adminEngKeys.settlements("e1")).toEqual(["admin-eng", "settlements", "e1"]);
  });

  it("exposes a settlements prefix for invalidation", () => {
    expect(adminEngKeys.settlementsPrefix).toEqual(["admin-eng", "settlements"]);
  });
});

describe("engineersAdmin/settlementStatusChangeAllowed", () => {
  it("locks Approved periods — no status change allowed", () => {
    expect(
      settlementStatusChangeAllowed({ status: "Approved", locked_at: null }, "Rejected"),
    ).toEqual({ ok: false, error: expect.stringContaining("final") });
    expect(
      settlementStatusChangeAllowed({ status: "Approved", locked_at: null }, "Approved"),
    ).toEqual({ ok: false, error: expect.stringContaining("final") });
  });

  it("refuses locked_at rows even when status is still Pending", () => {
    expect(
      settlementStatusChangeAllowed(
        { status: "Pending", locked_at: "2026-09-30T10:00:00Z" },
        "Approved",
      ),
    ).toEqual({ ok: false, error: expect.stringContaining("locked") });
  });

  it("allows Pending → Approved and Pending → Rejected", () => {
    expect(
      settlementStatusChangeAllowed({ status: "Pending", locked_at: null }, "Approved"),
    ).toEqual({ ok: true });
    expect(
      settlementStatusChangeAllowed({ status: "Pending", locked_at: null }, "Rejected"),
    ).toEqual({ ok: true });
  });

  it("lets an override win only with a reason", () => {
    expect(
      settlementStatusChangeAllowed(
        { status: "Pending", locked_at: null },
        "Approved",
        { overriddenAmount: 5000, reason: "  " },
      ),
    ).toEqual({ ok: false, error: expect.stringContaining("reason") });
    expect(
      settlementStatusChangeAllowed(
        { status: "Pending", locked_at: null },
        "Approved",
        { overriddenAmount: 5000, reason: "River crossing toll" },
      ),
    ).toEqual({ ok: true });
  });

  it("ignores a non-numeric override and rejects bad input", () => {
    expect(
      settlementStatusChangeAllowed(
        { status: "Pending", locked_at: null },
        "Approved",
        { overriddenAmount: "n/a", reason: "" },
      ),
    ).toEqual({ ok: true });
    expect(
      settlementStatusChangeAllowed({ status: "Pending", locked_at: null }, "Archived" as never),
    ).toEqual({ ok: false, error: expect.stringContaining("Approved or Rejected") });
  });
});
