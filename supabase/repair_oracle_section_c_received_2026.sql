-- =============================================================================
-- REPAIR TEMPLATE — Section C (received_rows) blanks from settled OEM GRN
-- DRAFT: run ONLY if Wave 0 triage shows C_incomplete > 0.
-- Generalises repair_oracle_41219264_received_rows_2026.sql to every open block
-- whose received_rows has a blank warehouse_id / serial_no / received_date and a
-- settled OEM GRN exists for the same indent_id + oracle_no.
-- Fill-blanks only. Idempotent. User-run.
-- =============================================================================
BEGIN;

DO $$
DECLARE
  rec RECORD;
  v_grn_item jsonb;
  v_wh_id text; v_wh_name text; v_recv_date text; v_serial text; v_model text;
  v_new_rows jsonb;
  v_updated int := 0;
BEGIN
  FOR rec IN
    SELECT i.id AS indent_id, b->>'oracle_no' AS oracle_no, b->'received_rows' AS rrows
    FROM public.indents i, jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
    WHERE i.is_deleted = false
      AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(b->'received_rows','[]'::jsonb)) rr
        WHERE btrim(COALESCE(rr->>'warehouse_id','')) = ''
           OR btrim(COALESCE(rr->>'serial_no','')) !~ '[A-Za-z0-9]'
           OR btrim(COALESCE(rr->>'received_date','')) = ''
      )
      AND EXISTS (
        SELECT 1 FROM public.grns g
        WHERE g.indent_id = i.id
          AND lower(COALESCE(g.status,'')) <> 'cancelled'
          AND COALESCE(g.status,'') IN ('Submitted','Closed')
          AND COALESCE(g.category,'') = 'oem'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
            WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = upper(btrim(COALESCE(b->>'oracle_no','')))
          )
      )
  LOOP
    -- newest settled OEM GRN item for this oracle
    SELECT it INTO v_grn_item
    FROM public.grns g, jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
    WHERE g.indent_id = rec.indent_id
      AND lower(COALESCE(g.status,'')) <> 'cancelled'
      AND COALESCE(g.status,'') IN ('Submitted','Closed')
      AND COALESCE(g.category,'') = 'oem'
      AND upper(btrim(COALESCE(it->>'oracle_no',''))) = upper(btrim(COALESCE(rec.oracle_no,'')))
    ORDER BY g.created_at DESC LIMIT 1;

    IF v_grn_item IS NULL THEN CONTINUE; END IF;
    v_wh_id    := NULLIF(btrim(v_grn_item->>'warehouse_id'),'');
    v_wh_name  := NULLIF(btrim(v_grn_item->>'warehouse_name'),'');
    v_recv_date:= NULLIF(btrim(v_grn_item->>'received_date'),'');
    v_serial   := NULLIF(btrim(v_grn_item->>'serial_no'),'');
    v_model    := NULLIF(btrim(v_grn_item->>'model_no'),'');

    SELECT jsonb_agg(
      CASE WHEN btrim(COALESCE(cr->>'warehouse_id','')) = '' AND v_wh_id IS NOT NULL
           THEN jsonb_set(cr,'{warehouse_id}',to_jsonb(v_wh_id)) ELSE cr END
    ) INTO v_new_rows
    FROM jsonb_array_elements(COALESCE(rec.rrows,'[]'::jsonb)) cr;

    SELECT jsonb_agg(
      CASE WHEN btrim(COALESCE(cr->>'warehouse_name','')) = '' AND v_wh_name IS NOT NULL
           THEN jsonb_set(cr,'{warehouse_name}',to_jsonb(v_wh_name)) ELSE cr END
    ) INTO v_new_rows
    FROM jsonb_array_elements(COALESCE(v_new_rows,'[]'::jsonb)) cr;

    SELECT jsonb_agg(
      CASE WHEN btrim(COALESCE(cr->>'serial_no','')) !~ '[A-Za-z0-9]' AND v_serial IS NOT NULL
           THEN jsonb_set(cr,'{serial_no}',to_jsonb(v_serial)) ELSE cr END
    ) INTO v_new_rows
    FROM jsonb_array_elements(COALESCE(v_new_rows,'[]'::jsonb)) cr;

    SELECT jsonb_agg(
      CASE WHEN btrim(COALESCE(cr->>'model_no','')) = '' AND v_model IS NOT NULL
           THEN jsonb_set(cr,'{model_no}',to_jsonb(v_model)) ELSE cr END
    ) INTO v_new_rows
    FROM jsonb_array_elements(COALESCE(v_new_rows,'[]'::jsonb)) cr;

    SELECT jsonb_agg(
      CASE WHEN btrim(COALESCE(cr->>'received_date','')) = '' AND v_recv_date IS NOT NULL
           THEN jsonb_set(cr,'{received_date}',to_jsonb(v_recv_date)) ELSE cr END
    ) INTO v_new_rows
    FROM jsonb_array_elements(COALESCE(v_new_rows,'[]'::jsonb)) cr;

    UPDATE public.indents
    SET oracles_data = (
      SELECT jsonb_agg(
        CASE WHEN upper(btrim(COALESCE(b->>'oracle_no',''))) = upper(btrim(COALESCE(rec.oracle_no,'')))
              AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
             THEN jsonb_set(b,'{received_rows}',COALESCE(v_new_rows,'[]'::jsonb)) ELSE b END
      ) FROM jsonb_array_elements(COALESCE(oracles_data,'[]'::jsonb)) b
    )
    WHERE id = rec.indent_id;

    v_updated := v_updated + 1;
  END LOOP;
  RAISE NOTICE 'Repaired % oracle block(s) (Section C)', v_updated;
END $$;

COMMIT;

-- VERIFY (expect 0 rows):
SELECT i.id, b->>'oracle_no'
FROM public.indents i, jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
WHERE i.is_deleted = false
  AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(b->'received_rows','[]'::jsonb)) r
    WHERE btrim(COALESCE(r->>'warehouse_id','')) = ''
       OR btrim(COALESCE(r->>'serial_no','')) !~ '[A-Za-z0-9]'
       OR btrim(COALESCE(r->>'received_date','')) = ''
  );
