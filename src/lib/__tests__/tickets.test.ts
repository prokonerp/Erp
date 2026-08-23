import { hoursExcludingSundays } from "@/lib/tickets";

describe("tickets/hoursExcludingSundays (B-15, IST-pinned)", () => {
  it("counts all hours between two instants on a weekday", () => {
    // Mon 2026-01-05 09:00 UTC -> Mon 13:00 UTC = 4h (Monday in IST too)
    expect(hoursExcludingSundays("2026-01-05T09:00:00Z", new Date("2026-01-05T13:00:00Z"))).toBeCloseTo(4, 5);
  });

  it("excludes IST Sundays entirely — including hours that are only Sunday in IST", () => {
    // Sat 2026-01-10 20:00 UTC = Sun 2026-01-11 01:30 IST.
    // Device-local (e.g. UTC) would call this Saturday; IST says Sunday.
    const from = "2026-01-10T19:00:00Z"; // Sat 19:00 UTC = Sun 00:30 IST
    const to = new Date("2026-01-10T21:00:00Z"); // still Sat in UTC, but Sun 02:30 IST
    expect(hoursExcludingSundays(from, to)).toBeCloseTo(0, 5);
  });

  it("skips a full IST Sunday between two weekdays", () => {
    // Sat 2026-01-10 04:00 UTC -> Mon 2026-01-12 04:00 UTC = 48h total,
    // minus the IST Sunday (Jan 11) = 24h.
    const h = hoursExcludingSundays("2026-01-10T04:00:00Z", new Date("2026-01-12T04:00:00Z"));
    expect(h).toBeCloseTo(24, 5);
  });

  it("returns 0 for invalid or inverted ranges", () => {
    expect(hoursExcludingSundays("not-a-date")).toBe(0);
    expect(hoursExcludingSundays("2026-01-05T13:00:00Z", new Date("2026-01-05T09:00:00Z"))).toBe(0);
  });
});
