import { describe, it, expect, vi, beforeEach } from "vitest";

// M16: settleEmiForPeriod must be idempotent — a second run for the same
// period must NOT double-increment paid_installments or rewrite the payment.
const mockCalls = { paymentUpsert: 0, advanceUpdate: 0 };
const mockState = { existingPayment: null as { id: string } | null };

vi.mock("@/integrations/supabase/client", () => {
  const makeBuilder = (table: string) => {
    const b: any = {
      select: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      maybeSingle: () => {
        if (table === "advance_payments") {
          return Promise.resolve({ data: mockState.existingPayment, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      upsert: () => {
        if (table === "advance_payments") {
          mockCalls.paymentUpsert++;
          mockState.existingPayment = { id: "p1" };
        }
        return b;
      },
      update: () => {
        if (table === "employee_advances") mockCalls.advanceUpdate++;
        return b;
      },
      insert: () => b,
    };
    return b;
  };
  return { supabase: { from: (t: string) => makeBuilder(t) } };
});

import { settleEmiForPeriod, type Advance } from "@/lib/payroll";

const adv = (over: Partial<Advance> = {}): Advance => ({
  id: "a1",
  employee_id: "e1",
  advance_date: "2026-01-05",
  amount: 12000,
  period_year: null,
  period_month: null,
  notes: null,
  emi_months: 6,
  emi_amount: 2000,
  remaining_months: 6,
  start_year: 2026,
  start_month: 1,
  status: "active",
  paid_amount: 0,
  paid_installments: 0,
  ...over,
});

beforeEach(() => {
  mockCalls.paymentUpsert = 0;
  mockCalls.advanceUpdate = 0;
  mockState.existingPayment = null;
});

describe("payroll/settleEmiForPeriod — M16 idempotency", () => {
  it("writes once, then skips on a second identical run (no double increment)", async () => {
    const a = adv();
    await settleEmiForPeriod([a], 2026, 1);
    await settleEmiForPeriod([a], 2026, 1);

    // payment row written exactly once, advance incremented exactly once
    expect(mockCalls.paymentUpsert).toBe(1);
    expect(mockCalls.advanceUpdate).toBe(1);
  });
});
