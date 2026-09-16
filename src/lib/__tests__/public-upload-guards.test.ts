import { describe, it, expect } from "vitest";
import {
  STAGED_PUBLIC_PREFIX,
  isStagedPublicPath,
  buildStagedPublicPath,
} from "@/lib/public-upload-guards";

describe("isStagedPublicPath", () => {
  it("accepts a well-formed staged path", () => {
    expect(
      isStagedPublicPath(
        "public/staged/2026-09-16/550e8400-e29b-41d4-a716-446655440000-issue_photo.jpg",
      ),
    ).toBe(true);
  });

  it("rejects engine ticket paths and other prefixes", () => {
    expect(isStagedPublicPath("ticket/abc/x.jpg")).toBe(false);
    expect(isStagedPublicPath("public/other/x.jpg")).toBe(false);
    expect(isStagedPublicPath("public/staged")).toBe(false);
    expect(isStagedPublicPath("public/staged/")).toBe(false);
  });

  it("rejects traversal, absolute paths, and non-strings", () => {
    expect(isStagedPublicPath("public/staged/../../etc/passwd")).toBe(false);
    expect(isStagedPublicPath("public/staged/2026-09-16/../x.jpg")).toBe(false);
    expect(isStagedPublicPath("/public/staged/2026-09-16/x.jpg")).toBe(false);
    expect(isStagedPublicPath("public/staged//x.jpg")).toBe(false);
    expect(isStagedPublicPath("public/staged/2026-09-16/x.JPEG ")).toBe(false);
    expect(isStagedPublicPath("")).toBe(false);
    expect(isStagedPublicPath(null)).toBe(false);
    expect(isStagedPublicPath(undefined)).toBe(false);
    expect(isStagedPublicPath(42)).toBe(false);
  });

  it("rejects backslashes and overlong paths", () => {
    expect(isStagedPublicPath("public\\staged\\x.jpg")).toBe(false);
    expect(isStagedPublicPath(`${STAGED_PUBLIC_PREFIX}${"a".repeat(600)}`)).toBe(false);
  });
});

describe("buildStagedPublicPath", () => {
  it("builds a path that passes the guard", () => {
    const p = buildStagedPublicPath(
      new Date("2026-09-16T10:00:00Z"),
      "abc123",
      "issue_photo",
      "jpg",
    );
    expect(p).toBe("public/staged/2026-09-16/abc123-issue_photo.jpg");
    expect(isStagedPublicPath(p)).toBe(true);
  });

  it("sanitizes the extension and kind", () => {
    const p = buildStagedPublicPath(
      new Date("2026-09-16T10:00:00Z"),
      "abc123",
      "issue_photo",
      "JPG;rm -rf",
    );
    expect(p).toBe("public/staged/2026-09-16/abc123-issue_photo.jpg");
    const fallback = buildStagedPublicPath(
      new Date("2026-09-16T10:00:00Z"),
      "abc123",
      "issue_photo",
      "!!!",
    );
    expect(fallback).toBe("public/staged/2026-09-16/abc123-issue_photo.jpg");
  });
});
