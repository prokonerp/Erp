-- Migration: 20260912000001_proforma_settings_extend.sql
-- Extend proforma_invoice_settings with appearance + defaults (mirrors invoice_settings)
-- SAFE: additive only (ADD COLUMN IF NOT EXISTS)

-- 1) Appearance columns (uses premium invoice green #1F9D4D from inv2.0)
ALTER TABLE public.proforma_invoice_settings
  ADD COLUMN IF NOT EXISTS theme_color text DEFAULT '#1F9D4D';

ALTER TABLE public.proforma_invoice_settings
  ADD COLUMN IF NOT EXISTS copy_label text DEFAULT 'Original Copy';

-- 2) Default terms / notes
ALTER TABLE public.proforma_invoice_settings
  ADD COLUMN IF NOT EXISTS terms_default text;

ALTER TABLE public.proforma_invoice_settings
  ADD COLUMN IF NOT EXISTS notes_default text;

-- 3) Company header overrides (PDF)
ALTER TABLE public.proforma_invoice_settings
  ADD COLUMN IF NOT EXISTS company_name text;

ALTER TABLE public.proforma_invoice_settings
  ADD COLUMN IF NOT EXISTS company_address text;

ALTER TABLE public.proforma_invoice_settings
  ADD COLUMN IF NOT EXISTS udyam_no text;

ALTER TABLE public.proforma_invoice_settings
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.proforma_invoice_settings
  ADD COLUMN IF NOT EXISTS email text;

-- 4) Set premium green (#1F9D4D) as default for existing rows (matches InvoicePrintView GREEN)
UPDATE public.proforma_invoice_settings
SET theme_color = '#1F9D4D'
WHERE theme_color IS NULL;
