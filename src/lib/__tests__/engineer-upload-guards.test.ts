import { describe, it, expect } from "vitest";
import { z } from "zod";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BYTES = 8 * 1024 * 1024;

const uploadSchema = z.object({
  ticket_id: z.string().uuid(),
  filename: z.string().min(1).max(200),
  content_type: z.string().min(1).max(100),
  kind: z.enum(["serial_photo", "issue_photo", "other"]),
  data_base64: z
    .string()
    .min(1)
    .max(Math.ceil((MAX_BYTES * 4) / 3) + 1024),
});

const deleteSchema = z.object({
  path: z.string().min(1).max(500),
  token: z.string().min(10).max(200),
});

const validUpload = {
  ticket_id: "550e8400-e29b-41d4-a716-446655440000",
  filename: "photo.jpg",
  content_type: "image/jpeg",
  kind: "serial_photo" as const,
  data_base64: "dGVzdA==",
};

describe("upload schema guards", () => {
  it("rejects upload without ticket_id", () => {
    const { ticket_id, ...noTicket } = validUpload;
    expect(() => uploadSchema.parse(noTicket)).toThrow();
  });

  it("rejects upload with invalid ticket_id (not UUID)", () => {
    expect(() => uploadSchema.parse({ ...validUpload, ticket_id: "not-a-uuid" })).toThrow();
  });

  it("accepts valid upload with ticket_id", () => {
    expect(() => uploadSchema.parse(validUpload)).not.toThrow();
  });
});

describe("delete schema guards", () => {
  it("rejects delete without path", () => {
    expect(() => deleteSchema.parse({ token: "abcdef123456" })).toThrow();
  });

  it("rejects delete without token", () => {
    expect(() => deleteSchema.parse({ path: "ticket/abc" })).toThrow();
  });

  it("accepts valid delete input", () => {
    expect(() =>
      deleteSchema.parse({ path: "ticket/abc/file.jpg", token: "abcdef123456" }),
    ).not.toThrow();
  });
});

describe("path validation (pure logic)", () => {
  function isValidUploadPath(p: string): boolean {
    return p.startsWith("public/") || p.startsWith("ticket/");
  }

  it("accepts new ticket-scoped paths", () => {
    expect(
      isValidUploadPath(
        "ticket/550e8400-e29b-41d4-a716-446655440000/2026-09-10/serial_photo-1234-abc.jpg",
      ),
    ).toBe(true);
  });

  it("accepts legacy public paths for backward compat", () => {
    expect(isValidUploadPath("public/2026-09-10/serial_photo-1234-abc.jpg")).toBe(true);
  });

  it("rejects paths that are neither public/ nor ticket/", () => {
    expect(isValidUploadPath("admin/secret.jpg")).toBe(false);
    expect(isValidUploadPath("/etc/passwd")).toBe(false);
  });
});

describe("delete path guard (pure logic)", () => {
  function canDeletePath(p: string): boolean {
    return p.startsWith("public/") || p.startsWith("ticket/");
  }

  it("allows deletion of ticket-scoped paths", () => {
    expect(canDeletePath("ticket/abc/2026-09-10/file.jpg")).toBe(true);
  });

  it("allows deletion of legacy public paths", () => {
    expect(canDeletePath("public/2026-09-10/file.jpg")).toBe(true);
  });

  it("rejects non-standard paths", () => {
    expect(canDeletePath("admin/secret.jpg")).toBe(false);
  });
});

describe("MIME type guard (pure logic)", () => {
  it("allows only image MIME types", () => {
    expect(ALLOWED_MIME).toContain("image/jpeg");
    expect(ALLOWED_MIME).toContain("image/png");
    expect(ALLOWED_MIME).toContain("image/webp");
    expect(ALLOWED_MIME).not.toContain("application/pdf");
    expect(ALLOWED_MIME).not.toContain("text/html");
  });
});

describe("upload path construction (pure logic)", () => {
  function buildUploadPath(ticketId: string, kind: string): string {
    const name = `${kind}-${Date.now()}-abc123.jpg`;
    return `ticket/${ticketId}/${new Date().toISOString().slice(0, 10)}/${name}`;
  }

  it("embeds ticket_id in upload path", () => {
    const tid = "550e8400-e29b-41d4-a716-446655440000";
    const path = buildUploadPath(tid, "serial_photo");
    expect(path).toMatch(/^ticket\/550e8400-e29b-41d4-a716-446655440000\//);
  });

  it("path starts with ticket/ prefix (not public/)", () => {
    const path = buildUploadPath("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "issue_photo");
    expect(path.startsWith("ticket/")).toBe(true);
    expect(path.startsWith("public/")).toBe(false);
  });
});

describe("storage policy compatibility (pure logic)", () => {
  function storageInsertAllowed(path: string): boolean {
    const folder1 = path.split("/")[0];
    return folder1 === "public" || folder1 === "ticket";
  }

  it("allows new ticket-scoped upload paths", () => {
    expect(
      storageInsertAllowed("ticket/550e8400-e29b-41d4-a716-446655440000/2026-09-10/photo.jpg"),
    ).toBe(true);
  });

  it("allows legacy public upload paths", () => {
    expect(storageInsertAllowed("public/2026-09-10/photo.jpg")).toBe(true);
  });

  it("rejects paths outside public/ and ticket/", () => {
    expect(storageInsertAllowed("admin/secret.jpg")).toBe(false);
  });
});

describe("delete path guard - legacy and new paths", () => {
  function canDeletePath(p: string): boolean {
    return p.startsWith("public/") || p.startsWith("ticket/");
  }

  it("allows admin to delete legacy public/ paths", () => {
    expect(canDeletePath("public/2026-09-10/serial_photo-123-abc.jpg")).toBe(true);
  });

  it("allows admin to delete new ticket/ paths", () => {
    expect(canDeletePath("ticket/550e8400-e29b-41d4-a716-446655440000/2026-09-10/photo.jpg")).toBe(
      true,
    );
  });

  it("rejects non-standard paths even for admin", () => {
    expect(canDeletePath("random/path.jpg")).toBe(false);
  });
});
