-- =============================================================================
-- REPAIR: Stuck Oracle Blocks — Backfill customer_received_rows from settled GRNs
-- =============================================================================
-- PURPOSE:
--   Open oracle blocks whose customer_received_rows[] lack warehouse_id or
--   received_date remain stuck (incomplete) even though a settled customer
--   GRN exists for the same indent + oracle. This repair backfills those
--   blank fields from the matching GRN item, allowing
--   trg_indents_autoclose_oracles to auto-close the repaired blocks.
--
-- SCOPE:
--   - Only OPEN blocks (status NOT IN ('closed', 'force_closed'))
--   - Only blocks with blank warehouse_id or received_date in customer_received_rows
--   - Only when a settled (Submitted/Closed, non-cancelled) customer-category
--     GRN exists for the same indent_id + upper(items.oracle_no)
--   - Matching GRN item: same indent_id, upper(items.oracle_no) match,
--     prefer same serial_no as the block's first customer_received_row
--
-- IDEMPOTENT:
--   Re-running after repair is a no-op — the audit SELECT returns no rows
--   because all blank fields have been backfilled.
--
-- ROLLBACK:
--   No destructive down. To verify repair, re-run the AUDIT SELECT (STEP 1).
--   If rows still appear, re-run the UPDATE (STEP 2).
--
-- RUN INSTRUCTIONS:
--   1. Run STEP 1 (AUDIT) to see which blocks will be repaired.
--   2. Run STEP 2 (UPDATE) to perform the backfill.
--   3. Run STEP 3 (VERIFY) to confirm no rows remain.
--   4. If verification fails, investigate before re-running.
--
-- NOTE:
--   Updating indents.oracles_data re-fires trg_indents_autoclose_oracles,
--   so repaired blocks will auto-close if they meet all completion criteria.
--   If the GRN item's warehouse_id or received_date is also blank, the
--   backfill is skipped for that field (no useful source data).
-- =============================================================================

-- STEP 1: AUDIT — List open blocks with blank fields that have matching settled GRNs
-- (READ-ONLY — safe to run anytime)
SELECT
  i.id AS indent_id,
  b->>'oracle_no' AS oracle_no,
  COALESCE(b->>'status', 'open') AS block_status,
  jsonb_array_length(COALESCE(b->'customer_received_rows', '[]'::jsonb)) AS num_crows,
  (
    SELECT count(*)
    FROM jsonb_array_elements(COALESCE(b->'customer_received_rows', '[]'::jsonb)) cr
    WHERE public._oracle_row_str(cr, 'warehouse_id') = ''
       OR public._oracle_row_str(cr, 'received_date') = ''
  ) AS num_blank_fields,
  g.id AS matching_grn_id,
  g.grn_no AS matching_grn_no,
  g.status AS matching_grn_status,
  it->>'warehouse_id' AS grn_warehouse_id,
  it->>'received_date' AS grn_received_date
FROM public.indents i,
jsonb_array_elements(COALESCE(i.oracles_data, '[]'::jsonb)) b
CROSS JOIN LATERAL (
  SELECT g.id, g.grn_no, g.status, it
  FROM public.grns g,
  jsonb_array_elements(COALESCE(g.items, '[]'::jsonb)) it
  WHERE g.indent_id = i.id
    AND lower(COALESCE(g.status, '')) <> 'cancelled'
    AND COALESCE(g.status, '') IN ('Submitted', 'Closed')
    AND COALESCE(g.category, '') = 'customer'
    AND upper(btrim(COALESCE(it->>'oracle_no', ''))) = upper(btrim(COALESCE(b->>'oracle_no', '')))
  ORDER BY
    CASE WHEN btrim(COALESCE(it->>'serial_no', '')) = btrim(COALESCE(b->'customer_received_rows'->0->>'serial_no', '')) THEN 0 ELSE 1 END,
    g.created_at DESC
  LIMIT 1
) g
WHERE COALESCE(b->>'status', 'open') NOT IN ('closed', 'force_closed')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(b->'customer_received_rows', '[]'::jsonb)) cr
    WHERE public._oracle_row_str(cr, 'warehouse_id') = ''
       OR public._oracle_row_str(cr, 'received_date') = ''
  );

-- STEP 2: UPDATE — Backfill blank fields from matching GRN item
-- (IDEMPOTENT — re-running is a no-op once fields are filled)
DO $$
DECLARE
  r RECORD;
  v_grn_item jsonb;
  v_wh_id text;
  v_recv_date text;
  v_prod_tag text;
  v_new_crows jsonb;
  v_updated_count int := 0;
BEGIN
  FOR r IN
    SELECT
      i.id AS indent_id,
      b->>'oracle_no' AS oracle_no,
      b->'customer_received_rows' AS crows
    FROM public.indents i,
    jsonb_array_elements(COALESCE(i.oracles_data, '[]'::jsonb)) b
    WHERE COALESCE(b->>'status', 'open') NOT IN ('closed', 'force_closed')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(b->'customer_received_rows', '[]'::jsonb)) cr
        WHERE public._oracle_row_str(cr, 'warehouse_id') = ''
           OR public._oracle_row_str(cr, 'received_date') = ''
      )
      AND EXISTS (
        SELECT 1 FROM public.grns g
        WHERE g.indent_id = i.id
          AND lower(COALESCE(g.status, '')) <> 'cancelled'
          AND COALESCE(g.status, '') IN ('Submitted', 'Closed')
          AND COALESCE(g.category, '') = 'customer'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(g.items, '[]'::jsonb)) it
            WHERE upper(btrim(COALESCE(it->>'oracle_no', ''))) = upper(btrim(COALESCE(b->>'oracle_no', '')))
          )
      )
  LOOP
    -- Find best matching GRN item (prefer same serial_no as first crow)
    SELECT it INTO v_grn_item
    FROM public.grns g,
    jsonb_array_elements(COALESCE(g.items, '[]'::jsonb)) it
    WHERE g.indent_id = r.indent_id
      AND lower(COALESCE(g.status, '')) <> 'cancelled'
      AND COALESCE(g.status, '') IN ('Submitted', 'Closed')
      AND COALESCE(g.category, '') = 'customer'
      AND upper(btrim(COALESCE(it->>'oracle_no', ''))) = upper(btrim(COALESCE(r.oracle_no, '')))
    ORDER BY
      CASE WHEN btrim(COALESCE(it->>'serial_no', '')) = btrim(COALESCE(r.crows->0->>'serial_no', '')) THEN 0 ELSE 1 END,
      g.created_at DESC
    LIMIT 1;

    IF v_grn_item IS NULL THEN CONTINUE; END IF;

    v_wh_id := NULLIF(btrim(v_grn_item->>'warehouse_id'), '');
    v_recv_date := NULLIF(btrim(v_grn_item->>'received_date'), '');
    v_prod_tag := COALESCE(NULLIF(btrim(v_grn_item->>'product_tag'), ''), 'defective');

    -- Rebuild customer_received_rows with backfilled values
    SELECT jsonb_agg(
      CASE
        WHEN public._oracle_row_str(cr, 'warehouse_id') = '' AND v_wh_id IS NOT NULL
        THEN jsonb_set(cr, '{warehouse_id}', to_jsonb(v_wh_id))
        ELSE cr
      END
    ) INTO v_new_crows
    FROM jsonb_array_elements(COALESCE(r.crows, '[]'::jsonb)) cr;

    SELECT jsonb_agg(
      CASE
        WHEN public._oracle_row_str(cr, 'received_date') = '' AND v_recv_date IS NOT NULL
        THEN jsonb_set(cr, '{received_date}', to_jsonb(v_recv_date))
        ELSE cr
      END
    ) INTO v_new_crows
    FROM jsonb_array_elements(COALESCE(v_new_crows, '[]'::jsonb)) cr;

    SELECT jsonb_agg(
      CASE
        WHEN public._oracle_row_str(cr, 'product_tag') = ''
        THEN jsonb_set(cr, '{product_tag}', to_jsonb(v_prod_tag))
        ELSE cr
      END
    ) INTO v_new_crows
    FROM jsonb_array_elements(COALESCE(v_new_crows, '[]'::jsonb)) cr;

    -- Update the block within oracles_data
    UPDATE public.indents
    SET oracles_data = (
      SELECT jsonb_agg(
        CASE
          WHEN b->>'oracle_no' = r.oracle_no
          THEN jsonb_set(b, '{customer_received_rows}', COALESCE(v_new_crows, '[]'::jsonb))
          ELSE b
        END
      )
      FROM jsonb_array_elements(COALESCE(oracles_data, '[]'::jsonb)) b
    )
    WHERE id = r.indent_id;

    v_updated_count := v_updated_count + 1;
  END LOOP;

  RAISE NOTICE 'Repaired % oracle block(s)', v_updated_count;
END $$;

-- STEP 3: VERIFY — Confirm no open blocks with blank fields remain
-- (READ-ONLY — should return 0 rows after successful repair)
SELECT
  i.id AS indent_id,
  b->>'oracle_no' AS oracle_no,
  COALESCE(b->>'status', 'open') AS block_status
FROM public.indents i,
jsonb_array_elements(COALESCE(i.oracles_data, '[]'::jsonb)) b
WHERE COALESCE(b->>'status', 'open') NOT IN ('closed', 'force_closed')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(b->'customer_received_rows', '[]'::jsonb)) cr
    WHERE public._oracle_row_str(cr, 'warehouse_id') = ''
       OR public._oracle_row_str(cr, 'received_date') = ''
  )
  AND EXISTS (
    SELECT 1 FROM public.grns g
    WHERE g.indent_id = i.id
      AND lower(COALESCE(g.status, '')) <> 'cancelled'
      AND COALESCE(g.status, '') IN ('Submitted', 'Closed')
      AND COALESCE(g.category, '') = 'customer'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(g.items, '[]'::jsonb)) it
        WHERE upper(btrim(COALESCE(it->>'oracle_no', ''))) = upper(btrim(COALESCE(b->>'oracle_no', '')))
      )
  );
