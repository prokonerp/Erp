// Central money rounding helpers — single source of truth for INR paise rounding.
// gst.ts, crm.ts, invoiceJson.ts etc must share the same EPSILON-aware logic
// so that quotations, invoices and GSTR JSON never drift by 1 paise.

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

export const round2 = r2;
export const round3 = r3;
