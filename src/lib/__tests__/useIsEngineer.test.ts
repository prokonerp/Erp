import { describe, it, expect } from "vitest";
import { resolveEngineerStatus } from "@/lib/useIsEngineer";

describe("resolveEngineerStatus", () => {
  it("returns true when app_users row has an engineer role name", () => {
    expect(resolveEngineerStatus("Engineer", true, true)).toBe(true);
    expect(resolveEngineerStatus("field_engineer", true, false)).toBe(true);
    expect(resolveEngineerStatus("Field Engineer", true, true)).toBe(true);
  });

  it("returns false when app_users row has a non-engineer role, even with employee match", () => {
    expect(resolveEngineerStatus("User", true, true)).toBe(false);
    expect(resolveEngineerStatus("admin", true, true)).toBe(false);
    expect(resolveEngineerStatus("Manager", true, false)).toBe(false);
  });

  it("returns true when no app_users row and employee match exists (legacy fallback)", () => {
    expect(resolveEngineerStatus(null, false, true)).toBe(true);
  });

  it("returns false when no app_users row and no employee match", () => {
    expect(resolveEngineerStatus(null, false, false)).toBe(false);
  });

  it("returns false on error (fail-closed)", () => {
    expect(resolveEngineerStatus(null, false, false)).toBe(false);
  });
});
