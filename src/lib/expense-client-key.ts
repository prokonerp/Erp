// Expense client-key helpers (idempotency key + payload fingerprint).
//
// The conveyance expense save dedupes on client_key server-side
// (ON CONFLICT DO NOTHING). The key must stay stable for in-flight retries
// of the SAME payload (double-tap protection) but must be fresh whenever
// the payload changed since the key was minted — otherwise an edited
// resubmit after a client-side timeout returns the STALE row.
//
// Pure module: no React, no Supabase, unit-tests in plain node.

export type ExpensePayload = {
  charge_type: string;
  amount: string;
  expense_date: string;
  receipt_name: string | null;
};

export type ExpenseKeyState = {
  key: string;
  fingerprint: string;
};

/** Stable fingerprint for an expense payload (fixed key order). */
export function expenseFingerprint(payload: ExpensePayload): string {
  return JSON.stringify({
    charge_type: payload.charge_type,
    amount: payload.amount,
    expense_date: payload.expense_date,
    receipt_name: payload.receipt_name ?? null,
  });
}

let expenseKeyFallback = 0;

/** Mint a fresh idempotency key (uuid v4). Counter fallback keeps uuid shape. */
function mintExpenseClientKey(): string {
  try {
    const fn = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
    if (fn) return fn();
  } catch {
    // Fall through to the counter fallback below.
  }
  expenseKeyFallback += 1;
  const tail =
    `${Date.now().toString(16).slice(-8)}${expenseKeyFallback.toString(16).padStart(4, "0")}`.slice(
      -12,
    );
  return `00000000-0000-4000-8000-${tail}`;
}

/**
 * Reuse the previous key only when the fingerprint matches (same payload
 * retry). Any payload change — or no previous key — mints a fresh key
 * via `crypto.randomUUID()`.
 */
export function nextExpenseKey(
  prev: ExpenseKeyState | null,
  fingerprint: string,
): ExpenseKeyState & { reused: boolean } {
  if (prev != null && prev.fingerprint === fingerprint && prev.key !== "") {
    return { key: prev.key, fingerprint, reused: true };
  }
  return { key: mintExpenseClientKey(), fingerprint, reused: false };
}
