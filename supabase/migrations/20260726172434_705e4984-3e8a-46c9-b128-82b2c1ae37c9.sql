
ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS sales_office_address text,
  ADD COLUMN IF NOT EXISTS registered_office_address text,
  ADD COLUMN IF NOT EXISTS accent_color text DEFAULT '#1f3864',
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_name text,
  ADD COLUMN IF NOT EXISTS bank_account_number text,
  ADD COLUMN IF NOT EXISTS bank_ifsc text,
  ADD COLUMN IF NOT EXISTS bank_branch text;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS delivery_terms text;
