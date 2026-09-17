import { describe, it, expect } from "vitest";
import { expenseFingerprint, nextExpenseKey } from "@/lib/expense-client-key";

const base = {
  charge_type: "conveyance",
  amount: "120",
  expense_date: "2026-09-17",
  receipt_name: null as string | null,
};

describe("expense-client-key", () => {
  it("same payload reuses the key (reused:true)", () => {
    const fp = expenseFingerprint(base);
    const first = nextExpenseKey(null, fp);
    expect(first.reused).toBe(false);
    const second = nextExpenseKey({ key: first.key, fingerprint: first.fingerprint }, fp);
    expect(second.reused).toBe(true);
    expect(second.key).toBe(first.key);
  });

  it("changed amount mints a new key (reused:false)", () => {
    const fp = expenseFingerprint(base);
    const first = nextExpenseKey(null, fp);
    const changed = expenseFingerprint({ ...base, amount: "150" });
    const second = nextExpenseKey({ key: first.key, fingerprint: first.fingerprint }, changed);
    expect(second.reused).toBe(false);
    expect(second.key).not.toBe(first.key);
  });

  it("changed charge_type mints a new key (reused:false)", () => {
    const fp = expenseFingerprint(base);
    const first = nextExpenseKey(null, fp);
    const changed = expenseFingerprint({ ...base, charge_type: "food" });
    const second = nextExpenseKey({ key: first.key, fingerprint: first.fingerprint }, changed);
    expect(second.reused).toBe(false);
    expect(second.key).not.toBe(first.key);
  });

  it("changed expense_date mints a new key (reused:false)", () => {
    const fp = expenseFingerprint(base);
    const first = nextExpenseKey(null, fp);
    const changed = expenseFingerprint({ ...base, expense_date: "2026-09-16" });
    const second = nextExpenseKey({ key: first.key, fingerprint: first.fingerprint }, changed);
    expect(second.reused).toBe(false);
    expect(second.key).not.toBe(first.key);
  });

  it("null prev mints a new key (reused:false)", () => {
    const fp = expenseFingerprint(base);
    const next = nextExpenseKey(null, fp);
    expect(next.reused).toBe(false);
    expect(typeof next.key).toBe("string");
    expect(next.key.length).toBeGreaterThan(0);
    expect(next.fingerprint).toBe(fp);
  });
});
