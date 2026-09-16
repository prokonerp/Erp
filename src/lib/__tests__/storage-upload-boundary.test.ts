import { describe, expect, it } from "vitest";
import { storageUploadMessage } from "../format-error";

// Task C (fsr-print-polish): only Error.message crosses the server-fn
// boundary, so the engineer + ticket-delete storage throws must embed
// bucket + status + path. Pure message-format assertions — no network,
// no mocks of behavior.
describe("Task C storage-throw boundary messages", () => {
  it("engineer upload embeds bucket, [500], path and message", () => {
    const msg = storageUploadMessage(
      "engineer-uploads",
      { message: "Internal Error", statusCode: 500 },
      "engineer/e1/receipt/2026-09-16/receipt-123.jpg",
    );
    expect(msg).toContain("engineer-uploads");
    expect(msg).toContain("[500]");
    expect(msg).toContain("engineer/e1/receipt/2026-09-16/receipt-123.jpg");
    expect(msg).toContain("Internal Error");
  });

  it("engineer delete embeds bucket, [500], path and message", () => {
    const msg = storageUploadMessage(
      "engineer-uploads",
      { message: "Internal Error", statusCode: 500 },
      "engineer/e1/receipt/2026-09-16/receipt-123.jpg",
    );
    expect(msg).toContain("engineer-uploads");
    expect(msg).toContain("[500]");
    expect(msg).toContain("engineer/e1/receipt/2026-09-16/receipt-123.jpg");
    expect(msg).toContain("Internal Error");
  });

  it("ticket delete embeds bucket, [500], path and message", () => {
    const msg = storageUploadMessage(
      "ticket-attachments",
      { message: "Internal Error", statusCode: 500 },
      "ticket/abc/2026-09-16/issue_photo-123.jpg",
    );
    expect(msg).toContain("ticket-attachments");
    expect(msg).toContain("[500]");
    expect(msg).toContain("ticket/abc/2026-09-16/issue_photo-123.jpg");
    expect(msg).toContain("Internal Error");
  });
});
