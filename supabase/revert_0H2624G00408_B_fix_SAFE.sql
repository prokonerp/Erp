-- =============================================================================
-- SAFE REVERT for Oracle 41214317  —  B (Material Exchange) wrongly changed
-- when correcting C (GRN-OEM 0H2624G00408 → ?)
-- =============================================================================
-- GOAL: Put B back to 0H2624G00408 (what you SENT to customer) without touching
--   C (what OEM sent you), D, A, or any other DC/GRN. No DELETE, no TRUNCATE.
--   All statements are SELECT-first, then single-row UPDATE by primary key.
--   Run inside a transaction so you can ROLLBACK if SELECT shows unexpected.
--
-- HOW TO RUN (Supabase SQL Editor):
--   1) Paste this whole file
--   2) Replace 'WRONG_SERIAL_IN_B' below with what B currently shows (if you
--      know it). If you don't, run the AUTO block at the bottom instead.
--   3) Check the SELECT outputs, then UN-COMMENT and run the UPDATE blocks
--      one by one. Or wrap all in BEGIN; ... COMMIT; and ROLLBACK if wrong.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 0 — FIND the indent and DC that hold Oracle 41214317
-- No writes. Run first, note indent_id and dc_id.
-- ---------------------------------------------------------------------------
-- Indent that contains Oracle 41214317
SELECT
  i.id              AS indent_id,
  i.indent_no,
  b->>'oracle_no'   AS oracle_no,
  b->'exchange_rows' AS exchange_rows_before,
  b->'received_rows' AS received_rows_before
FROM public.indents i,
     jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) AS b
WHERE b->>'oracle_no' = '41214317';

-- The DC that was generated from B (should be DC-CUST/26-27/0113)
SELECT id, challan_no, status, items
FROM public.delivery_challans
WHERE challan_no = 'DC-CUST/26-27/0113'
   OR items::text LIKE '%41214317%';

-- The two GRNs (for reference only — we will NOT touch them)
SELECT id, grn_no, category, status, items
FROM public.grns
WHERE grn_no IN ('GRN-OEM/26-27/0032','GRN-CUST/26-27/0024');

-- ---------------------------------------------------------------------------
-- STEP 1 — VERIFY what B currently holds (no write)
-- ---------------------------------------------------------------------------
SELECT
  b->>'oracle_no'                               AS oracle_no,
  b->'exchange_rows'->0->>'serial_no'            AS b_exchange_serial_now,
  b->'received_rows'->0->>'serial_no'            AS c_received_serial_now
FROM public.indents i,
     jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) AS b
WHERE b->>'oracle_no' = '41214317';

-- Expected after the bug: b_exchange_serial_now = 'WRONG_SERIAL_IN_B' (not 0H2624G00408)
-- Expected c_received_serial_now = 'YOUR_NEW_CORRECT_C_SERIAL' (keep as-is)

-- ---------------------------------------------------------------------------
-- STEP 2a — MANUAL FIX (if you KNOW what wrong serial B now has)
-- Replace 'WRONG_SERIAL_IN_B' with the current wrong value in B
-- Example: if C was corrected to 'ABC1234567' and B also became 'ABC1234567',
-- set WRONG_SERIAL_IN_B = 'ABC1234567' and it will be put back to 0H2624G00408
-- ---------------------------------------------------------------------------
-- BEGIN;  -- uncomment to make it transactional
--
-- SELECT public.correct_indent_oracle_serial(
--   (SELECT id FROM public.indents, jsonb_array_elements(oracles_data) b WHERE b->>'oracle_no'='41214317' LIMIT 1),
--   '41214317',
--   'exchange',                -- B slot only!
--   'WRONG_SERIAL_IN_B',       -- <-- PUT CURRENT WRONG VALUE HERE
--   '0H2624G00408',
--   'Revert B - was wrongly changed when correcting C for Oracle 41214317'
-- );
--
-- -- Also fix the DC document that was generated from B (only this challan_no)
-- UPDATE public.delivery_challans
--    SET items = (
--      SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, 'WRONG_SERIAL_IN_B', '0H2624G00408')), '[]'::jsonb)
--        FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
--    )
--  WHERE challan_no = 'DC-CUST/26-27/0113'
--    AND items::text LIKE '%WRONG_SERIAL_IN_B%';
--
-- COMMIT; -- or ROLLBACK if SELECT in step 1 looked wrong

-- ---------------------------------------------------------------------------
-- STEP 2b — AUTO FIX (if you DON'T know the wrong value, put B back to
-- 0H2624G00408 whenever B is NOT already 0H2624G00408)
-- This block finds the current B serial automatically and reverts it.
-- No DELETE. Single indent, single oracle, single slot.
-- ---------------------------------------------------------------------------
-- BEGIN;
-- DO $$
-- DECLARE
--   v_indent_id uuid;
--   v_wrong text;
-- BEGIN
--   SELECT i.id, b->'exchange_rows'->0->>'serial_no'
--     INTO v_indent_id, v_wrong
--   FROM public.indents i,
--        jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) AS b
--   WHERE b->>'oracle_no' = '41214317'
--   LIMIT 1;
--
--   IF v_indent_id IS NULL THEN
--     RAISE NOTICE 'No indent found for oracle 41214317 - nothing to do';
--     RETURN;
--   END IF;
--   IF v_wrong = '0H2624G00408' THEN
--     RAISE NOTICE 'B already 0H2624G00408 — nothing to revert';
--     RETURN;
--   END IF;
--   IF v_wrong IS NULL OR v_wrong = '' THEN
--     RAISE EXCEPTION 'B serial is empty, aborting to avoid accidental write';
--   END IF;
--
--   RAISE NOTICE 'Reverting B exchange_rows %.% from % to 0H2624G00408', v_indent_id, '41214317', v_wrong;
--
--   PERFORM public.correct_indent_oracle_serial(
--     v_indent_id, '41214317', 'exchange', v_wrong, '0H2624G00408',
--     'Revert B - auto fix after C correction over-propagated'
--   );
--
--   -- Also fix the single DC that holds B's serial (only if it still has the wrong value)
--   UPDATE public.delivery_challans
--      SET items = (
--        SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_wrong, '0H2624G00408')), '[]'::jsonb)
--          FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
--      )
--    WHERE challan_no = 'DC-CUST/26-27/0113'
--      AND items::text LIKE '%'||v_wrong||'%';
--
--   RAISE NOTICE 'Done. B should now be 0H2624G00408, C untouched.';
-- END $$;
-- COMMIT;

-- ---------------------------------------------------------------------------
-- STEP 3 — VERIFY again (no write) — both slots now correct and distinct
-- ---------------------------------------------------------------------------
-- SELECT
--   b->>'oracle_no'                    AS oracle_no,
--   b->'exchange_rows'->0->>'serial_no' AS b_now,  -- expect 0H2624G00408
--   b->'received_rows'->0->>'serial_no' AS c_now   -- expect YOUR_NEW_C_SERIAL (unchanged)
-- FROM public.indents i,
--      jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) AS b
-- WHERE b->>'oracle_no' = '41214317';
--
-- SELECT challan_no, items->0->>'serial_no' AS dc_serial
-- FROM public.delivery_challans WHERE challan_no='DC-CUST/26-27/0113';
-- SELECT grn_no, items->0->>'serial_no' AS grn_serial
-- FROM public.grns WHERE grn_no='GRN-OEM/26-27/0032';
-- =============================================================================
-- ROLLBACK SAFETY: If you used BEGIN; and the SELECTs after UPDATE look wrong,
-- run ROLLBACK; instead of COMMIT; — nothing is deleted, data stays as before.
-- =============================================================================
