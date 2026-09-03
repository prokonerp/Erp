// Central money rounding helpers — single source of truth for INR paise rounding.
// gst.ts, crm.ts, invoiceJson.ts etc must share the same EPSILON-aware logic
// so that quotations, invoices and GSTR JSON never drift by 1 paise.
// Tie handling: EPSILON nudges most binary .005 cases toward intuitive rounding
// (e.g. 1.005 → 1.01 with EPSILON, vs 1.00 without EPSILON, matching toFixed's
// "1.00" actually diverges the other way; 2.675 → r2 2.68 vs toFixed "2.67").
// All money paths MUST use r2/r3 here so drift is consistent (never mix toFixed and r2).

export const r2 = (n: number): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
};

export const r3 = (n: number): number => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 1000) / 1000;
};

// aliases for readability where needed
export const round2 = r2;
export const round3 = r3;
