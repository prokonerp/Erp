import { describe, it, expect } from "vitest";
import {
  MAX_ACCEPTED_BYTES,
  COMPRESS_TARGET_BYTES,
  SERVER_HARD_MAX_BYTES,
  ALLOWED_IMAGE_MIME,
  HEIC_MIME,
  acceptedUploadMessage,
  assertAcceptedUploadSize,
} from "@/lib/upload-limits";

describe("upload-limits constants", () => {
  it("pins the accepted / compress / server ceilings", () => {
    expect(MAX_ACCEPTED_BYTES).toBe(5 * 1024 * 1024);
    expect(COMPRESS_TARGET_BYTES).toBe(1572864);
    expect(SERVER_HARD_MAX_BYTES).toBe(8 * 1024 * 1024);
  });

  it("pins the allowed image MIME sets", () => {
    expect([...ALLOWED_IMAGE_MIME]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]);
    expect([...HEIC_MIME]).toEqual(["image/heic", "image/heif"]);
  });
});

describe("acceptedUploadMessage", () => {
  it("mentions the 5 MB cap", () => {
    expect(acceptedUploadMessage()).toContain("5 MB");
  });
});

describe("assertAcceptedUploadSize", () => {
  it("passes at exactly 5MB", () => {
    expect(() => assertAcceptedUploadSize(MAX_ACCEPTED_BYTES)).not.toThrow();
  });

  it("throws at 5MB+1", () => {
    expect(() => assertAcceptedUploadSize(MAX_ACCEPTED_BYTES + 1)).toThrow(
      acceptedUploadMessage(),
    );
  });

  it("throws at 0 and negative sizes", () => {
    expect(() => assertAcceptedUploadSize(0)).toThrow(acceptedUploadMessage());
    expect(() => assertAcceptedUploadSize(-1)).toThrow(acceptedUploadMessage());
  });
});
