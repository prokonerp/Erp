import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_PRESENT_CODE,
  istWorkDate,
  isSundayIst,
  planDutyAttendance,
} from "@/lib/engineer-attendance";

describe("ATTENDANCE_PRESENT_CODE", () => {
  it("is P", () => expect(ATTENDANCE_PRESENT_CODE).toBe("P"));
});

describe("planDutyAttendance", () => {
  it("plans a present write when nothing is recorded and the month is unlocked", () => {
    const plan = planDutyAttendance({
      employeeId: "e1",
      workDate: "2026-01-02",
      isSunday: false,
      existingCode: null,
      monthLocked: false,
    });
    expect(plan).toEqual({
      write: true,
      row: {
        employee_id: "e1",
        work_date: "2026-01-02",
        code: "P",
        day_value: 1,
        is_sunday: false,
        work_hours: null,
      },
    });
  });

  it("records Sunday when the IST day is a Sunday", () => {
    const plan = planDutyAttendance({
      employeeId: "e1",
      workDate: "2026-01-04",
      isSunday: true,
      existingCode: null,
      monthLocked: false,
    });
    expect(plan.write).toBe(true);
    expect(plan.write === true && plan.row.is_sunday).toBe(true);
  });

  it("carries no work hours — work_hours is null and there is no duration field", () => {
    const plan = planDutyAttendance({
      employeeId: "e1",
      workDate: "2026-01-02",
      isSunday: false,
      existingCode: null,
      monthLocked: false,
    });
    expect(plan.write).toBe(true);
    if (plan.write !== true) throw new Error("expected a write plan");
    expect(plan.row.work_hours).toBeNull();
    expect(Object.keys(plan.row).sort()).toEqual([
      "code",
      "day_value",
      "employee_id",
      "is_sunday",
      "work_date",
      "work_hours",
    ]);
  });

  it.each(["A", "P", "H"])("never overwrites an existing %s row", (existingCode) => {
    expect(
      planDutyAttendance({
        employeeId: "e1",
        workDate: "2026-01-02",
        isSunday: false,
        existingCode,
        monthLocked: false,
      }),
    ).toEqual({ write: false, reason: "already_recorded" });
  });

  it("skips a locked month even when the day is unrecorded", () => {
    expect(
      planDutyAttendance({
        employeeId: "e1",
        workDate: "2026-01-02",
        isSunday: false,
        existingCode: null,
        monthLocked: true,
      }),
    ).toEqual({ write: false, reason: "month_locked" });
  });

  it("lock wins when the month is locked and a row already exists", () => {
    expect(
      planDutyAttendance({
        employeeId: "e1",
        workDate: "2026-01-02",
        isSunday: false,
        existingCode: "A",
        monthLocked: true,
      }),
    ).toEqual({ write: false, reason: "month_locked" });
  });
});

describe("istWorkDate", () => {
  it("rolls to the next IST day late in the UTC day", () => {
    // 2026-01-01T19:00Z = 2026-01-02T00:30 IST.
    expect(istWorkDate(Date.parse("2026-01-01T19:00:00Z"))).toBe("2026-01-02");
  });

  it("stays on the same IST day earlier in the UTC day", () => {
    // 2026-01-01T10:00Z = 15:30 IST on 2026-01-01.
    expect(istWorkDate(Date.parse("2026-01-01T10:00:00Z"))).toBe("2026-01-01");
  });

  it("defaults to now without throwing", () => {
    expect(istWorkDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("isSundayIst", () => {
  it("is true on a Sunday IST", () => {
    expect(isSundayIst(Date.parse("2026-01-04T10:00:00Z"))).toBe(true);
  });

  it("is false on a Saturday IST", () => {
    expect(isSundayIst(Date.parse("2026-01-03T10:00:00Z"))).toBe(false);
  });

  it("uses the IST weekday when it differs from the UTC weekday", () => {
    // 2026-01-03T20:00Z is Saturday in UTC, 2026-01-04T01:30 IST → Sunday.
    const ms = Date.parse("2026-01-03T20:00:00Z");
    expect(new Date(ms).getUTCDay()).toBe(6);
    expect(isSundayIst(ms)).toBe(true);
  });

  it("agrees with an independent IST weekday computation for every hour of a week", () => {
    const IST_OFFSET_MS = 5.5 * 3_600_000;
    const start = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 7 * 24; i++) {
      const ms = start + i * 3_600_000;
      const expected = new Date(ms + IST_OFFSET_MS).getUTCDay() === 0;
      expect(isSundayIst(ms)).toBe(expected);
    }
  });
});
