import { z } from "zod";

// Bounded text helpers — protect DB and downstream URLs (mailto/wa.me) from
// unbounded input while preserving normal business content.
const shortText = (max = 200) => z.string().trim().max(max);
const longText = (max = 2000) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
const money = z.coerce.number().finite().nonnegative().max(1_000_000_000);
const phone = z.string().trim().regex(/^[+\d][\d\s\-()]{5,20}$/, "Invalid phone").optional().nullable();
const gstin = z.string().trim().regex(/^[0-9A-Z]{15}$/, "Invalid GSTIN").optional().nullable();

export const paymentInputSchema = z.object({
  customer_id: z.string().uuid(),
  payment_date: isoDate,
  mode: z.enum(["cash", "bank", "upi", "cheque", "card", "other"]),
  amount: money.refine((n) => n > 0, "Amount must be greater than zero"),
  reference: shortText(120).nullish(),
  notes: longText(1000).nullish(),
});

export const quotationCreateSchema = z.object({
  customer_id: z.string().uuid(),
  subject: shortText(200).nullish(),
});

export const invoiceHeaderPatchSchema = z.object({
  po_number: shortText(60).nullish(),
  po_date: isoDate.nullish(),
  buyer_name: shortText(200).nullish(),
  buyer_gstin: gstin,
  billing_address: longText(500).nullish(),
  shipping_address: longText(500).nullish(),
  notes: longText(1000).nullish(),
});

export const shareContactSchema = z.object({
  phone,
  email: z.string().trim().email().max(255).nullish(),
});

export type PaymentInput = z.infer<typeof paymentInputSchema>;
export type QuotationCreateInput = z.infer<typeof quotationCreateSchema>;
export type InvoiceHeaderPatch = z.infer<typeof invoiceHeaderPatchSchema>;