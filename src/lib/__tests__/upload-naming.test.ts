import { describe, expect, it } from "vitest";
import {
  buildUploadFilename,
  initialsFromName,
  makeNameToken,
  parseUploadFilename,
  sanitizeNameLabel,
} from "../upload-naming";

describe("initialsFromName", () => {
  it("takes first letters of two words", () => {
    expect(initialsFromName("Jai Deep")).toBe("JD");
  });

  it("handles a single name with its first two letters", () => {
    expect(initialsFromName("Jai")).toBe("JA");
  });

  it("returns ENG for empty input", () => {
    expect(initialsFromName("")).toBe("ENG");
    expect(initialsFromName(null)).toBe("ENG");
    expect(initialsFromName(undefined)).toBe("ENG");
    expect(initialsFromName("   ")).toBe("ENG");
  });

  it("uppercases lowercase names", () => {
    expect(initialsFromName("jai deep")).toBe("JD");
  });

  it("ignores special chars and falls back to ENG for garbage", () => {
    expect(initialsFromName("J@i D#oe")).toBe("JD");
    expect(initialsFromName("@#$ %^&")).toBe("ENG");
  });
});

describe("sanitizeNameLabel", () => {
  it("returns null for empty input", () => {
    expect(sanitizeNameLabel(null)).toBeNull();
    expect(sanitizeNameLabel("")).toBeNull();
  });
});

describe("makeNameToken", () => {
  it("returns 8 chars of [a-z0-9]", () => {
    expect(makeNameToken()).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("buildUploadFilename", () => {
  it("builds the exact format with label", () => {
    expect(
      buildUploadFilename({
        initials: "JD",
        kind: "CONVEYANCE",
        date: "2026-09-17",
        label: "morning",
        token: "4f2a9c1d",
        ext: "jpg",
      }),
    ).toBe("JD_CONVEYANCE_2026-09-17_MORNING-4f2a9c1d.jpg");
  });

  it("omits the label segment when no label", () => {
    expect(
      buildUploadFilename({
        initials: "JD",
        kind: "ISSUE",
        date: "2026-09-17",
        token: "abcd1234",
        ext: "png",
      }),
    ).toBe("JD_ISSUE_2026-09-17-abcd1234.png");
  });

  it("throws on invalid input", () => {
    const good = {
      initials: "JD",
      kind: "ISSUE" as const,
      date: "2026-09-17",
      token: "abcd1234",
      ext: "png",
    };
    expect(() => buildUploadFilename({ ...good, initials: "toolong" })).toThrow();
    expect(() => buildUploadFilename({ ...good, kind: "NOPE" as never })).toThrow();
    expect(() => buildUploadFilename({ ...good, date: "17-09-2026" })).toThrow();
    expect(() => buildUploadFilename({ ...good, token: "!!!" })).toThrow();
  });
});

describe("parseUploadFilename", () => {
  it("round-trips a built name", () => {
    const filename = buildUploadFilename({
      initials: "JD",
      kind: "CONVEYANCE",
      date: "2026-09-17",
      label: "morning",
      token: "4f2a9c1d",
      ext: "jpg",
    });
    expect(parseUploadFilename(filename)).toEqual({
      kind: "CONVEYANCE",
      legacy: false,
    });
  });

  it.each([
    ["serial_photo-123.png", "serial_photo"],
    ["equipment_correction-123.png", "equipment_correction"],
    ["issue_photo-123.png", "issue_photo"],
    ["customer_signature-123.png", "customer_signature"],
    ["other-123.png", "other"],
    ["signature-1700000000000.png", "signature"],
  ])("detects legacy form %s", (filename, legacyKind) => {
    expect(parseUploadFilename(filename)).toEqual({
      legacy: true,
      legacyKind,
    });
  });

  it("returns null for garbage", () => {
    expect(parseUploadFilename("random-notes.txt")).toBeNull();
    expect(parseUploadFilename("")).toBeNull();
  });
});
