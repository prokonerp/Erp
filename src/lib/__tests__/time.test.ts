import { describe, it, expect } from "vitest";
import {
  APP_TIME_ZONE,
  istDateKey,
  formatISTTime,
  formatISTDate,
  formatISTDateTime,
} from "@/lib/time";

describe("app timezone", () => {
  it("pins Asia/Kolkata regardless of device locale", () => {
    expect(APP_TIME_ZONE).toBe("Asia/Kolkata");
  });
});

describe("istDateKey", () => {
  it("returns the IST calendar date (UTC+5:30)", () => {
    // 04:00Z = 09:30 IST same day
    expect(istDateKey(new Date("2026-09-15T04:00:00Z"))).toBe("2026-09-15");
    // 19:00Z = 00:30 IST next day — the boundary that device-local gets wrong
    expect(istDateKey(new Date("2026-09-14T19:00:00Z"))).toBe("2026-09-15");
  });
});

describe("formatISTTime", () => {
  it("formats HH:mm in IST", () => {
    expect(formatISTTime("2026-09-15T04:05:00Z")).toBe("09:35");
  });

  it("renders the dash fallback for missing/invalid input", () => {
    expect(formatISTTime(null)).toBe("—");
    expect(formatISTTime(undefined)).toBe("—");
    expect(formatISTTime("not-a-date")).toBe("—");
    expect(formatISTTime("not-a-date", "")).toBe("");
  });
});

describe("formatISTDate", () => {
  it("formats dd/mm/yyyy in IST", () => {
    expect(formatISTDate("2026-09-15T04:00:00Z")).toBe("15/09/2026");
    expect(formatISTDate("2026-09-14T19:00:00Z")).toBe("15/09/2026");
  });

  it("renders the dash fallback for missing/invalid input", () => {
    expect(formatISTDate(null)).toBe("—");
    expect(formatISTDate("nope")).toBe("—");
  });
});

describe("formatISTDateTime", () => {
  it("matches device toLocaleString shape but pinned to IST", () => {
    const expected = new Date("2026-09-15T04:00:00Z").toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    });
    expect(formatISTDateTime("2026-09-15T04:00:00Z")).toBe(expected);
  });

  it("renders the dash fallback for missing/invalid input", () => {
    expect(formatISTDateTime(undefined)).toBe("—");
  });
});
