import { describe, expect, it } from "vitest";
import { isDateInLockedPeriod } from "@/lib/engineer-conveyance";

describe("isDateInLockedPeriod (settlement lock guard)", () => {
  it("locks a date inside an Approved period", () => {
    expect(
      isDateInLockedPeriod("2026-09-15", [
        { period_start: "2026-09-01", period_end: "2026-09-30", status: "Approved" },
      ]),
    ).toBe(true);
  });

  it("leaves a date inside a Pending period open", () => {
    expect(
      isDateInLockedPeriod("2026-09-15", [
        { period_start: "2026-09-01", period_end: "2026-09-30", status: "Pending" },
      ]),
    ).toBe(false);
  });

  it("leaves a date outside any period open", () => {
    expect(
      isDateInLockedPeriod("2026-10-01", [
        { period_start: "2026-09-01", period_end: "2026-09-30", status: "Approved" },
      ]),
    ).toBe(false);
  });

  it("leaves a Rejected period without lock timestamps open", () => {
    expect(
      isDateInLockedPeriod("2026-09-15", [
        {
          period_start: "2026-09-01",
          period_end: "2026-09-30",
          status: "Rejected",
          locked_at: null,
          paid_at: null,
        },
      ]),
    ).toBe(false);
  });

  it("locks a date inside a period with paid_at set", () => {
    expect(
      isDateInLockedPeriod("2026-09-15", [
        {
          period_start: "2026-09-01",
          period_end: "2026-09-30",
          status: "Pending",
          locked_at: null,
          paid_at: "2026-10-02T00:00:00.000Z",
        },
      ]),
    ).toBe(true);
  });
});
