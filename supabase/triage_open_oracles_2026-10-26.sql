-- =============================================================================
-- TRIAGE: Open oracle blocks — which section blocks auto-close?
-- READ-ONLY. Run all three steps in order.
-- =============================================================================

-- STEP 0: PREFLIGHT — confirm function signatures before relying on them.
-- (Run these; do NOT guess. indent_type is an ENUM, so cast ::text.)
SELECT n.nspname AS schema, p.proname AS fn, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('_oracle_block_complete','oracles_autoclose','oracle_docs_pending','oracle_docs_satisfied')
ORDER BY p.proname;

-- STEP 1: TRIAGE — one row per open block on a non-deleted indent.
-- Replicates _oracle_block_complete rules in pure SQL so no signature guess is needed.
WITH open_blocks AS (
  SELECT
    i.id AS indent_id,
    i.indent_no,
    i.indent_type::text AS indent_type,
    COALESCE(b->>'oracle_no','') AS oracle_no,
    COALESCE(b->>'status','open') AS block_status,
    COALESCE(b->'defective_rows','[]'::jsonb) AS defective_rows,
    COALESCE(b->'exchange_rows','[]'::jsonb) AS exchange_rows,
    COALESCE(b->'received_rows','[]'::jsonb) AS received_rows,
    COALESCE(b->'customer_received_rows','[]'::jsonb) AS customer_received_rows
  FROM public.indents i
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
  WHERE i.is_deleted = false
    AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
),
section_flags AS (
  SELECT
    ob.*,
    -- Section A: every defective row has model + identifying serial + qty>0; at least one row
    (jsonb_array_length(ob.defective_rows) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(ob.defective_rows) r
        WHERE btrim(COALESCE(r->>'def_model_no','')) = ''
           OR btrim(COALESCE(r->>'def_serial_no','')) !~ '[A-Za-z0-9]'
           OR btrim(COALESCE(r->>'qty','')) !~ '^[0-9]+(\\.[0-9]+)?$' OR COALESCE(NULLIF(btrim(r->>'qty'),'')::numeric, 0) <= 0
      )) AS a_complete,
    -- Section B: every exchange row has warehouse + model + identifying serial + qty>0
    (jsonb_array_length(ob.exchange_rows) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(ob.exchange_rows) r
        WHERE btrim(COALESCE(r->>'warehouse_id','')) = ''
           OR btrim(COALESCE(r->>'model_no','')) = ''
           OR btrim(COALESCE(r->>'serial_no','')) !~ '[A-Za-z0-9]'
           OR btrim(COALESCE(r->>'qty','')) !~ '^[0-9]+(\\.[0-9]+)?$' OR COALESCE(NULLIF(btrim(r->>'qty'),'')::numeric, 0) <= 0
      )) AS b_complete,
    -- Section C: every received row has warehouse + model + identifying serial + qty>0 + received_date
    (jsonb_array_length(ob.received_rows) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(ob.received_rows) r
        WHERE btrim(COALESCE(r->>'warehouse_id','')) = ''
           OR btrim(COALESCE(r->>'model_no','')) = ''
           OR btrim(COALESCE(r->>'serial_no','')) !~ '[A-Za-z0-9]'
           OR btrim(COALESCE(r->>'qty','')) !~ '^[0-9]+(\\.[0-9]+)?$' OR COALESCE(NULLIF(btrim(r->>'qty'),'')::numeric, 0) <= 0
           OR btrim(COALESCE(r->>'received_date','')) = ''
      )) AS c_complete,
    -- custTouched: any customer row has warehouse/serial/received_date
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(ob.customer_received_rows) c
      WHERE btrim(COALESCE(c->>'warehouse_id','')) <> ''
         OR btrim(COALESCE(c->>'serial_no','')) <> ''
         OR btrim(COALESCE(c->>'received_date','')) <> ''
    ) AS cust_touched,
    -- Section D: every customer row has warehouse + model + identifying serial + qty>0 + received_date + product_tag
    (jsonb_array_length(ob.customer_received_rows) > 0
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(ob.customer_received_rows) r
        WHERE btrim(COALESCE(r->>'warehouse_id','')) = ''
           OR btrim(COALESCE(r->>'model_no','')) = ''
           OR btrim(COALESCE(r->>'serial_no','')) !~ '[A-Za-z0-9]'
           OR btrim(COALESCE(r->>'qty','')) !~ '^[0-9]+(\\.[0-9]+)?$' OR COALESCE(NULLIF(btrim(r->>'qty'),'')::numeric, 0) <= 0
           OR btrim(COALESCE(r->>'received_date','')) = ''
           OR btrim(COALESCE(r->>'product_tag','')) = ''
      )) AS d_rows_complete,
    -- Docs
    public.oracle_docs_pending(ob.indent_id, ob.oracle_no) AS docs_pending,
    -- Defective rows with blank/non-identifying serial (Section A gap detail)
    (SELECT count(*) FROM jsonb_array_elements(ob.defective_rows) r
     WHERE btrim(COALESCE(r->>'def_serial_no','')) !~ '[A-Za-z0-9]') AS a_blank_serial_count,
    (SELECT count(*) FROM jsonb_array_elements(ob.defective_rows) r
     WHERE btrim(COALESCE(r->>'def_model_no','')) = '') AS a_blank_model_count
  FROM open_blocks ob
)
SELECT
  indent_id,
  indent_no,
  oracle_no,
  indent_type,
  block_status,
  -- Section results
  a_complete AS "A_complete",
  b_complete AS "B_complete",
  c_complete AS "C_complete",
  cust_touched AS "D_touched",
  (cust_touched OR (indent_type IS DISTINCT FROM 'rma_service_ship')) AS "D_required",
  d_rows_complete AS "D_rows_complete",
  -- Overall: complete only if A && B && C && (D if required)
  (a_complete AND b_complete AND c_complete
    AND (NOT (cust_touched OR (indent_type IS DISTINCT FROM 'rma_service_ship'))
         OR d_rows_complete)) AS "block_complete",
  -- Docs
  docs_pending AS "docs_pending",
  -- Gap detail
  a_blank_serial_count AS "A_blank_serials",
  a_blank_model_count AS "A_blank_models",
  (SELECT count(*) FROM jsonb_array_elements(customer_received_rows) c
   WHERE btrim(COALESCE(c->>'warehouse_id','')) = '') AS "D_blank_warehouse",
  (SELECT count(*) FROM jsonb_array_elements(received_rows) r
   WHERE btrim(COALESCE(r->>'warehouse_id','')) = '') AS "C_blank_warehouse",
  (SELECT count(*) FROM jsonb_array_elements(received_rows) r
   WHERE btrim(COALESCE(r->>'serial_no','')) !~ '[A-Za-z0-9]') AS "C_blank_serial"
FROM section_flags
ORDER BY indent_no NULLS LAST, oracle_no;

-- STEP 2: BUCKET COUNTS — run this after STEP 1 to decide which repairs to write.
-- (Paste the STEP 1 result; this just re-aggregates it.)
WITH open_blocks AS (
  SELECT i.id AS indent_id, i.indent_type::text AS indent_type,
    COALESCE(b->>'oracle_no','') AS oracle_no,
    COALESCE(b->'defective_rows','[]'::jsonb) AS dr,
    COALESCE(b->'exchange_rows','[]'::jsonb) AS er,
    COALESCE(b->'received_rows','[]'::jsonb) AS rr,
    COALESCE(b->'customer_received_rows','[]'::jsonb) AS cr
  FROM public.indents i
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
  WHERE i.is_deleted = false
    AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
),
flags AS (
  SELECT
    (jsonb_array_length(dr) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(dr) r WHERE btrim(COALESCE(r->>'def_model_no',''))='' OR btrim(COALESCE(r->>'def_serial_no','')) !~ '[A-Za-z0-9]' OR btrim(COALESCE(r->>'qty','')) !~ '^[0-9]+(\\.[0-9]+)?$' OR COALESCE(NULLIF(btrim(r->>'qty'),'')::numeric,0)<=0)) AS a_ok,
    (jsonb_array_length(er) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(er) r WHERE btrim(COALESCE(r->>'warehouse_id',''))='' OR btrim(COALESCE(r->>'model_no',''))='' OR btrim(COALESCE(r->>'serial_no','')) !~ '[A-Za-z0-9]' OR btrim(COALESCE(r->>'qty','')) !~ '^[0-9]+(\\.[0-9]+)?$' OR COALESCE(NULLIF(btrim(r->>'qty'),'')::numeric,0)<=0)) AS b_ok,
    (jsonb_array_length(rr) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(rr) r WHERE btrim(COALESCE(r->>'warehouse_id',''))='' OR btrim(COALESCE(r->>'model_no',''))='' OR btrim(COALESCE(r->>'serial_no','')) !~ '[A-Za-z0-9]' OR btrim(COALESCE(r->>'qty','')) !~ '^[0-9]+(\\.[0-9]+)?$' OR COALESCE(NULLIF(btrim(r->>'qty'),'')::numeric,0)<=0 OR btrim(COALESCE(r->>'received_date',''))='')) AS c_ok,
    EXISTS (SELECT 1 FROM jsonb_array_elements(cr) c WHERE btrim(COALESCE(c->>'warehouse_id',''))<>'' OR btrim(COALESCE(c->>'serial_no',''))<>'' OR btrim(COALESCE(c->>'received_date',''))<>'') AS d_touched,
    (indent_type IS DISTINCT FROM 'rma_service_ship') AS d_required_by_type,
    cr
  FROM open_blocks
)
SELECT
  count(*) FILTER (WHERE NOT a_ok) AS "A_incomplete",
  count(*) FILTER (WHERE NOT b_ok) AS "B_incomplete",
  count(*) FILTER (WHERE NOT c_ok) AS "C_incomplete",
  count(*) FILTER (WHERE (d_touched OR d_required_by_type) AND NOT (jsonb_array_length(cr) > 0 AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(cr) r WHERE btrim(COALESCE(r->>'warehouse_id',''))='' OR btrim(COALESCE(r->>'model_no',''))='' OR btrim(COALESCE(r->>'serial_no','')) !~ '[A-Za-z0-9]' OR btrim(COALESCE(r->>'qty','')) !~ '^[0-9]+(\\.[0-9]+)?$' OR COALESCE(NULLIF(btrim(r->>'qty'),'')::numeric,0)<=0 OR btrim(COALESCE(r->>'received_date',''))='' OR btrim(COALESCE(r->>'product_tag',''))=''))) AS "D_incomplete",
  count(*) AS "total_open_blocks"
FROM flags;
