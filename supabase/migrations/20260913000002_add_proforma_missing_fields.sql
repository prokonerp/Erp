-- Migration: 20260913000002_add_proforma_missing_fields.sql
-- Add missing print/chain fields to proforma_invoices so Q→SO→PI preserves PO/payments chain
-- SAFE: ADD COLUMN IF NOT EXISTS, no data deletion, no logic break

ALTER TABLE public.proforma_invoices
  ADD COLUMN IF NOT EXISTS payment_terms text,
  ADD COLUMN IF NOT EXISTS salesperson text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS contact_mobile text,
  ADD COLUMN IF NOT EXISTS delivery_timeline text,
  ADD COLUMN IF NOT EXISTS sales_type text;

-- Keep existing rows untouched (NULL defaults). No backfill needed.
