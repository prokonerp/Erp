import {
  localDateIso,
  istDateIso,
  istTodayIso,
  daysAgoIst,
} from "@/lib/dateRange";

describe("dateRange/localDateIso", () => {
  it("formats a local calendar date without UTC shifting", () => {
    // Local midnight Jan 15 2026 — toISOString would give Jan 14 in IST.
    const d = new Date(2026, 0, 15);
    expect(localDateIso(d)).toBe("2026-01-15");
  });
});

describe("dateRange/istDateIso", () => {
  it("uses IST business day boundaries (UTC 18:29 = same IST day)", () => {
    expect(istDateIso("2026-01-15T18:29:00Z")).toBe("2026-01-15");
  });
  it("rolls over at IST midnight (UTC 18:30 = next IST day)", () => {
    expect(istDateIso("2026-01-15T18:30:00Z")).toBe("2026-01-16");
  });
  it("late-night IST instants belong to the next calendar day", () => {
    // 2026-01-15 20:00 UTC = 2026-01-16 01:30 IST
    expect(istDateIso("2026-01-15T20:00:00Z")).toBe("2026-01-16");
  });
  it("returns empty string for invalid input", () => {
    expect(istDateIso("not-a-date")).toBe("");
  });
});

describe("dateRange/istTodayIso + daysAgoIst", () => {
  it("returns a YYYY-MM-DD string consistent with istDateIso", () => {
    const today = istTodayIso();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(today).toBe(istDateIso(new Date()));
  });
  it("daysAgoIst(0) is today and negative offsets go forward", () => {
    expect(daysAgoIst(0)).toBe(istTodayIso());
    const plus30 = daysAgoIst(-30);
    expect(new Date(plus30).getTime()).toBeGreaterThan(
      new Date(istTodayIso()).getTime(),
    );
  });
});
