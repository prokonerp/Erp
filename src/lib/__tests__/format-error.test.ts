import { describe, expect, it, vi } from "vitest";
import { formatDbError, reportDbError, storageUploadMessage } from "../format-error";

// The engineer-upload P0001 arrived as message-only ("database error"),
// losing the code that names the raiser. The envelope formatter keeps
// message + code in the toast and the full envelope in the console.
describe("formatDbError", () => {
  it("preserves a PostgREST P0001 envelope in the toast", () => {
    expect(
      formatDbError({
        message: "database error",
        code: "P0001",
        details: "raise_exception",
        hint: null,
      }),
    ).toBe("database error (code P0001)");
  });

  it("preserves RLS and conflict codes", () => {
    expect(
      formatDbError({
        message: "new row violates row-level security policy",
        code: "42501",
      }),
    ).toBe("new row violates row-level security policy (code 42501)");
    expect(formatDbError({ message: "duplicate key", code: "23505" })).toBe(
      "duplicate key (code 23505)",
    );
  });

  it("falls back to statusCode/status when code is absent", () => {
    expect(formatDbError({ message: "upload failed", statusCode: "500" })).toBe(
      "upload failed (code 500)",
    );
    expect(formatDbError({ message: "timeout", status: 504 })).toBe("timeout (code 504)");
  });

  it("passes plain Errors and strings through unchanged", () => {
    expect(formatDbError(new Error("boom"))).toBe("boom");
    expect(formatDbError("oops")).toBe("oops");
  });

  it("never returns empty: falls back on null/undefined/blank", () => {
    expect(formatDbError(null)).toBe("Something went wrong");
    expect(formatDbError(undefined, "Upload failed")).toBe("Upload failed");
    expect(formatDbError({})).toBe("Something went wrong");
    expect(formatDbError({ message: "   " }, "Upload failed")).toBe("Upload failed");
  });
});

describe("storageUploadMessage", () => {
  it("embeds bucket, status, path and message for the server-fn boundary", () => {
    expect(
      storageUploadMessage(
        "ticket-attachments",
        { message: "database error", statusCode: "500" },
        "ticket/abc/diag.jpg",
      ),
    ).toBe("ticket-attachments upload failed [500]: path=ticket/abc/diag.jpg database error");
  });

  it("degrades gracefully without status or path", () => {
    expect(storageUploadMessage("ticket-attachments", { message: "boom" })).toBe(
      "ticket-attachments upload failed: boom",
    );
    expect(storageUploadMessage("ticket-attachments", null)).toBe(
      "ticket-attachments upload failed: unknown storage error",
    );
  });
});

describe("reportDbError", () => {
  it("returns the toast string and logs the full envelope without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const err = { message: "database error", code: "P0001", details: "d", hint: "h" };
      expect(reportDbError("equipment mismatch save", err)).toBe("database error (code P0001)");
      expect(spy).toHaveBeenCalledWith(
        "[equipment mismatch save]",
        expect.objectContaining({ code: "P0001", details: "d", hint: "h" }),
      );
      expect(() => reportDbError("x", null)).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
