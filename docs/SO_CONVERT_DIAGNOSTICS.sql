-- ══════════════════════════════════════════════════════════════════════
-- SO Conversion Diagnostics — paste into Supabase SQL Editor
-- Replace the so_id value below, then run all statements.
-- ══════════════════════════════════════════════════════════════════════

\set so_id '713de69c-134f-433c-b48b-a137532cb70e'

-- ─── 1. SO row: status, items count + first-item sanity, branch, buyer ───
-- HEALTHY: status = draft or confirmed, items array non-empty.
SELECT id, so_no, status, branch_id, buyer_name,
       jsonb_array_length(COALESCE(items,'[]'::jsonb)) AS item_count,
       items->0 AS first_item
FROM public.sales_orders
WHERE id = :'so_id';

-- ─── 2. so_conversions for this SO: every row with type/status/target ────
-- HEALTHY (fresh convert): zero rows where status != 'cancelled'
--   AND conversion_type IN ('tax_invoice','general_dc','delivery_challan').
--   Stale active conversions block new stock-consuming conversions.
SELECT c.id, c.conversion_type, c.status, c.target_table, c.target_id,
       c.target_no, c.created_at
FROM public.so_conversions c
WHERE c.sales_order_id = :'so_id'
ORDER BY c.created_at;

-- ─── 3. so_fulfillment_summary: per-line ordered / fulfilled / balance ────
-- HEALTHY: balance > 0 on at least one line (stock remains to fulfill).
SELECT line_index, product_id, ordered_qty, fulfilled_stock,
       fulfilled_proforma, balance, is_complete
FROM public.so_fulfillment_summary
WHERE sales_order_id = :'so_id'
ORDER BY line_index;

-- ─── 4. Cancelled-vs-active doc references ────────────────────────────────
-- HEALTHY: no rows. A cancelled doc whose so_conversion was NOT synced
--   back to cancelled still holds a phantom stock claim.
-- Check all four target tables:
SELECT 'invoices' AS tbl, id, invoice_no, status
  FROM public.invoices  WHERE sales_order_id = :'so_id'
UNION ALL
SELECT 'general_delivery_challans', id, dc_no, status
  FROM public.general_delivery_challans WHERE sales_order_id = :'so_id'
UNION ALL
SELECT 'delivery_challans', id, challan_no, status
  FROM public.delivery_challans WHERE sales_order_id = :'so_id'
UNION ALL
SELECT 'proforma_invoices', id, proforma_no, status
  FROM public.proforma_invoices WHERE sales_order_id = :'so_id'
ORDER BY tbl, status;

-- ─── 5. RLS / app-user check (manual — cannot probe from SQL Editor) ────
-- Run in the browser console while logged in as the user who hit the error:
--   const { data, error } = await supabase
--     .from('sales_orders').select('*').eq('id','<so_id>').single();
-- If `error` is non-null, RLS is blocking the read — check policy grants
-- for the user's role on sales_orders, so_conversions, and so_fulfillments.
