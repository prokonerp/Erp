-- Migration: 20260910000003_so_fulfillment_view.sql
-- Sales Order split-delivery — fulfillment summary VIEW + derived status helper
-- Part of: SO Conversion V2 (§5.3)
-- SAFE: CREATE OR REPLACE VIEW / FUNCTION — idempotent, no data loss
-- Depends on: sales_orders (items jsonb), so_conversions, so_fulfillments

-- ═══════════════════════════════════════════════════════════════════
-- 1) so_fulfillment_summary VIEW
--    - ordered: jsonb_array_elements(sales_orders.items) WITH ORDINALITY
--    - fulfilled: SUM(so_fulfillments.this_qty) WHERE conversion_type IN (tax_invoice,general_dc,delivery_challan) AND status != 'cancelled'
--    - fulfilled_proforma: same but conversion_type = proforma_invoice (display-only, NOT counted in balance)
--    - balance = GREATEST(0, ordered - fulfilled_stock)
--    - is_complete = (balance <= 0)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.so_fulfillment_summary AS
WITH ordered AS (
  SELECT so.id AS sales_order_id,
         (idx - 1) AS line_index,
         (elem ->> 'product_id')::uuid AS product_id,
         COALESCE((elem ->> 'qty')::numeric, 0) AS ordered_qty
  FROM public.sales_orders so,
       jsonb_array_elements(COALESCE(so.items, '[]'::jsonb)) WITH ORDINALITY AS t(elem, idx)
),
fulfilled AS (
  SELECT f.sales_order_id,
         f.line_index,
         SUM(f.this_qty) AS fulfilled_stock
  FROM public.so_fulfillments f
  JOIN public.so_conversions c ON c.id = f.conversion_id
  WHERE c.conversion_type IN ('tax_invoice','general_dc','delivery_challan')
    AND c.status != 'cancelled'
  GROUP BY 1, 2
),
fulfilled_proforma AS (
  SELECT f.sales_order_id,
         f.line_index,
         SUM(f.this_qty) AS fulfilled_proforma
  FROM public.so_fulfillments f
  JOIN public.so_conversions c ON c.id = f.conversion_id
  WHERE c.conversion_type = 'proforma_invoice'
    AND c.status != 'cancelled'
  GROUP BY 1, 2
)
SELECT o.sales_order_id,
       o.line_index,
       o.product_id,
       o.ordered_qty,
       COALESCE(f.fulfilled_stock, 0) AS fulfilled_stock,
       COALESCE(fp.fulfilled_proforma, 0) AS fulfilled_proforma,
       GREATEST(0, o.ordered_qty - COALESCE(f.fulfilled_stock, 0)) AS balance,
       (o.ordered_qty - COALESCE(f.fulfilled_stock, 0) <= 0) AS is_complete
FROM ordered o
LEFT JOIN fulfilled f USING (sales_order_id, line_index)
LEFT JOIN fulfilled_proforma fp USING (sales_order_id, line_index);

-- Grant read to authenticated + service_role (views inherit table RLS but need explicit grant)
GRANT SELECT ON public.so_fulfillment_summary TO authenticated;
GRANT SELECT ON public.so_fulfillment_summary TO service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 2) so_derived_status helper — derives SO status from ledger
--    Rules (mirrors plan §2.3):
--    - cancelled stays cancelled
--    - no non-cancelled stock-affecting conversions => keep current status (draft/confirmed as-is)
--    - all lines is_complete => invoiced if any tax_invoice exists else delivered
--    - otherwise => partial
--    STABLE, single-arg, returns text
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.so_derived_status(p_so_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN (SELECT status FROM public.sales_orders WHERE id = p_so_id) = 'cancelled' THEN 'cancelled'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.so_conversions
      WHERE sales_order_id = p_so_id
        AND status != 'cancelled'
        AND conversion_type IN ('tax_invoice','general_dc','delivery_challan')
    ) THEN
      (SELECT status FROM public.sales_orders WHERE id = p_so_id)
    WHEN (SELECT bool_and(is_complete) FROM public.so_fulfillment_summary WHERE sales_order_id = p_so_id) THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM public.so_conversions
        WHERE sales_order_id = p_so_id
          AND conversion_type = 'tax_invoice'
          AND status != 'cancelled'
      ) THEN 'invoiced' ELSE 'delivered' END
    ELSE 'partial'
  END;
$$;

GRANT EXECUTE ON FUNCTION public.so_derived_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.so_derived_status(uuid) TO service_role;
