-- 1. New standardized columns
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS short_name text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS is_serialized boolean NOT NULL DEFAULT false;

UPDATE public.products SET is_serialized = COALESCE(serial_tracking, false);

-- 2. Merge duplicates by normalized model
WITH ranked AS (
  SELECT id, lower(btrim(model)) AS m,
         first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products
  WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (
  SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id
)
, u1 AS (UPDATE public.invoice_items t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
, u2 AS (UPDATE public.purchase_order_items t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
, u3 AS (UPDATE public.serials t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
, u4 AS (UPDATE public.inventory t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
, u5 AS (UPDATE public.battery_catalog t SET product_id = d.keep_id FROM dupes d WHERE t.product_id = d.dup_id RETURNING 1)
SELECT count(*) FROM dupes;

-- bundles / spare parts (may have unique pairs) -- delete rows that would collide, then repoint
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
UPDATE public.product_bundles t SET parent_product_id = d.keep_id FROM dupes d WHERE t.parent_product_id = d.dup_id;

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
UPDATE public.product_bundles t SET child_product_id = d.keep_id FROM dupes d WHERE t.child_product_id = d.dup_id;

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
DELETE FROM public.product_spare_parts t
USING dupes d
WHERE t.parent_product_id = d.dup_id
  AND EXISTS (SELECT 1 FROM public.product_spare_parts x
              WHERE x.parent_product_id = d.keep_id AND x.spare_part_id = t.spare_part_id);

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
UPDATE public.product_spare_parts t SET parent_product_id = d.keep_id FROM dupes d WHERE t.parent_product_id = d.dup_id;

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
DELETE FROM public.product_spare_parts t
USING dupes d
WHERE t.spare_part_id = d.dup_id
  AND EXISTS (SELECT 1 FROM public.product_spare_parts x
              WHERE x.spare_part_id = d.keep_id AND x.parent_product_id = t.parent_product_id);

WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
), dupes AS (SELECT id AS dup_id, keep_id FROM ranked WHERE id <> keep_id)
UPDATE public.product_spare_parts t SET spare_part_id = d.keep_id FROM dupes d WHERE t.spare_part_id = d.dup_id;

-- drop exact duplicate link rows created by the merge
DELETE FROM public.product_spare_parts a
USING public.product_spare_parts b
WHERE a.ctid > b.ctid
  AND a.parent_product_id = b.parent_product_id
  AND a.spare_part_id = b.spare_part_id;

DELETE FROM public.product_bundles a
USING public.product_bundles b
WHERE a.ctid > b.ctid
  AND a.parent_product_id = b.parent_product_id
  AND a.child_product_id = b.child_product_id;

-- finally remove duplicate product rows
WITH ranked AS (
  SELECT id, first_value(id) OVER (PARTITION BY lower(btrim(model)) ORDER BY created_at, id) AS keep_id
  FROM public.products WHERE model IS NOT NULL AND btrim(model) <> ''
)
DELETE FROM public.products p USING ranked r WHERE p.id = r.id AND r.id <> r.keep_id;

-- 3. Backfill names
UPDATE public.products
SET short_name = btrim(model),
    display_name = btrim(COALESCE(NULLIF(btrim(brand),'') || ' ', '') || btrim(model))
WHERE model IS NOT NULL AND btrim(model) <> '';

UPDATE public.products
SET short_name = COALESCE(NULLIF(btrim(short_name),''), NULLIF(btrim(name),''), '(unnamed)'),
    display_name = COALESCE(NULLIF(btrim(display_name),''), NULLIF(btrim(name),''), '(unnamed)');

-- 4. Keep names in sync + enforce uniqueness
CREATE OR REPLACE FUNCTION public.products_normalize_names()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE m text; b text;
BEGIN
  m := NULLIF(btrim(COALESCE(NEW.model,'')), '');
  b := NULLIF(btrim(COALESCE(NEW.brand,'')), '');
  NEW.model := m;
  IF m IS NOT NULL THEN
    NEW.short_name := m;
    NEW.display_name := btrim(COALESCE(b || ' ', '') || m);
  ELSE
    NEW.short_name := COALESCE(NULLIF(btrim(COALESCE(NEW.short_name,'')),''), NULLIF(btrim(COALESCE(NEW.name,'')),''), '(unnamed)');
    NEW.display_name := COALESCE(NULLIF(btrim(COALESCE(NEW.display_name,'')),''), NEW.short_name);
  END IF;
  NEW.is_serialized := COALESCE(NEW.is_serialized, false) OR COALESCE(NEW.serial_tracking, false);
  NEW.serial_tracking := NEW.is_serialized;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_products_normalize_names ON public.products;
CREATE TRIGGER trg_products_normalize_names
BEFORE INSERT OR UPDATE ON public.products
FOR EACH ROW EXECUTE FUNCTION public.products_normalize_names();

CREATE UNIQUE INDEX IF NOT EXISTS products_model_unique
  ON public.products (lower(btrim(model)))
  WHERE model IS NOT NULL AND btrim(model) <> '';