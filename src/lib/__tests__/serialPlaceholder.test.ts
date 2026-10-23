import { describe, expect, it } from "vitest";
import {
  assertIdentifyingSerial,
  identityKey,
  isIdentifyingSerial,
  isPlaceholderSerial,
  normalizeSerialKey,
  normSerial,
  sanitizeSerial,
  stripPlaceholderTokens,
} from "@/lib/serial";

describe("serial identity", () => {
  it("treats letters and digits as identifying", () => {
    expect(isIdentifyingSerial("SN123")).toBe(true);
    expect(isIdentifyingSerial("a-1")).toBe(true);
    expect(isIdentifyingSerial(" 0 ")).toBe(true);
  });

  it("treats empty as not identifying but not a placeholder", () => {
    expect(isIdentifyingSerial("")).toBe(false);
    expect(isIdentifyingSerial("   ")).toBe(false);
    expect(isPlaceholderSerial("")).toBe(false);
    expect(isPlaceholderSerial("   ")).toBe(false);
  });

  it.each([",", ".", "..", "...", ",,", " - ", "/", "/?"])("flags %j as a placeholder", (v) => {
    expect(isPlaceholderSerial(v)).toBe(true);
    expect(isIdentifyingSerial(v)).toBe(false);
  });

  it("does not flag a real serial containing punctuation", () => {
    expect(isPlaceholderSerial("ABC-123/4")).toBe(false);
    expect(isPlaceholderSerial("A.1")).toBe(false);
  });

  it("normalizes for storage and nulls placeholders", () => {
    expect(normSerial("  ab-1 ")).toBe("AB-1");
    expect(sanitizeSerial("  ab-1 ")).toBe("AB-1");
    expect(sanitizeSerial(",")).toBe("");
    expect(sanitizeSerial(null)).toBe("");
  });

  it("never builds an identity key from a placeholder", () => {
    expect(identityKey("MODEL", ",")).toBe("");
    expect(identityKey("MODEL", "...")).toBe("");
    expect(identityKey("MODEL", "")).toBe("");
    expect(identityKey("MODEL", "SN1")).toBe("MODEL|SN1");
  });

  it("exposes the raw SQL-mirror key separately", () => {
    expect(normalizeSerialKey(" model ", " sn1 ")).toBe("MODEL|SN1");
    expect(normalizeSerialKey("MODEL", ",")).toBe("MODEL|,");
  });

  it("strips placeholder tokens while preserving order and collapsing duplicates", () => {
    expect(stripPlaceholderTokens(",ABC,.,abc, DEF, ...")).toBe("ABC,DEF");
    expect(stripPlaceholderTokens(",.")).toBe("");
    expect(stripPlaceholderTokens("")).toBe("");
  });

  it("throws a clear error for required non-identifying values", () => {
    expect(() => assertIdentifyingSerial(",", "DEF serial")).toThrow(/DEF serial/);
    expect(() => assertIdentifyingSerial("", "DEF serial")).toThrow(/letter or digit/);
    expect(assertIdentifyingSerial("  sn9 ", "DEF serial")).toBe("SN9");
  });
});
