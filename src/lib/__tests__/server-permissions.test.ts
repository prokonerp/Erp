import { describe, it, expect } from "vitest";
import { resolveModulePermission, permissionError } from "@/lib/server-permissions";

/**
 * The server-side mirror of `usePermissions().can()`.
 *
 * It exists because client-side `PermGate` is UX only — a server function
 * that can mint a statutory IRN must enforce the same rule itself, otherwise
 * anyone with a valid session could call the endpoint directly.
 *
 * These tests pin the precedence rules. Getting precedence wrong silently
 * grants or silently revokes a permission, which is why each rule has its own
 * test rather than one combined case.
 */

type Snapshot = Parameters<typeof resolveModulePermission>[0];

const SALES_EDIT = { module: "sales", action: "edit" } as const;

describe("resolveModulePermission — admin", () => {
  it("allows an admin regardless of the module matrix", () => {
    const s: Snapshot = { isAdmin: true, appUser: { status: "active" }, rolePerms: {} };
    expect(resolveModulePermission(s, SALES_EDIT.module, SALES_EDIT.action)).toBe(true);
  });
});

describe("resolveModulePermission — account state", () => {
  it("denies an inactive user even when the matrix would allow it", () => {
    const s: Snapshot = {
      isAdmin: false,
      appUser: { status: "inactive" },
      rolePerms: { sales: { can_edit: true } },
    };
    expect(resolveModulePermission(s, SALES_EDIT.module, SALES_EDIT.action)).toBe(false);
  });

  it("denies when there is no app_users row at all", () => {
    const s: Snapshot = { isAdmin: false, appUser: null, rolePerms: {} };
    expect(resolveModulePermission(s, SALES_EDIT.module, SALES_EDIT.action)).toBe(false);
  });
});

describe("resolveModulePermission — per-user override beats the role", () => {
  it("allows when custom_permissions grants it", () => {
    const s: Snapshot = {
      isAdmin: false,
      appUser: { status: "active", customPermissions: { sales: { can_edit: true } } },
      rolePerms: {},
    };
    expect(resolveModulePermission(s, SALES_EDIT.module, SALES_EDIT.action)).toBe(true);
  });

  it("denies when custom_permissions explicitly revokes it even if the role grants it", () => {
    const s: Snapshot = {
      isAdmin: false,
      appUser: { status: "active", customPermissions: { sales: { can_edit: false } } },
      rolePerms: { sales: { can_edit: true } },
    };
    expect(resolveModulePermission(s, SALES_EDIT.module, SALES_EDIT.action)).toBe(false);
  });
});

describe("resolveModulePermission — role matrix", () => {
  it("falls back to the role matrix when the user has no override", () => {
    const s: Snapshot = {
      isAdmin: false,
      appUser: { status: "active" },
      rolePerms: { sales: { can_edit: true } },
    };
    expect(resolveModulePermission(s, SALES_EDIT.module, SALES_EDIT.action)).toBe(true);
  });

  it("denies an action the role grants elsewhere (read does not imply edit)", () => {
    const s: Snapshot = {
      isAdmin: false,
      appUser: { status: "active" },
      rolePerms: { sales: { can_read: true } },
    };
    expect(resolveModulePermission(s, SALES_EDIT.module, SALES_EDIT.action)).toBe(false);
  });

  it("denies by default when nothing grants the module", () => {
    const s: Snapshot = { isAdmin: false, appUser: { status: "active" }, rolePerms: {} };
    expect(resolveModulePermission(s, SALES_EDIT.module, SALES_EDIT.action)).toBe(false);
  });

  it("ignores a grant on a different module", () => {
    const s: Snapshot = {
      isAdmin: false,
      appUser: { status: "active" },
      rolePerms: { reports: { can_edit: true } },
    };
    expect(resolveModulePermission(s, SALES_EDIT.module, SALES_EDIT.action)).toBe(false);
  });
});

describe("permissionError", () => {
  it("produces a 403-shaped error naming the module and action", () => {
    const err = permissionError("sales", "edit");
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("sales");
    expect(err.message).toContain("edit");
  });
});
