-- Add warranty to PO items — 12 months default, editable per line
-- Required so PO print shows warranty and admin can negotiate per-item cover.

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS warranty_months INT;

-- Backfill existing rows to default 12 where null
UPDATE public.purchase_order_items
SET warranty_months = 12
WHERE warranty_months IS NULL;

-- Set default for future inserts
ALTER TABLE public.purchase_order_items
  ALTER COLUMN warranty_months SET DEFAULT 12;

-- Optional: ensure constraint (0-120 months reasonable)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'poi_warranty_months_range'
  ) THEN
    ALTER TABLE public.purchase_order_items
      ADD CONSTRAINT poi_warranty_months_range
      CHECK (warranty_months IS NULL OR (warranty_months >= 0 AND warranty_months <= 120));
  END IF;
END $$;

-- Keep types in sync — comment for tooling
COMMENT ON COLUMN public.purchase_order_items.warranty_months IS 'Warranty in months per line, default 12, editable at PO creation';
