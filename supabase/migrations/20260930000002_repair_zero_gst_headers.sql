-- 20260930000002_repair_zero_gst_headers.sql
-- Prokon ERP — repair headers that stored GST = 0 while line items carry GST.
-- Root cause: computeTotals never received place_of_supply, so docs for
-- URP / no-state-code buyers resolved "missingState" and zeroed header tax
-- (sales.proforma.new.tsx additionally hardcoded buyerCode = null).
-- The app code fix ships separately; this repairs the 5 known rows
-- (2 sales_orders + 3 proforma_invoices, Sep 2026 audit) plus any identical
-- future rows — invoices included (currently 0 affected).
--
-- AUTHOR ONLY — the harness must never push to Supabase. A human runs this
-- in the Supabase SQL editor. READ STEP 0 FIRST and confirm the row lists
-- match the audit before running step 2.
--
-- Safety:
--   * Only non-cancelled rows whose header cgst+sgst+igst = 0 AND whose
--     stored line items sum to tax > 0 are touched.
--   * Only rows with NO header discount / extras are auto-repaired, proven by
--     the stored header itself: sales_orders/invoices carry no
--     shipping/tcs/adjustment columns, so the guard requires
--     total = taxable_value (no extras baked in); proforma_invoices checks
--     discount/shipping/tcs/adjustment = 0 explicitly.
--     Anything else is listed by the STEP 0 queries for manual review.
--   * Invoices that already carry an IRN are NEVER touched (e-invoice lock).

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 0 — INSPECT (run first, read the output, then continue)
-- ─────────────────────────────────────────────────────────────────────────
--   -- sales orders that would be repaired:
--   SELECT so_no, buyer_state_code, place_of_supply, taxable_value, total, status
--   FROM public.sales_orders
--   WHERE status <> 'cancelled'
--     AND COALESCE(cgst,0) = 0 AND COALESCE(sgst,0) = 0 AND COALESCE(igst,0) = 0
--     AND COALESCE(discount,0) = 0 AND COALESCE(total,0) = COALESCE(taxable_value,0)
--     AND (SELECT COALESCE(SUM(COALESCE((it->>'cgst')::numeric,0)
--          + COALESCE((it->>'sgst')::numeric,0)
--          + COALESCE((it->>'igst')::numeric,0)), 0)
--          FROM jsonb_array_elements(items) AS it) > 0;
--   -- Expected Sep-2026 audit: PHS/SO/26-27/0003, PHS/SO/26-27/0009 (2 rows)
--
--   -- proformas that would be repaired: same query on proforma_invoices
--   -- (status values: draft/issued/cancelled). Expected: 3 rows
--   -- (PHS/PI/26-27/0002, 0004, 0005).
--
--   -- invoices that would be repaired (expected: 0 rows):
--   SELECT invoice_no, buyer_state_code, taxable_value, total, status
--   FROM public.invoices i
--   WHERE status <> 'cancelled' AND irn IS NULL
--     AND COALESCE(cgst,0) = 0 AND COALESCE(sgst,0) = 0 AND COALESCE(igst,0) = 0
--     AND COALESCE(discount,0) = 0 AND COALESCE(total,0) = COALESCE(taxable_value,0)
--     AND (SELECT COALESCE(SUM(COALESCE(cgst,0)+COALESCE(sgst,0)+COALESCE(igst,0)),0)
--          FROM public.invoice_items WHERE invoice_id = i.id) > 0;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 1 — amount-in-words helper (mirrors src/lib/gst.ts amountInWords:
-- "Rupees <Words> [and <Paise> Paise] Only", Indian grouping)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inr_two_words(n int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN $1 <= 0 THEN ''
    WHEN $1 < 20 THEN (ARRAY['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
      'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'])[$1+1]
    ELSE (ARRAY['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'])[$1/10+1]
      || CASE WHEN $1 % 10 > 0
           THEN ' ' || (ARRAY['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine'])[($1%10)+1]
           ELSE '' END
  END;
$$;

CREATE OR REPLACE FUNCTION public.inr_three_words(n int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN $1 <= 0 THEN ''
    WHEN $1 < 100 THEN public.inr_two_words($1)
    ELSE (ARRAY['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine'])[($1/100)+1]
      || ' Hundred'
      || CASE WHEN $1 % 100 > 0 THEN ' ' || public.inr_two_words($1 % 100) ELSE '' END
  END;
$$;

CREATE OR REPLACE FUNCTION public.inr_int_words(n bigint)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN $1 <= 0 THEN ''
    WHEN $1 < 1000 THEN public.inr_three_words($1::int)
    WHEN $1 < 100000 THEN public.inr_two_words(($1/1000)::int) || ' Thousand'
      || CASE WHEN $1 % 1000 > 0 THEN ' ' || public.inr_three_words(($1%1000)::int) ELSE '' END
    WHEN $1 < 10000000 THEN public.inr_int_words($1/100000) || ' Lakh'
      || CASE WHEN $1 % 100000 > 0 THEN ' ' || public.inr_int_words($1 % 100000) ELSE '' END
    ELSE public.inr_int_words($1/10000000) || ' Crore'
      || CASE WHEN $1 % 10000000 > 0 THEN ' ' || public.inr_int_words($1 % 10000000) ELSE '' END
  END;
$$;

CREATE OR REPLACE FUNCTION public.inr_in_words(p_amount numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  rupees bigint;
  paise int;
  out text;
BEGIN
  IF p_amount IS NULL THEN RETURN NULL; END IF;
  rupees := floor(abs(p_amount))::bigint;
  paise := round((abs(p_amount) - rupees) * 100)::int;
  IF paise = 100 THEN rupees := rupees + 1; paise := 0; END IF;
  IF rupees = 0 AND paise = 0 THEN RETURN 'Rupees Zero Only'; END IF;
  out := 'Rupees ' || CASE WHEN rupees = 0 THEN 'Zero' ELSE public.inr_int_words(rupees) END;
  IF paise > 0 THEN out := out || ' and ' || public.inr_two_words(paise) || ' Paise'; END IF;
  out := out || ' Only';
  IF p_amount < 0 THEN out := 'Minus ' || out; END IF;
  RETURN out;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 2 — repair sales_orders
-- ─────────────────────────────────────────────────────────────────────────
UPDATE public.sales_orders so
SET taxable_value = agg.taxable,
    cgst          = agg.cgst,
    sgst          = agg.sgst,
    igst          = agg.igst,
    cess          = agg.cess,
    round_off     = agg.round_off,
    total         = agg.total,
    total_in_words = public.inr_in_words(agg.total),
    is_interstate = agg.igst > 0,
    updated_at    = now()
FROM (
  SELECT id,
         SUM(COALESCE((it->>'taxable_value')::numeric, 0)) AS taxable,
         SUM(COALESCE((it->>'cgst')::numeric, 0))          AS cgst,
         SUM(COALESCE((it->>'sgst')::numeric, 0))          AS sgst,
         SUM(COALESCE((it->>'igst')::numeric, 0))          AS igst,
         SUM(COALESCE((it->>'cess')::numeric, 0))          AS cess
  FROM public.sales_orders, jsonb_array_elements(items) AS it
  WHERE status <> 'cancelled'
    AND COALESCE(cgst, 0) = 0 AND COALESCE(sgst, 0) = 0 AND COALESCE(igst, 0) = 0
    AND COALESCE(discount, 0) = 0 AND COALESCE(total, 0) = COALESCE(taxable_value, 0)
  GROUP BY id
) s
JOIN LATERAL (
  SELECT s.taxable, s.cgst, s.sgst, s.igst, s.cess,
         round(s.taxable + s.cgst + s.sgst + s.igst + s.cess)
           - (s.taxable + s.cgst + s.sgst + s.igst + s.cess) AS round_off,
         round(s.taxable + s.cgst + s.sgst + s.igst + s.cess) AS total
) agg ON true
WHERE so.id = s.id
  AND (s.cgst + s.sgst + s.igst) > 0;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 3 — repair proforma_invoices
-- ─────────────────────────────────────────────────────────────────────────
UPDATE public.proforma_invoices pi
SET taxable_value = agg.taxable,
    cgst          = agg.cgst,
    sgst          = agg.sgst,
    igst          = agg.igst,
    cess          = agg.cess,
    round_off     = agg.round_off,
    total         = agg.total,
    total_in_words = public.inr_in_words(agg.total),
    is_interstate = agg.igst > 0,
    updated_at    = now()
FROM (
  SELECT id,
         SUM(COALESCE((it->>'taxable_value')::numeric, 0)) AS taxable,
         SUM(COALESCE((it->>'cgst')::numeric, 0))          AS cgst,
         SUM(COALESCE((it->>'sgst')::numeric, 0))          AS sgst,
         SUM(COALESCE((it->>'igst')::numeric, 0))          AS igst,
         SUM(COALESCE((it->>'cess')::numeric, 0))          AS cess
  FROM public.proforma_invoices, jsonb_array_elements(items) AS it
  WHERE status <> 'cancelled'
    AND COALESCE(cgst, 0) = 0 AND COALESCE(sgst, 0) = 0 AND COALESCE(igst, 0) = 0
    AND COALESCE(discount, 0) = 0 AND COALESCE(shipping_charges, 0) = 0
    AND COALESCE(tcs_amount, 0) = 0 AND COALESCE(adjustment, 0) = 0
  GROUP BY id
) s
JOIN LATERAL (
  SELECT s.taxable, s.cgst, s.sgst, s.igst, s.cess,
         round(s.taxable + s.cgst + s.sgst + s.igst + s.cess)
           - (s.taxable + s.cgst + s.sgst + s.igst + s.cess) AS round_off,
         round(s.taxable + s.cgst + s.sgst + s.igst + s.cess) AS total
) agg ON true
WHERE pi.id = s.id
  AND (s.cgst + s.sgst + s.igst) > 0;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 4 — repair invoices (from invoice_items; expected 0 rows Sep-2026)
-- ─────────────────────────────────────────────────────────────────────────
UPDATE public.invoices i
SET taxable_value = agg.taxable,
    cgst          = agg.cgst,
    sgst          = agg.sgst,
    igst          = agg.igst,
    cess          = agg.cess,
    round_off     = agg.round_off,
    total         = agg.total,
    total_in_words = public.inr_in_words(agg.total),
    is_interstate = agg.igst > 0,
    updated_at    = now()
FROM (
  SELECT i2.id,
         SUM(COALESCE(li.taxable_value, 0)) AS taxable,
         SUM(COALESCE(li.cgst, 0))          AS cgst,
         SUM(COALESCE(li.sgst, 0))          AS sgst,
         SUM(COALESCE(li.igst, 0))          AS igst,
         SUM(COALESCE(li.cess, 0))          AS cess
  FROM public.invoices i2
  JOIN public.invoice_items li ON li.invoice_id = i2.id
  WHERE i2.status <> 'cancelled' AND i2.irn IS NULL
    AND COALESCE(i2.cgst, 0) = 0 AND COALESCE(i2.sgst, 0) = 0 AND COALESCE(i2.igst, 0) = 0
    AND COALESCE(i2.discount, 0) = 0 AND COALESCE(i2.total, 0) = COALESCE(i2.taxable_value, 0)
  GROUP BY i2.id
) s
JOIN LATERAL (
  SELECT s.taxable, s.cgst, s.sgst, s.igst, s.cess,
         round(s.taxable + s.cgst + s.sgst + s.igst + s.cess)
           - (s.taxable + s.cgst + s.sgst + s.igst + s.cess) AS round_off,
         round(s.taxable + s.cgst + s.sgst + s.igst + s.cess) AS total
) agg ON true
WHERE i.id = s.id
  AND (s.cgst + s.sgst + s.igst) > 0;

-- ─────────────────────────────────────────────────────────────────────────
-- STEP 5 — VERIFY
--   5a) repairable rows remaining — expect 0 in every table.
--   5b) rows SKIPPED on purpose (zero GST but header extras, so
--       header_total = round(taxable + tax) is not provable). Review these
--       by hand and set cgst/sgst/igst/total explicitly if they are wrong.
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT 'sales_orders' AS tbl, count(*) FROM public.sales_orders
-- WHERE status <> 'cancelled' AND COALESCE(cgst,0)=0 AND COALESCE(sgst,0)=0 AND COALESCE(igst,0)=0
--   AND COALESCE(discount,0)=0 AND COALESCE(total,0)=COALESCE(taxable_value,0)
--   AND (SELECT COALESCE(SUM(COALESCE((it->>'cgst')::numeric,0)+COALESCE((it->>'sgst')::numeric,0)+COALESCE((it->>'igst')::numeric,0)),0)
--        FROM jsonb_array_elements(items) AS it) > 0
-- UNION ALL
-- SELECT 'proforma_invoices', count(*) FROM public.proforma_invoices
-- WHERE status <> 'cancelled' AND COALESCE(cgst,0)=0 AND COALESCE(sgst,0)=0 AND COALESCE(igst,0)=0
--   AND COALESCE(discount,0)=0 AND COALESCE(shipping_charges,0)=0
--   AND COALESCE(tcs_amount,0)=0 AND COALESCE(adjustment,0)=0
--   AND (SELECT COALESCE(SUM(COALESCE((it->>'cgst')::numeric,0)+COALESCE((it->>'sgst')::numeric,0)+COALESCE((it->>'igst')::numeric,0)),0)
--        FROM jsonb_array_elements(items) AS it) > 0
-- UNION ALL
-- SELECT 'invoices', count(*) FROM public.invoices i
-- WHERE status <> 'cancelled' AND irn IS NULL
--   AND COALESCE(cgst,0)=0 AND COALESCE(sgst,0)=0 AND COALESCE(igst,0)=0
--   AND COALESCE(discount,0)=0 AND COALESCE(total,0)=COALESCE(taxable_value,0)
--   AND (SELECT COALESCE(SUM(COALESCE(cgst,0)+COALESCE(sgst,0)+COALESCE(igst,0)),0)
--        FROM public.invoice_items WHERE invoice_id = i.id) > 0;
--
-- -- 5b) manual-review list (expected empty unless a real bug exists):
-- SELECT invoice_no, taxable_value, total, (total - taxable_value) AS header_extras
-- FROM public.invoices i
-- WHERE status <> 'cancelled' AND irn IS NULL
--   AND COALESCE(cgst,0)=0 AND COALESCE(sgst,0)=0 AND COALESCE(igst,0)=0
--   AND COALESCE(total,0) <> COALESCE(taxable_value,0)
--   AND (SELECT COALESCE(SUM(COALESCE(cgst,0)+COALESCE(sgst,0)+COALESCE(igst,0)),0)
--        FROM public.invoice_items WHERE invoice_id = i.id) > 0;
