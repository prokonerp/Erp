// TDD RED (written FIRST): markPaidAllowed gate for markSettlementPaid.
// Only exactly-Approved, unpaid, unlocked settlements may be marked paid.
import { describe, it, expect } from "vitest";
import { markPaidAllowed } from "@/lib/engineersAdmin";

describe("engineersAdmin/markPaidAllowed", () => {
  it("refuses a Pending settlement — must mention approval", () => {
    expect(markPaidAllowed({ status: "Pending", locked_at: null, paid_at: null })).toEqual({
      ok: false,
      error: expect.stringContaining("Approved"),
    });
  });

  it("refuses a Rejected settlement — must mention approval", () => {
    expect(markPaidAllowed({ status: "Rejected", locked_at: null, paid_at: null })).toEqual({
      ok: false,
      error: expect.stringContaining("Approved"),
    });
  });

  it("allows an Approved, unpaid, unlocked settlement", () => {
    expect(markPaidAllowed({ status: "Approved", locked_at: null, paid_at: null })).toEqual({
      ok: true,
    });
  });

  it("refuses an already-paid settlement", () => {
    expect(
      markPaidAllowed({
        status: "Approved",
        locked_at: null,
        paid_at: "2026-10-01T10:00:00.000Z",
      }),
    ).toEqual({ ok: false, error: expect.stringContaining("paid") });
  });

  it("refuses a locked settlement", () => {
    expect(
      markPaidAllowed({
        status: "Approved",
        locked_at: "2026-09-30T10:00:00.000Z",
        paid_at: null,
      }),
    ).toEqual({ ok: false, error: expect.stringContaining("locked") });
  });
});
