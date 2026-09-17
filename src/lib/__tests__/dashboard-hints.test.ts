import { describe, it, expect } from "vitest";
import { hintFor } from "@/hooks/useEngineerDashboard";

describe("hintFor", () => {
  it("points at the migration for missing tables/columns", () => {
    expect(hintFor({ code: "42P01", message: "relation X does not exist" }, "M1")).toBe(
      "not set up yet — ask admin to run migration M1",
    );
    expect(hintFor({ code: "42703", message: "column Y missing" }, "M2")).toContain("M2");
  });

  it("points at the migration for enum-coercion failures (22P02)", () => {
    expect(
      hintFor(
        { code: "22P02", message: 'invalid input value for enum ims_stock_status: ""' },
        "20260925000004",
      ),
    ).toBe("data-type fix needed — ask admin to run migration 20260925000004");
  });

  it("passes anything else through verbatim", () => {
    expect(hintFor({ message: "timeout" }, "M9")).toBe("timeout");
    expect(hintFor(null, "M9")).toBe("failed");
  });
});
