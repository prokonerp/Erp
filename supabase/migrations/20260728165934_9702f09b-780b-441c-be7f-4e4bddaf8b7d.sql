-- 1. pg_trgm for fuzzy name search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Customer code
CREATE SEQUENCE IF NOT EXISTS public.customer_code_seq;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS customer_code text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS dup_exempt boolean NOT NULL DEFAULT false;

-- backfill codes in creation order
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.customers WHERE customer_code IS NULL
)
UPDATE public.customers c
SET customer_code = 'CUS' || lpad(o.rn::text, 6, '0')
FROM ordered o WHERE o.id = c.id;

SELECT setval('public.customer_code_seq', GREATEST((SELECT count(*) FROM public.customers), 1));

CREATE OR REPLACE FUNCTION public.set_customer_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.customer_code IS NULL OR NEW.customer_code = '' THEN
    NEW.customer_code := 'CUS' || lpad(nextval('public.customer_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_set_customer_code ON public.customers;
CREATE TRIGGER trg_set_customer_code BEFORE INSERT ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.set_customer_code();

CREATE UNIQUE INDEX IF NOT EXISTS customers_customer_code_key ON public.customers (customer_code);

-- 3. Flag pre-existing duplicates as legacy so unique indexes can be created safely
WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY upper(trim(gst)) ORDER BY created_at, id) rn
  FROM public.customers
  WHERE customer_type = 'Business' AND gst IS NOT NULL AND trim(gst) <> '' AND upper(trim(gst)) <> 'URP'
)
UPDATE public.customers c SET dup_exempt = true FROM d WHERE d.id = c.id AND d.rn > 1;

WITH d AS (
  SELECT id, row_number() OVER (PARTITION BY regexp_replace(phone,'\D','','g') ORDER BY created_at, id) rn
  FROM public.customers
  WHERE customer_type = 'Individual' AND phone IS NOT NULL AND trim(phone) <> ''
)
UPDATE public.customers c SET dup_exempt = true FROM d WHERE d.id = c.id AND d.rn > 1;

-- 4. Partial unique indexes (database is the final authority)
CREATE UNIQUE INDEX IF NOT EXISTS customers_business_gstin_uidx
  ON public.customers (upper(trim(gst)))
  WHERE customer_type = 'Business' AND dup_exempt = false
    AND gst IS NOT NULL AND trim(gst) <> '' AND upper(trim(gst)) <> 'URP';

CREATE UNIQUE INDEX IF NOT EXISTS customers_individual_mobile_uidx
  ON public.customers (regexp_replace(phone, '\D', '', 'g'))
  WHERE customer_type = 'Individual' AND dup_exempt = false
    AND phone IS NOT NULL AND trim(phone) <> '';

-- 5. Search indexes
CREATE INDEX IF NOT EXISTS customers_company_trgm_idx ON public.customers USING gin (company gin_trgm_ops);
CREATE INDEX IF NOT EXISTS customers_gst_idx ON public.customers (upper(trim(gst)));
CREATE INDEX IF NOT EXISTS customers_phone_idx ON public.customers (regexp_replace(phone, '\D', '', 'g'));

-- 6. Mandatory identifiers for new/changed rows (legacy rows untouched)
CREATE OR REPLACE FUNCTION public.validate_customer_identifiers()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.customer_type = 'Business'
     AND (NEW.gst IS NULL OR trim(NEW.gst) = '') THEN
    RAISE EXCEPTION 'GSTIN is mandatory for Business customers';
  END IF;
  IF NEW.customer_type = 'Individual'
     AND (NEW.phone IS NULL OR trim(NEW.phone) = '') THEN
    RAISE EXCEPTION 'Mobile number is mandatory for Individual customers';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_customer_identifiers ON public.customers;
CREATE TRIGGER trg_validate_customer_identifiers
BEFORE INSERT OR UPDATE OF customer_type, gst, phone ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.validate_customer_identifiers();

-- 7. Suggestion service
CREATE OR REPLACE FUNCTION public.search_customers_by_name(search_text text)
RETURNS TABLE (
  id uuid, customer_code text, company text, customer_type text,
  gst text, phone text, city text, score real
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (SELECT btrim(coalesce(search_text, '')) AS q)
  SELECT c.id, c.customer_code, c.company, c.customer_type,
         CASE WHEN c.customer_type = 'Business' THEN c.gst END,
         CASE WHEN c.customer_type = 'Individual' THEN c.phone END,
         c.city,
         similarity(c.company, s.q) AS score
  FROM public.customers c, s
  WHERE length(s.q) >= 3 AND c.company ILIKE '%' || s.q || '%'
  ORDER BY
    (lower(c.company) = lower(s.q)) DESC,
    (lower(c.company) LIKE lower(s.q) || '%') DESC,
    similarity(c.company, s.q) DESC,
    c.company ASC
  LIMIT 10;
$$;

-- 8. Duplicate check service
CREATE OR REPLACE FUNCTION public.check_customer_duplicate(
  p_customer_type text,
  p_gst text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_current_id uuid DEFAULT NULL
)
RETURNS TABLE (
  is_duplicate boolean, existing_customer_id uuid, customer_code text,
  company text, matched_field text, matched_value text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT true, c.id, c.customer_code, c.company,
         CASE WHEN p_customer_type = 'Business' THEN 'gstin' ELSE 'mobile' END,
         CASE WHEN p_customer_type = 'Business' THEN c.gst ELSE c.phone END
  FROM public.customers c
  WHERE c.customer_type = p_customer_type
    AND (p_current_id IS NULL OR c.id <> p_current_id)
    AND (
      (p_customer_type = 'Business'
        AND p_gst IS NOT NULL AND upper(btrim(p_gst)) NOT IN ('', 'URP')
        AND upper(btrim(c.gst)) = upper(btrim(p_gst)))
      OR
      (p_customer_type = 'Individual'
        AND p_phone IS NOT NULL AND btrim(p_phone) <> ''
        AND regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g'))
    )
  ORDER BY c.created_at
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.search_customers_by_name(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_customer_duplicate(text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_customers_by_name(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_customer_duplicate(text, text, text, uuid) TO authenticated, service_role;