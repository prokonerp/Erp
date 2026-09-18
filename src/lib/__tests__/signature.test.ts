import { describe, it, expect } from "vitest";
import { canManageSignature } from "@/lib/signature";

const ADMIN = "00000000-0000-0000-0000-000000000001";
const SELF = "00000000-0000-0000-0000-000000000002";
const OTHER = "00000000-0000-0000-0000-000000000003";

describe("canManageSignature (admin-or-self upload, admin-only remove)", () => {
  it("admin may upload any user's signature", () => {
    expect(
      canManageSignature({ userId: ADMIN, isAdmin: true }, OTHER, "upload"),
    ).toBe(true);
  });

  it("admin may remove any user's signature", () => {
    expect(
      canManageSignature({ userId: ADMIN, isAdmin: true }, OTHER, "remove"),
    ).toBe(true);
  });

  it("non-admin may upload their own signature", () => {
    expect(
      canManageSignature({ userId: SELF, isAdmin: false }, SELF, "upload"),
    ).toBe(true);
  });

  it("non-admin may NOT upload another user's signature", () => {
    expect(
      canManageSignature({ userId: SELF, isAdmin: false }, OTHER, "upload"),
    ).toBe(false);
  });

  it("non-admin may NOT remove even their own signature (admin-only, legacy behavior)", () => {
    expect(
      canManageSignature({ userId: SELF, isAdmin: false }, SELF, "remove"),
    ).toBe(false);
  });

  it("non-admin may NOT remove another user's signature", () => {
    expect(
      canManageSignature({ userId: SELF, isAdmin: false }, OTHER, "remove"),
    ).toBe(false);
  });
});
