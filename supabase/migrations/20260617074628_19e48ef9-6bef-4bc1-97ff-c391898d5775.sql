ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS product_model text,
  ADD COLUMN IF NOT EXISTS product_serial text;