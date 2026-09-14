import { describe, it, expect } from "vitest";
import { resolveInitials, pickEmployeeRow } from "@/hooks/useMyEmployee";

describe("resolveInitials", () => {
  it("returns first + last initials for multi-word names", () => {
    expect(resolveInitials("Aarav Sharma", "a@x.com")).toBe("AS");
    expect(resolveInitials("  priya   rani  verma ", null)).toBe("PV");
  });

  it("returns the single letter for a single-word name", () => {
    expect(resolveInitials("Aarav", "a@x.com")).toBe("A");
  });

  it("falls back to the email initial when the name is unusable", () => {
    expect(resolveInitials("", "a@x.com")).toBe("A");
    expect(resolveInitials(null, "b@x.com")).toBe("B");
    expect(resolveInitials("   ", "c@x.com")).toBe("C");
  });

  it("returns empty string when neither name nor email is usable", () => {
    expect(resolveInitials(null, null)).toBe("");
    expect(resolveInitials("", "")).toBe("");
  });
});

describe("pickEmployeeRow (fail-soft)", () => {
  it("returns null on miss — empty, null, or non-array input", () => {
    expect(pickEmployeeRow([])).toBeNull();
    expect(pickEmployeeRow(null)).toBeNull();
    expect(pickEmployeeRow(undefined)).toBeNull();
    expect(pickEmployeeRow({ id: "1" })).toBeNull();
  });

  it("returns null when the row has no usable id", () => {
    expect(pickEmployeeRow([{ name: "Aarav" }])).toBeNull();
    expect(pickEmployeeRow([{ id: "" }])).toBeNull();
  });

  it("picks the first row and normalizes nullable fields", () => {
    expect(
      pickEmployeeRow([
        { id: "e1", name: "Aarav Sharma", phone: "98XXXXXX01", email: "a@x.com" },
      ]),
    ).toEqual({ id: "e1", name: "Aarav Sharma", phone: "98XXXXXX01", email: "a@x.com" });
    expect(pickEmployeeRow([{ id: "e2" }])).toEqual({
      id: "e2",
      name: "",
      phone: null,
      email: null,
    });
  });
});
