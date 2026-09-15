import { describe, it, expect } from "vitest";
import { resolveEngineerStatus } from "@/lib/useIsEngineer";

describe("resolveEngineerStatus", () => {
  it("returns true when a role row has an engineer role name", () => {
    expect(resolveEngineerStatus("Engineer", true, true)).toBe(true);
    expect(resolveEngineerStatus("field_engineer", true, false)).toBe(true);
    expect(resolveEngineerStatus("Field Engineer", true, true)).toBe(true);
  });

  it("returns false when a role row has a non-engineer role, even with employee match", () => {
    expect(resolveEngineerStatus("User", true, true)).toBe(false);
    expect(resolveEngineerStatus("admin", true, true)).toBe(false);
    expect(resolveEngineerStatus("Manager", true, false)).toBe(false);
  });

  it("returns false for a dual-role admin+engineer (admin wins, no /eng trap)", () => {
    // Regression: an admin holding the Engineer role was bounced to /eng
    // with no return path.
    expect(resolveEngineerStatus("Engineer", true, true, ["admin"])).toBe(false);
    expect(resolveEngineerStatus("admin", true, true, ["field_engineer"])).toBe(false);
    expect(resolveEngineerStatus(null, true, false, ["Administrator"])).toBe(false);
  });

  it("returns false for a legacy admin (user_roles row, admin role) even with employee match", () => {
    // Regression: admins whose role lives only in user_roles (no app_users
    // row) were falling through to the employee fallback and landing in /eng.
    expect(resolveEngineerStatus("admin", true, true)).toBe(false);
  });

  it("returns true for a legacy engineer role living only in user_roles", () => {
    expect(resolveEngineerStatus("field_engineer", true, false)).toBe(true);
  });

  it("returns true when no role row anywhere and employee match exists (legacy fallback)", () => {
    expect(resolveEngineerStatus(null, false, true)).toBe(true);
  });

  it("returns false when no role row and no employee match", () => {
    expect(resolveEngineerStatus(null, false, false)).toBe(false);
  });

  it("returns false on error (fail-closed)", () => {
    expect(resolveEngineerStatus(null, false, false)).toBe(false);
  });
});
