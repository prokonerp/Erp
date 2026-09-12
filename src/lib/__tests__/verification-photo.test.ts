import { describe, expect, it } from "vitest";
import { isBucketMissingError } from "@/components/VerificationDiff";

describe("isBucketMissingError", () => {
  it("returns true for Bucket not found", () => {
    expect(isBucketMissingError("Bucket not found")).toBe(true);
  });
  it("returns true for NoSuchBucket / 404 variants", () => {
    expect(isBucketMissingError("NoSuchBucket: The specified bucket does not exist")).toBe(true);
    expect(isBucketMissingError("404 Bucket not found for ticket-attachments")).toBe(true);
  });
  it("returns false for unrelated errors and empty input", () => {
    expect(isBucketMissingError("permission denied")).toBe(false);
    expect(isBucketMissingError("")).toBe(false);
    expect(isBucketMissingError(null as unknown as string)).toBe(false);
    expect(isBucketMissingError(undefined as unknown as string)).toBe(false);
  });
});
