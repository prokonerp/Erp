import { describe, expect, it } from "vitest";
import { buildStorageUploadRequest } from "../storage-upload-raw";
import { storageUploadMessage } from "../format-error";

// Task A1 (fsr-print-polish): supabase-js `.upload()` always sends
// `x-upsert`, tripping 500 P0001 on the upsert path. The raw transport
// must never carry that header. Pure request-shape assertions —
// no network, no fetch mocks for behavior.
describe("buildStorageUploadRequest", () => {
  const base = {
    url: "https://xyz.supabase.co",
    serviceKey: "svc-key",
    bucket: "ticket-attachments",
    path: "ticket/abc/2026-09-16/issue_photo-123.jpg",
    body: new Uint8Array([1, 2, 3]),
    contentType: "image/jpeg",
  };

  it("never contains any x-upsert header key", () => {
    const req = buildStorageUploadRequest(base);
    expect(Object.keys(req.headers).map((k) => k.toLowerCase())).not.toContain("x-upsert");
    expect("x-upsert" in req.headers).toBe(false);
  });

  it("sets Authorization + Content-Type and POSTs to /storage/v1/object/<bucket>/<path>", () => {
    const req = buildStorageUploadRequest(base);
    expect(req.method).toBe("POST");
    expect(req.headers.Authorization).toBe("Bearer svc-key");
    expect(req.headers["Content-Type"]).toBe("image/jpeg");
    expect(req.url).toBe(
      "https://xyz.supabase.co/storage/v1/object/ticket-attachments/ticket/abc/2026-09-16/issue_photo-123.jpg",
    );
    expect(req.body).toBe(base.body);
  });

  it("passes cache-control through only when provided", () => {
    expect(buildStorageUploadRequest(base).headers["Cache-Control"]).toBeUndefined();
    expect(
      buildStorageUploadRequest({ ...base, cacheControl: "3600" }).headers["Cache-Control"],
    ).toBe("3600");
  });

  it("strips trailing slashes from the base url", () => {
    const req = buildStorageUploadRequest({ ...base, url: "https://xyz.supabase.co///" });
    expect(req.url.startsWith("https://xyz.supabase.co/storage/v1/object/")).toBe(true);
  });

  it("stays compatible with storageUploadMessage throw shape", () => {
    const msg = storageUploadMessage(
      "ticket-attachments",
      { message: "Internal Error", statusCode: 500 },
      base.path,
    );
    expect(msg).toContain("ticket-attachments");
    expect(msg).toContain("[500]");
    expect(msg).toContain(base.path);
    expect(msg).toContain("Internal Error");
  });
});
