import { describe, expect, it } from "vitest";
import { uploadSchema } from "@/lib/public-ticket-uploads.functions";

describe("upload schema geo refinement", () => {
  it("equipment_correction requires both lat and long, allows zeros", () => {
    const base = { ticket_id: crypto.randomUUID(), filename: "a.jpg", content_type: "image/jpeg", data_base64: "AQ==" };
    expect(() => uploadSchema.parse({ ...base, kind: "equipment_correction", lat: 28, captured_at: "2026-01-01" })).toThrow();
    expect(() => uploadSchema.parse({ ...base, kind: "equipment_correction", lat: 0, long: 0, captured_at: "2026-01-01" })).not.toThrow();
  });
});
