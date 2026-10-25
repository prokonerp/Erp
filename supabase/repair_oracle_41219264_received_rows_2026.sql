-- =============================================================================
-- REPAIR: Oracle 41219264 — backfill received_rows (Section C) from settled OEM GRN
-- =============================================================================
-- PURPOSE:
--   Backfill blank warehouse_id / warehouse_name / received_date in the
--   received_rows[] of an open oracle block from the matching settled OEM GRN
--   item, so trg_indents_autoclose_oracles can auto-close the block.
--
-- SCOPE:
--   - Only the indent whose oracles_data contains oracle_no = '41219264'
--   - Only OPEN blocks (status NOT IN ('closed','force_closed'))
--   - Only when a settled (Submitted/Closed, non-cancelled) OEM-category GRN
--     exists for the same indent_id + upper(items.oracle_no)
--   - Never overwrites non-blank values; never touches serial_no
--
-- RUN INSTRUCTIONS:
--   1. Run STEP 1 (AUDIT) — confirm the indent + GRN exist and fields are blank.
--   2. Run STEP 2 (UPDATE) — single transaction, idempotent.
--   3. Run STEP 3 (VERIFY) — expect 0 rows.
-- =============================================================================

-- STEP 1: AUDIT (read-only)
SELECT i.id AS indent_id, i.indent_no, b->>'oracle_no' AS oracle_no,
       COALESCE(b->>'status','open') AS block_status,
       (SELECT count(*) FROM jsonb_array_elements(COALESCE(b->'received_rows','[]'::jsonb)) rr
         WHERE public._oracle_row_str(rr,'warehouse_id')='' OR public._oracle_row_str(rr,'received_date')='') AS blank_fields,
       g.id AS grn_id, g.grn_no, g.status AS grn_status
FROM public.indents i
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
LEFT JOIN LATERAL (
  SELECT g.id,g.grn_no,g.status FROM public.grns g
  WHERE g.indent_id=i.id AND lower(COALESCE(g.status,''))<>'cancelled'
    AND COALESCE(g.status,'') IN ('Submitted','Closed') AND COALESCE(g.category,'')='oem'
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
                WHERE upper(btrim(COALESCE(it->>'oracle_no','')))=upper(btrim(COALESCE(b->>'oracle_no',''))))
  ORDER BY g.created_at DESC LIMIT 1
) g ON true
WHERE upper(btrim(COALESCE(b->>'oracle_no','')))=upper('41219264');

-- STEP 2: UPDATE (single transaction)
BEGIN;

DO $$
DECLARE
  rec RECORD;
  v_grn_item jsonb;
  v_wh_id text; v_wh_name text; v_recv_date text;
  v_new_rows jsonb;
  v_updated int := 0;
BEGIN
  FOR rec IN
    SELECT i.id AS indent_id, b->>'oracle_no' AS oracle_no, b->'received_rows' AS rrows
    FROM public.indents i, jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
    WHERE upper(btrim(COALESCE(b->>'oracle_no','')))=upper('41219264')
      AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(b->'received_rows','[]'::jsonb)) rr
                  WHERE public._oracle_row_str(rr,'warehouse_id')='' OR public._oracle_row_str(rr,'received_date')='')
      AND EXISTS (SELECT 1 FROM public.grns g WHERE g.indent_id=i.id
                  AND lower(COALESCE(g.status,''))<>'cancelled'
                  AND COALESCE(g.status,'') IN ('Submitted','Closed') AND COALESCE(g.category,'')='oem'
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
                              WHERE upper(btrim(COALESCE(it->>'oracle_no','')))=upper('41219264')))
  LOOP
    SELECT it INTO v_grn_item
    FROM public.grns g, jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
    WHERE g.indent_id=rec.indent_id AND lower(COALESCE(g.status,''))<>'cancelled'
      AND COALESCE(g.status,'') IN ('Submitted','Closed') AND COALESCE(g.category,'')='oem'
      AND upper(btrim(COALESCE(it->>'oracle_no','')))=upper('41219264')
    ORDER BY g.created_at DESC LIMIT 1;

    IF v_grn_item IS NULL THEN CONTINUE; END IF;
    v_wh_id := NULLIF(btrim(v_grn_item->>'warehouse_id'),'');
    v_wh_name := NULLIF(btrim(v_grn_item->>'warehouse_name'),'');
    v_recv_date := NULLIF(btrim(v_grn_item->>'received_date'),'');

    SELECT jsonb_agg(
      CASE WHEN public._oracle_row_str(cr,'warehouse_id')='' AND v_wh_id IS NOT NULL
           THEN jsonb_set(cr,'{warehouse_id}',to_jsonb(v_wh_id)) ELSE cr END
    ) INTO v_new_rows
    FROM jsonb_array_elements(COALESCE(rec.rrows,'[]'::jsonb)) cr;

    SELECT jsonb_agg(
      CASE WHEN public._oracle_row_str(cr,'warehouse_name')='' AND v_wh_name IS NOT NULL
           THEN jsonb_set(cr,'{warehouse_name}',to_jsonb(v_wh_name)) ELSE cr END
    ) INTO v_new_rows
    FROM jsonb_array_elements(COALESCE(v_new_rows,'[]'::jsonb)) cr;

    SELECT jsonb_agg(
      CASE WHEN public._oracle_row_str(cr,'received_date')='' AND v_recv_date IS NOT NULL
           THEN jsonb_set(cr,'{received_date}',to_jsonb(v_recv_date)) ELSE cr END
    ) INTO v_new_rows
    FROM jsonb_array_elements(COALESCE(v_new_rows,'[]'::jsonb)) cr;

    UPDATE public.indents
    SET oracles_data = (
      SELECT jsonb_agg(
        CASE WHEN upper(btrim(COALESCE(b->>'oracle_no','')))=upper('41219264')
              AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
             THEN jsonb_set(b,'{received_rows}',COALESCE(v_new_rows,'[]'::jsonb)) ELSE b END
      ) FROM jsonb_array_elements(COALESCE(oracles_data,'[]'::jsonb)) b
    )
    WHERE id = rec.indent_id;

    v_updated := v_updated + 1;
  END LOOP;
  RAISE NOTICE 'Repaired % oracle block(s) for 41219264', v_updated;
END $$;

COMMIT;

-- STEP 3: VERIFY (read-only) — expect 0 rows
SELECT i.id, b->>'oracle_no'
FROM public.indents i, jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
WHERE upper(btrim(COALESCE(b->>'oracle_no','')))=upper('41219264')
  AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(b->'received_rows','[]'::jsonb)) rr
              WHERE public._oracle_row_str(rr,'warehouse_id')='' OR public._oracle_row_str(rr,'received_date')='');
