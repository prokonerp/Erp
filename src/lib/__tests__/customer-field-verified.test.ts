import { describe, expect, it } from "vitest";
import { formatFieldVerified, correctedRows } from "@/components/CustomerFieldVerified";

describe("field verified formatter", () => {
  it("formats engineer stamp", () =>
    expect(
      formatFieldVerified({ engineer_name: "Ravi", verified_at: "2026-09-11T10:00:00Z" } as any),
    ).toMatch(/Ravi/));
  it("falls back when engineer and timestamp are missing", () => {
    expect(formatFieldVerified({ engineer_name: null, verified_at: null } as any)).toBe(
      "Engineer · ",
    );
    expect(formatFieldVerified({} as any)).toBe("Engineer · ");
  });
});

describe("correctedRows", () => {
  it("returns exactly 4 rows for sample with empty fields", () => {
    const sample = {
      sector: "",
      location: "Sector 5",
      customer_name: "DEMO PVT LTD",
      phone: "9876543210",
      email: "",
      address: "123 Industrial Area",
    };
    const rows = correctedRows(sample);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.label)).toEqual(["Location", "Customer name", "Phone", "Address"]);
  });

  it("returns 0 rows when all values are empty or blank", () => {
    expect(correctedRows({ a: "", b: "   ", c: null, d: undefined })).toHaveLength(0);
  });

  it("skips whitespace-only values", () => {
    expect(correctedRows({ name: "  \t\n  " })).toHaveLength(0);
  });

  it("renders unknown extra keys with the raw key as label", () => {
    const rows = correctedRows({ custom_field: "hello" });
    expect(rows).toEqual([{ label: "custom_field", value: "hello" }]);
  });

  it("returns empty array for null/undefined input", () => {
    expect(correctedRows(null)).toEqual([]);
    expect(correctedRows(undefined)).toEqual([]);
  });
});
