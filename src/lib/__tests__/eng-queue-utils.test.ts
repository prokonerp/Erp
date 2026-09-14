import { describe, it, expect, vi, afterEach } from "vitest";
import {
  priorityWeight,
  isToday,
  isCarryForward,
  matchesSearch,
  formatAge,
  attachLoginFlags,
  sortEngineersLoginFirst,
} from "@/lib/eng-queue-utils";

afterEach(() => {
  vi.useRealTimers();
});

describe("priorityWeight", () => {
  it("returns 1 for P1", () => expect(priorityWeight("P1")).toBe(1));
  it("returns 5 for P5", () => expect(priorityWeight("P5")).toBe(5));
  it("returns 99 for null", () => expect(priorityWeight(null)).toBe(99));
  it("returns 99 for undefined", () => expect(priorityWeight(undefined)).toBe(99));
  it("returns 99 for empty string", () => expect(priorityWeight("")).toBe(99));
  it("is case-insensitive", () => expect(priorityWeight("p2")).toBe(2));
  it("returns 99 for unknown priority", () => expect(priorityWeight("P9")).toBe(99));
});

describe("isToday", () => {
  it("returns true for today's date", () => {
    const today = new Date().toISOString();
    expect(isToday(today)).toBe(true);
  });
  it("returns false for yesterday", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(isToday(yesterday)).toBe(false);
  });
  it("returns false for null", () => expect(isToday(null)).toBe(false));
  it("returns false for undefined", () => expect(isToday(undefined)).toBe(false));
  it("returns true when assigned_at is today even if created_at is not", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const today = new Date().toISOString();
    expect(isToday(yesterday, today)).toBe(true);
  });
  it("treats 00:30 IST as today IST (not carry-forward)", () => {
    // 08:30 IST on 2026-09-14; 00:30 IST same calendar day must be today.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T03:00:00Z"));
    expect(isToday("2026-09-14T00:30:00+05:30")).toBe(true);
  });
  it("treats 2026-09-13T23:30:00Z as today IST (05:00 IST Sep 14)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T03:00:00Z"));
    expect(isToday("2026-09-13T23:30:00Z")).toBe(true);
  });
  it("treats late-night Sep 13 IST as not today IST", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T03:00:00Z"));
    // 2026-09-13T18:00:00Z = 23:30 IST Sep 13 → yesterday IST.
    expect(isToday("2026-09-13T18:00:00Z")).toBe(false);
  });
});

describe("isCarryForward", () => {
  it("returns true when not today and not waiting for parts", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(isCarryForward(yesterday, null, "In Progress")).toBe(true);
  });
  it("returns false when today", () => {
    const today = new Date().toISOString();
    expect(isCarryForward(today, null, "In Progress")).toBe(false);
  });
  it("returns false when status is Waiting for Parts", () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    expect(isCarryForward(yesterday, null, "Waiting for Parts")).toBe(false);
  });
});

describe("matchesSearch", () => {
  it("returns true for empty term", () => {
    expect(matchesSearch("", ["hello", "world"])).toBe(true);
  });
  it("matches case-insensitively", () => {
    expect(matchesSearch("HELLO", ["hello world"])).toBe(true);
  });
  it("returns false when no field matches", () => {
    expect(matchesSearch("xyz", ["hello", "world"])).toBe(false);
  });
  it("handles null fields without crash", () => {
    expect(matchesSearch("test", [null, undefined, "test case"])).toBe(true);
  });
  it("returns false when all fields are null", () => {
    expect(matchesSearch("test", [null, null])).toBe(false);
  });
});

describe("formatAge", () => {
  it('returns "Just now" for < 60s', () => {
    const thirtySecAgo = new Date(Date.now() - 30_000).toISOString();
    expect(formatAge(thirtySecAgo)).toBe("Just now");
  });
  it("shows minutes for < 1 hour", () => {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    const result = formatAge(thirtyMinAgo);
    expect(result).toMatch(/^\d+m$/);
  });
  it("shows hours for < 24 hours", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 3_600_000).toISOString();
    const result = formatAge(fiveHoursAgo);
    expect(result).toMatch(/^\d+h$/);
  });
  it("shows days for >= 24 hours", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 3_600_000).toISOString();
    const result = formatAge(threeDaysAgo);
    expect(result).toMatch(/^\d+d$/);
  });
});

describe("attachLoginFlags", () => {
  it("marks engineers whose employee id has a linked login", () => {
    const out = attachLoginFlags(
      [
        { id: "e1", name: "Asha" },
        { id: "e2", name: "Ravi" },
      ],
      new Set(["e2"]),
    );
    expect(out).toEqual([
      { id: "e1", name: "Asha", hasLogin: false },
      { id: "e2", name: "Ravi", hasLogin: true },
    ]);
  });
  it("marks everyone false for an empty login set", () => {
    const out = attachLoginFlags([{ id: "e1", name: "Asha" }], new Set());
    expect(out[0].hasLogin).toBe(false);
  });
});

describe("sortEngineersLoginFirst", () => {
  it("lists portal engineers before others, alphabetical within groups", () => {
    const out = sortEngineersLoginFirst([
      { id: "e1", name: "Zed", hasLogin: false },
      { id: "e2", name: "Mira", hasLogin: true },
      { id: "e3", name: "Asha", hasLogin: true },
      { id: "e4", name: "Dev", hasLogin: false },
    ]);
    expect(out.map((e) => e.name)).toEqual(["Asha", "Mira", "Dev", "Zed"]);
  });
  it("does not mutate the input array", () => {
    const input = [{ id: "e1", name: "Zed", hasLogin: false }];
    sortEngineersLoginFirst(input);
    expect(input).toHaveLength(1);
  });
});
