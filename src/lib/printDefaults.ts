/**
 * printDefaults.ts — centrally editable print constants.
 *
 * NOTE: intentionally code-config for now (no schema change in this round).
 * When a settings table is added later, these become rows — every consumer
 * already reads through this single module.
 */

/** Default Terms & Conditions printed on Delivery Challans when the record has none. */
export const CHALLAN_TERMS_DEFAULT = [
  "Goods once dispatched will not be taken back without prior written consent.",
  "Goods received in good condition by the consignee.",
  "Subject to company dispatch policies and applicable jurisdiction.",
] as const;

/**
 * Fallback shown on tax invoices when neither the invoice nor the branch /
 * invoice-settings provide terms. Deliberately neutral — the old hardcoded
 * "Subject to Haryana Jurisdiction" is gone; jurisdiction must be configured
 * explicitly per branch (invoice_footer) or invoice.
 */
export const INVOICE_TERMS_FALLBACK = [
  "1. Goods once sold will not be taken back",
  "2. Warranty as per APC / OEM policy",
  "3. Payment due as per agreed terms",
  "4. Interest @18% p.a. applicable on delayed payments",
  "5. Subject to Gurugram jurisdiction",
] as const;

/**
 * City used in the jurisdiction term when the fallback terms are printed.
 * Code-config for now (see file note above) — move to a settings table later.
 */
export const INVOICE_JURISDICTION_CITY = "Gurugram";
