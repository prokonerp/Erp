-- ============================================================================
-- Repair: Oracle 41220083 defective serials + placeholder serial cleanup
-- Created: 2026-10-22
--
-- Symptom
--   Section A of Oracle 41220083 showed 3 defective parts, but the
--   ims.defective-tags ASP list showed only 2. All three Section A rows
--   carried the free-text serial "," and the listing deduped on MODEL|SERIAL,
--   so the two 0J-31-013149 rows collapsed into one.
--
-- Source of truth (read live 2026-10-22)
--   Ticket  PHS0410262137539  (id 21038435-d494-487e-8313-3e6761945bba)
--   GRN     GRN-CUST/26-27/0050  (customer GRN, 2026-10-19)
--   row 0 -> 0J-31-013149 / W53182904G26D11500082
--   row 1 -> 0J-31-013149 / A30438602G24I14500072
--   row 2 -> 0J-31-012914 / W53065902G24I15500071
--
-- Safety
--   * Authored, not executed. Run it yourself.
--   * Single transaction: inspect BEFORE/AFTER, then COMMIT.
--   * Idempotent: re-running is a no-op once the serials are real.
--   * Touches indents.oracles_data only. No tickets, GRNs, DCs or stock.
--   * Aborts unless the target block still has the expected 3 models.
-- ============================================================================

BEGIN;

-- 1. BEFORE ------------------------------------------------------------------
SELECT i.id AS indent_id,
       b.ord AS block_ord,
       r.ord AS row_ord,
       r.row->>'def_model_no'  AS model_no,
       r.row->>'def_serial_no' AS serial_no
FROM indents i
CROSS JOIN LATERAL jsonb_array_elements(i.oracles_data) WITH ORDINALITY AS b(blk, ord)
CROSS JOIN LATERAL jsonb_array_elements(b.blk->'defective_rows') WITH ORDINALITY AS r(row, ord)
WHERE jsonb_typeof(i.oracles_data) = 'array'
  AND b.blk->>'oracle_no' = '41220083'
ORDER BY b.ord, r.ord;

-- 2. GUARD -------------------------------------------------------------------
DO $$
DECLARE
  v_indent uuid := 'b73cd7bf-b551-4da7-866d-dd379aae8f95';
  v_models text[];
BEGIN
  SELECT array_agg(r.row->>'def_model_no' ORDER BY r.ord)
    INTO v_models
  FROM indents i
  CROSS JOIN LATERAL jsonb_array_elements(i.oracles_data) AS b(blk)
  CROSS JOIN LATERAL jsonb_array_elements(b.blk->'defective_rows') WITH ORDINALITY AS r(row, ord)
  WHERE i.id = v_indent
    AND jsonb_typeof(i.oracles_data) = 'array'
    AND b.blk->>'oracle_no' = '41220083';

  IF v_models IS DISTINCT FROM ARRAY['0J-31-013149','0J-31-013149','0J-31-012914'] THEN
    RAISE EXCEPTION 'Oracle 41220083 row models changed (%); aborting', v_models;
  END IF;
END $$;

-- 3. REPAIR 41220083 ---------------------------------------------------------
WITH fix AS (
  SELECT '41220083'::text AS oracle_no,
         jsonb_build_object(
           '0', 'W53182904G26D11500082',
           '1', 'A30438602G24I14500072',
           '2', 'W53065902G24I15500071'
         ) AS serials
)
UPDATE indents i
SET oracles_data = (
  SELECT jsonb_agg(
           CASE
             WHEN b.blk->>'oracle_no' = fx.oracle_no THEN
               jsonb_set(
                 b.blk,
                 '{defective_rows}',
                 (
                   SELECT jsonb_agg(
                            CASE
                              WHEN fx.serials ? ((r.ord - 1)::text) THEN
                                jsonb_set(
                                  r.row,
                                  '{def_serial_no}',
                                  to_jsonb(fx.serials->>((r.ord - 1)::text)),
                                  true
                                )
                              ELSE r.row
                            END
                            ORDER BY r.ord
                          )
                   FROM jsonb_array_elements(b.blk->'defective_rows') WITH ORDINALITY AS r(row, ord)
                 ),
                 true
               )
             ELSE b.blk
           END
           ORDER BY b.ord
         )
  FROM jsonb_array_elements(i.oracles_data) WITH ORDINALITY AS b(blk, ord)
  CROSS JOIN fix fx
)
WHERE i.id = 'b73cd7bf-b551-4da7-866d-dd379aae8f95'
  AND jsonb_typeof(i.oracles_data) = 'array';

-- 4. CLEAR remaining placeholder serials -------------------------------------
-- A value with no letter or digit is a data-entry placeholder, never an
-- identity. Blank it so no listing can dedupe two units on it again.
UPDATE indents i
SET oracles_data = (
  SELECT jsonb_agg(
           CASE
             WHEN jsonb_typeof(b.blk->'defective_rows') = 'array' THEN
               jsonb_set(
                 b.blk,
                 '{defective_rows}',
                 (
                   SELECT coalesce(
                            jsonb_agg(
                              CASE
                                WHEN coalesce(r.row->>'def_serial_no','') <> ''
                                 AND (r.row->>'def_serial_no') !~ '[A-Za-z0-9]' THEN
                                  jsonb_set(r.row, '{def_serial_no}', '""'::jsonb, true)
                                ELSE r.row
                              END
                              ORDER BY r.ord
                            ),
                            '[]'::jsonb
                          )
                   FROM jsonb_array_elements(b.blk->'defective_rows') WITH ORDINALITY AS r(row, ord)
                 ),
                 false
               )
             ELSE b.blk
           END
           ORDER BY b.ord
         )
  FROM jsonb_array_elements(i.oracles_data) WITH ORDINALITY AS b(blk, ord)
)
WHERE jsonb_typeof(i.oracles_data) = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(i.oracles_data) AS b2(blk)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(b2.blk->'defective_rows') = 'array'
           THEN b2.blk->'defective_rows' ELSE '[]'::jsonb END
    ) AS r2(row)
    WHERE coalesce(r2.row->>'def_serial_no','') <> ''
      AND (r2.row->>'def_serial_no') !~ '[A-Za-z0-9]'
  );

-- 5. AFTER -------------------------------------------------------------------
SELECT i.id AS indent_id,
       b.ord AS block_ord,
       r.ord AS row_ord,
       r.row->>'def_model_no'  AS model_no,
       r.row->>'def_serial_no' AS serial_no
FROM indents i
CROSS JOIN LATERAL jsonb_array_elements(i.oracles_data) WITH ORDINALITY AS b(blk, ord)
CROSS JOIN LATERAL jsonb_array_elements(b.blk->'defective_rows') WITH ORDINALITY AS r(row, ord)
WHERE jsonb_typeof(i.oracles_data) = 'array'
  AND b.blk->>'oracle_no' = '41220083'
ORDER BY b.ord, r.ord;

-- 6. ASSERT ------------------------------------------------------------------
DO $$
DECLARE
  v_bad int;
  v_fixed int;
BEGIN
  SELECT count(*) INTO v_bad
  FROM indents i
  CROSS JOIN LATERAL jsonb_array_elements(i.oracles_data) AS b(blk)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(b.blk->'defective_rows') = 'array'
         THEN b.blk->'defective_rows' ELSE '[]'::jsonb END
  ) AS r(row)
  WHERE jsonb_typeof(i.oracles_data) = 'array'
    AND coalesce(r.row->>'def_serial_no','') <> ''
    AND (r.row->>'def_serial_no') !~ '[A-Za-z0-9]';

  IF v_bad > 0 THEN
    RAISE EXCEPTION '% placeholder defective serial(s) still present; rolling back', v_bad;
  END IF;

  SELECT count(*) INTO v_fixed
  FROM indents i
  CROSS JOIN LATERAL jsonb_array_elements(i.oracles_data) AS b(blk)
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(b.blk->'defective_rows') = 'array'
         THEN b.blk->'defective_rows' ELSE '[]'::jsonb END
  ) AS r(row)
  WHERE jsonb_typeof(i.oracles_data) = 'array'
    AND b.blk->>'oracle_no' = '41220083'
    AND r.row->>'def_serial_no' IN (
      'W53182904G26D11500082',
      'A30438602G24I14500072',
      'W53065902G24I15500071'
    );

  IF v_fixed <> 3 THEN
    RAISE EXCEPTION 'Oracle 41220083 has % repaired serials (expected 3); rolling back', v_fixed;
  END IF;
END $$;

COMMIT;
