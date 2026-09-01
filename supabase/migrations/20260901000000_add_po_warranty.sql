-- Add warranty to PO items — per-product warranty, editable per line
-- SAFE: no DELETE/DROP/TRUNCATE. Only adds column, backfills NULLs from product master, sets default.
-- Old POs will get the warranty that WAS set at making time (product's warranty), not forced 12.

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS warranty_months INT;

-- Smart backfill: for each old item where warranty is still NULL,
-- copy the product's current warranty (converted to months), else 12.
-- This fixes the "all old POs show 12" issue — e.g. 113 products are 24 months, now old POs will show 24.
-- WHERE warranty_months IS NULL ensures we NEVER overwrite a value you already edited.
UPDATE public.purchase_order_items poi
SET warranty_months = COALESCE(
  (
    SELECT
      CASE
        WHEN p.warranty_applicable = true AND p.warranty_duration IS NOT NULL
        THEN
          CASE
            WHEN lower(COALESCE(p.warranty_unit, 'Months')) LIKE 'y%' THEN (p.warranty_duration * 12)
            WHEN lower(COALESCE(p.warranty_unit, 'Months')) LIKE 'd%' THEN CEIL(p.warranty_duration / 30.0)::int
            ELSE p.warranty_duration
          END
        ELSE 12
      END
    FROM public.products p
    WHERE p.id = poi.product_id
  ),
  12
)
WHERE poi.warranty_months IS NULL;

-- Set default for future inserts (when product has no warranty, code also does productWarrantyMonths >0 ? w :12)
ALTER TABLE public.purchase_order_items
  ALTER COLUMN warranty_months SET DEFAULT 12;

-- Constraint 0-120, scoped to this table only
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_warranty_months_range'
      AND conrelid = 'public.purchase_order_items'::regclass
  ) THEN
    ALTER TABLE public.purchase_order_items
      ADD CONSTRAINT poi_warranty_months_range
      CHECK (warranty_months IS NULL OR (warranty_months >= 0 AND warranty_months <= 120));
  END IF;
END $$;

COMMENT ON COLUMN public.purchase_order_items.warranty_months IS 'Warranty in months per line — backfilled from product warranty, default 12, editable at PO creation';
