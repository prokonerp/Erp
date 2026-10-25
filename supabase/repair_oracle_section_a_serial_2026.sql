-- =============================================================================
-- REPAIR TEMPLATE — Section A (defective_rows) blank serial from same part
-- DRAFT: run ONLY if Wave 0 triage shows A_incomplete > 0.
-- Fills def_serial_no only when it is blank/non-identifying AND the same row's
-- model matches a received_rows or customer_received_rows entry that carries an
-- identifying serial. Never overwrites a real serial. User-run.
-- =============================================================================
BEGIN;

DO $$
DECLARE
  rec RECORD;
  v_rows jsonb;
  v_updated int := 0;
  v_fixed int := 0;
  i int;
  v_def_model text;
  v_def_serial text;
  v_src_serial text;
  v_new_rows jsonb;
BEGIN
  FOR rec IN
    SELECT i.id AS indent_id, b->>'oracle_no' AS oracle_no, b->'defective_rows' AS drows,
           b->'received_rows' AS rrows, b->'customer_received_rows' AS crows
    FROM public.indents i, jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
    WHERE i.is_deleted = false
      AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(b->'defective_rows','[]'::jsonb)) r
        WHERE btrim(COALESCE(r->>'def_serial_no','')) !~ '[A-Za-z0-9]'
      )
  LOOP
    v_rows := COALESCE(rec.drows,'[]'::jsonb);
    v_new_rows := '[]'::jsonb;
    v_fixed := 0;

    FOR i IN 0 .. jsonb_array_length(v_rows) - 1 LOOP
      v_def_model  := NULLIF(btrim(v_rows->i->>'def_model_no'),'');
      v_def_serial := NULLIF(btrim(v_rows->i->>'def_serial_no'),'');

      -- only attempt when serial is blank
      IF v_def_serial IS NULL OR v_def_serial !~ '[A-Za-z0-9]' THEN
        -- try received_rows[i], then customer_received_rows[i]
        v_src_serial := NULLIF(btrim(COALESCE(rec.rrows->i->>'serial_no','')),'');
        IF v_src_serial IS NULL OR v_src_serial !~ '[A-Za-z0-9]'
           OR NULLIF(btrim(COALESCE(rec.rrows->i->>'model_no','')),'') IS DISTINCT FROM v_def_model THEN
          v_src_serial := NULLIF(btrim(COALESCE(rec.crows->i->>'serial_no','')),'');
          IF v_src_serial IS NULL OR v_src_serial !~ '[A-Za-z0-9]'
             OR NULLIF(btrim(COALESCE(rec.crows->i->>'model_no','')),'') IS DISTINCT FROM v_def_model THEN
            v_src_serial := NULL; -- no safe source
          END IF;
        END IF;

        IF v_src_serial IS NOT NULL THEN
          v_new_rows := v_new_rows || jsonb_set(v_rows->i, '{def_serial_no}', to_jsonb(v_src_serial));
          v_fixed := v_fixed + 1;
        ELSE
          v_new_rows := v_new_rows || (v_rows->i);
        END IF;
      ELSE
        v_new_rows := v_new_rows || (v_rows->i);
      END IF;
    END LOOP;

    IF v_fixed > 0 THEN
      UPDATE public.indents
      SET oracles_data = (
        SELECT jsonb_agg(
          CASE WHEN upper(btrim(COALESCE(b->>'oracle_no',''))) = upper(btrim(COALESCE(rec.oracle_no,'')))
                AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
               THEN jsonb_set(b,'{defective_rows}', v_new_rows) ELSE b END
        ) FROM jsonb_array_elements(COALESCE(oracles_data,'[]'::jsonb)) b
      )
      WHERE id = rec.indent_id;
      v_updated := v_updated + 1;
      RAISE NOTICE 'Oracle %: filled % defective serial(s)', rec.oracle_no, v_fixed;
    END IF;
  END LOOP;
  RAISE NOTICE 'Repaired % oracle block(s) (Section A)', v_updated;
END $$;

COMMIT;

-- VERIFY (expect 0 rows where a blank serial has a matching source available):
SELECT i.id, b->>'oracle_no'
FROM public.indents i, jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
WHERE i.is_deleted = false
  AND COALESCE(b->>'status','open') NOT IN ('closed','force_closed')
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(b->'defective_rows','[]'::jsonb)) r
    WHERE btrim(COALESCE(r->>'def_serial_no','')) !~ '[A-Za-z0-9]'
  );
