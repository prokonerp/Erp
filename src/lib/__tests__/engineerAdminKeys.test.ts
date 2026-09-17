// TDD RED (written FIRST): adminEngKeys key factory + payableWindow pure
// helper for the Engineers admin module (TASK 1). No mocks, no Supabase,
// no DOM — mirrors engineersAdmin.test.ts conventions.
import { describe, it, expect } from "vitest";
import { adminEngKeys } from "@/lib/queryKeys";
import { payableWindow } from "@/lib/engineersAdmin";

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
