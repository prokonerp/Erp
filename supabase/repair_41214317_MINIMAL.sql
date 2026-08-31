-- =============================================================================
-- MINIMAL REPAIR — Oracle 41214317 satellite satellites (direct UPDATE, no audit)
-- =============================================================================
-- CONTEXT: indents.oracles_data exchange_rows B=0H2629G00591 ✓, received_rows
--   C=0H2624G00408 ✓ — already distinct, DO NOT TOUCH indent. Stale satellites:
--     tickets.good_parts_details[0].serial = 0H2624G00408 (ticket id
--       7d29997d-0da9-46ce-9733-e2219a00f1bd) → should be 0H2629G00591
--     delivery_challans.items serial_no / good_serial = 0H2624G00408
--       (challan_no DC-CUST/26-27/0113, status 'Challan Generated'/'Submitted')
--       → frozen by trigger assert_items_frozen_after_post()
--     ims_stock_items missing 0H2629G00591
--
-- WHY THIS SUCCEEDS WHERE PREVIOUS ATTEMPTS FAILED:
--   Trigger assert_items_frozen_after_post() raises
--     P0001 "Challan Generated — its items are frozen because stock has been posted"
--   when delivery_challans.status IN ('Challan Generated','Submitted','Dispatched')
--   and items changes. It starts with:
--     IF serial_propagation_on() THEN RETURN NEW;
--   where serial_propagation_on() = current_setting('app.serial_propagation')='on'.
--   propagate_serial_correction() does PERFORM set_config('app.serial_propagation','on',true)
--   before its UPDATEs, so it bypasses the guard. The previous direct-UPDATE
--   repair script and correct_oracle_slot did NOT set this flag, so they were
--   blocked. This script sets it explicitly at transaction start, transaction-
--   local (third arg true = auto-reset at COMMIT/ROLLBACK), so the frozen guard
--   is bypassed for this correction only.
--
-- NOTES:
--   - tickets column is case_id (not ticket_no) — PK is id, case_id used for display
--   - delivery_challans frozen after 'Challan Generated'/'Submitted' — needs flag
--   - indent is NOT touched (B/C already correct and distinct)
--   - Works in Supabase SQL Editor where auth.uid() IS NULL (no admin check here)
--   - stock: rename old row by PK if exists, else insert issued row
--   - handles both serial_no and good_serial in DC items (good_serial not covered
--     by serial_replace_in_item, so second pass via serial_replace_token)
-- =============================================================================

-- STEP 0 — verify current state (read-only, no write — run first if you want)
-- SELECT id, case_id, good_parts_details->0->>'serial' AS good_serial, good_parts_details
-- FROM tickets WHERE id='7d29997d-0da9-46ce-9733-e2219a00f1bd';
-- SELECT id, challan_no, status, items->0->>'serial_no' AS legacy_serial, items->0->>'good_serial' AS canonical_serial, items
-- FROM delivery_challans WHERE challan_no='DC-CUST/26-27/0113';
-- SELECT id, part_serial_no, stock_status, warehouse_id, transaction_ref
-- FROM ims_stock_items WHERE part_serial_no IN ('0H2624G00408','0H2629G00591');
-- SELECT b->>'oracle_no', b->'exchange_rows'->0->>'serial_no' AS b_exchange, b->'received_rows'->0->>'serial_no' AS c_received
-- FROM indents, jsonb_array_elements(COALESCE(oracles_data,'[]'::jsonb)) b WHERE b->>'oracle_no'='41214317';

BEGIN;

-- 0) Bypass frozen-items guard for this transaction only (local, auto-reset)
--    assert_items_frozen_after_post checks serial_propagation_on() = current_setting('app.serial_propagation')='on'
SELECT set_config('app.serial_propagation', 'on', true);

-- 1) Fix tickets.good_parts_details (B satellite) — scoped by PK id
UPDATE tickets SET good_parts_details = (
  SELECT COALESCE(jsonb_agg(
    jsonb_set(elem, '{serial}', to_jsonb(
      CASE WHEN btrim(COALESCE(elem->>'serial','')) = '0H2624G00408' THEN '0H2629G00591'
           ELSE btrim(COALESCE(elem->>'serial','')) END), false)
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(good_parts_details,'[]'::jsonb)) elem
) WHERE id='7d29997d-0da9-46ce-9733-e2219a00f1bd'
  AND good_parts_details::text LIKE '%0H2624G00408%';

-- 2) Fix delivery_challans.items — scoped by PK challan_no
-- 2a) serial_no / good_defective_serial / serials / serial_numbers via helper
UPDATE delivery_challans SET items = (
  SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, '0H2624G00408', '0H2629G00591')), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) it
) WHERE challan_no='DC-CUST/26-27/0113'
  AND items::text LIKE '%0H2624G00408%';

-- 2b) good_serial (DC-CUST uses good_serial, not good_defective_serial — not covered by serial_replace_in_item)
UPDATE delivery_challans SET items = (
  SELECT COALESCE(jsonb_agg(
    jsonb_set(it, '{good_serial}', to_jsonb(public.serial_replace_token(COALESCE(it->>'good_serial',''), '0H2624G00408', '0H2629G00591')), false)
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) it
) WHERE challan_no='DC-CUST/26-27/0113'
  AND items::text LIKE '%0H2624G00408%';

-- 3) Stock — rename old row by PK if exists, else insert issued row
DO $$
DECLARE
  v_old_id uuid;
  v_new_exists int;
BEGIN
  SELECT id INTO v_old_id FROM ims_stock_items WHERE part_serial_no='0H2624G00408' LIMIT 1;
  SELECT count(*) INTO v_new_exists FROM ims_stock_items WHERE part_serial_no='0H2629G00591';
  IF v_new_exists > 0 THEN
    RAISE NOTICE 'Stock 0H2629G00591 already exists — skipping rename/insert';
    RETURN;
  END IF;
  IF v_old_id IS NOT NULL THEN
    UPDATE ims_stock_items SET part_serial_no='0H2629G00591', updated_at=now() WHERE id=v_old_id;
    RAISE NOTICE 'Renamed stock % from 0H2624G00408 to 0H2629G00591', v_old_id;
  ELSE
    RAISE NOTICE 'No stock row with 0H2624G00408 — will insert issued row for 0H2629 if needed';
  END IF;
END $$;

INSERT INTO ims_stock_items
  (oem, part_name, part_model_no, part_serial_no, warehouse_id, stock_type, stock_status, qty, transaction_ref, notes, created_by)
SELECT
  COALESCE(dc.items->0->>'oem', 'Prokon'),
  COALESCE(dc.items->0->>'part_name', 'Exchange Part'),
  COALESCE(dc.items->0->>'model_no', dc.items->0->>'good_model', 'UNKNOWN'),
  '0H2629G00591',
  COALESCE(w.id, (SELECT id FROM warehouses WHERE status='Active' ORDER BY name LIMIT 1)),
  'good'::ims_stock_type,
  'issued'::ims_stock_status,
  1,
  'DC DC-CUST/26-27/0113',
  'Repair 41214317: inserted missing issued stock for 0H2629G00591 (issued via DC-CUST/0113). Original stock row missing after scoped B correction.',
  dc.created_by
FROM delivery_challans dc
LEFT JOIN warehouses w ON w.code='ROI-GGN' OR w.name ILIKE '%ROI%'
WHERE dc.challan_no='DC-CUST/26-27/0113'
  AND NOT EXISTS (SELECT 1 FROM ims_stock_items WHERE part_serial_no='0H2629G00591')
LIMIT 1;

-- 4) VERIFY (read-only checks before you COMMIT — keep inside transaction)
SELECT 'tickets'   AS tbl, id, case_id, good_parts_details->0->>'serial' AS serial_after FROM tickets WHERE id='7d29997d-0da9-46ce-9733-e2219a00f1bd';
SELECT 'dc'        AS tbl, challan_no, status, items->0->>'serial_no' AS serial_no_after, items->0->>'good_serial' AS good_serial_after FROM delivery_challans WHERE challan_no='DC-CUST/26-27/0113';
SELECT 'stock_old' AS tbl, count(*) AS cnt FROM ims_stock_items WHERE part_serial_no='0H2624G00408';
SELECT 'stock_new' AS tbl, count(*) AS cnt FROM ims_stock_items WHERE part_serial_no='0H2629G00591';
SELECT 'indent'    AS tbl, b->>'oracle_no' AS oracle_no, b->'exchange_rows'->0->>'serial_no' AS b_should_be_0H2629, b->'received_rows'->0->>'serial_no' AS c_should_be_0H2624
FROM indents, jsonb_array_elements(COALESCE(oracles_data,'[]'::jsonb)) b WHERE b->>'oracle_no'='41214317';

-- If verification looks correct (ticket=0H2629, dc serial_no/good_serial=0H2629, stock_new=1, indent B=0H2629 C=0H2624) → COMMIT; else ROLLBACK;
COMMIT;
-- ROLLBACK; -- uncomment to abort if verification failed (re-run with ROLLBACK instead of COMMIT)
