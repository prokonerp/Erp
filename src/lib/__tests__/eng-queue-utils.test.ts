import { describe, it, expect, vi, afterEach } from "vitest";
import {
  priorityWeight,
  isToday,
  isCarryForward,
  matchesSearch,
  formatAge,
} from "@/lib/eng-queue-utils";

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
