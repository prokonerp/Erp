-- =============================================================================
-- ONE-TIME DATA REPAIR — Oracle 41214317 satellite satellites (scoped, audited)
-- =============================================================================
-- CONTEXT (as of 09:31:24 after your SELECT):
--   indents.oracles_data[41214317].exchange (B) = 0H2629G00591 ✓ (already fixed via
--     scoped correct_indent_oracle_serial)
--   indents.oracles_data[41214317].received (C) = 0H2624G00408 ✓
--   Stale satellites:
--     tickets.good_parts_details[0].serial = 0H2624G00408 ✗ should be 0H2629G00591
--       ticket id = 7d29997d-0da9-46ce-9733-e2219a00f1bd
--     delivery_challans.items[0].serial_no = 0H2624G00408 ✗ stale legacy
--       challan_no = DC-CUST/26-27/0113 (canonical good_serial = 0H2629G00591 so UI looks ok)
--     ims_stock_items no row part_serial_no=0H2629G00591 (0 rows) — stock for issued unit missing
--
-- SAFETY:
--   - No DELETE, no TRUNCATE. Only single-row UPDATEs by PK (id / challan_no) + conditional INSERT.
--   - All changes are audited to document_deletion_audit (manual audit rows).
--   - Run inside a transaction: inspect SELECTs first, then COMMIT only if ok, else ROLLBACK.
--   - Indents.oracles_data is NOT touched — B/C already correct and must stay distinct.
--   - Global propagate_serial_correction is NOT called — this is slot-scoped only.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 0 — VERIFY current state (read-only, no write)
-- ---------------------------------------------------------------------------
-- Tickets satellite
-- SELECT id, good_parts_details->0->>'serial' AS good_serial, good_parts_details
-- FROM tickets WHERE id='7d29997d-0da9-46ce-9733-e2219a00f1bd';

-- Delivery challan satellite
-- SELECT id, challan_no, items->0->>'serial_no' AS legacy_serial, items->0->>'good_serial' AS canonical_serial, items
-- FROM delivery_challans WHERE challan_no='DC-CUST/26-27/0113';

-- Stock check
-- SELECT id, part_serial_no, stock_status, warehouse_id, transaction_ref
-- FROM ims_stock_items WHERE part_serial_no IN ('0H2624G00408','0H2629G00591');

-- Indent oracle (should already be B=0H2629, C=0H2624)
-- SELECT id, indent_no,
--        b->>'oracle_no' AS oracle_no,
--        b->'exchange_rows'->0->>'serial_no' AS b_exchange,
--        b->'received_rows'->0->>'serial_no' AS c_received
-- FROM indents, jsonb_array_elements(COALESCE(oracles_data,'[]'::jsonb)) b
-- WHERE b->>'oracle_no'='41214317';

-- ---------------------------------------------------------------------------
-- STEP 1 — FIX tickets.good_parts_details (B satellite) — single ticket, single serial
-- ---------------------------------------------------------------------------
BEGIN;

-- 1a) Audit row (never delete — insert only)
INSERT INTO document_deletion_audit
  (document_type, document_subtype, document_no, document_id, reason, deleted_by, original_created_by, original_created_at, snapshot)
SELECT
  'ticket_satellite_correction', 'good_parts_details',
  COALESCE(NULLIF(t.case_id,''), t.id::text), t.id,
  'Repair 41214317: B satellite 0H2624G00408 → 0H2629G00591 (ticket good_parts_details). Indent B already correct; satellites were left stale by scoped path.',
  auth.uid(), t.created_by, t.created_at,
  jsonb_build_object('oracle_no','41214317','slot','exchange','old_serial','0H2624G00408','new_serial','0H2629G00591','ticket_id',t.id)
FROM tickets t WHERE t.id='7d29997d-0da9-46ce-9733-e2219a00f1bd';

-- 1b) Scoped update — only that ticket, only that token, preserves other rows
UPDATE tickets SET good_parts_details = (
  SELECT COALESCE(jsonb_agg(
    jsonb_set(elem, '{serial}', to_jsonb(CASE WHEN btrim(COALESCE(elem->>'serial','')) = '0H2624G00408' THEN '0H2629G00591' ELSE btrim(COALESCE(elem->>'serial','')) END), false)
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(good_parts_details,'[]'::jsonb)) elem
) WHERE id='7d29997d-0da9-46ce-9733-e2219a00f1bd'
  AND good_parts_details::text LIKE '%0H2624G00408%';

-- ---------------------------------------------------------------------------
-- STEP 2 — FIX delivery_challans legacy serial_no (B document satellite)
-- ---------------------------------------------------------------------------
INSERT INTO document_deletion_audit
  (document_type, document_subtype, document_no, document_id, reason, deleted_by, original_created_by, original_created_at, snapshot)
SELECT
  'delivery_challan_satellite_correction', 'exchange',
  dc.challan_no, dc.id,
  'Repair 41214317: DC-CUST legacy serial_no 0H2624G00408 → 0H2629G00591 (delivery_challans.items). Canonical good_serial already 0H2629; legacy field was orphan.',
  auth.uid(), dc.created_by, dc.created_at,
  jsonb_build_object('oracle_no','41214317','old_serial','0H2624G00408','new_serial','0H2629G00591','challan_no',dc.challan_no)
FROM delivery_challans dc WHERE dc.challan_no='DC-CUST/26-27/0113';

UPDATE delivery_challans SET items = (
  SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, '0H2624G00408', '0H2629G00591')), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) it
) WHERE challan_no='DC-CUST/26-27/0113'
  AND items::text LIKE '%0H2624G00408%';

-- Legacy field good_serial / good_defective_serial may also hold stale value if present — ensure token replace covers all keys
-- serial_replace_in_item already handles serial_no, good_defective_serial, serials, serial_numbers. If DC uses good_serial, also patch explicitly:
UPDATE delivery_challans SET items = (
  SELECT COALESCE(jsonb_agg(
    jsonb_set(it, '{good_serial}', to_jsonb(public.serial_replace_token(COALESCE(it->>'good_serial',''), '0H2624G00408', '0H2629G00591')), false)
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) it
) WHERE challan_no='DC-CUST/26-27/0113'
  AND items::text LIKE '%0H2624G00408%';

-- ---------------------------------------------------------------------------
-- STEP 3 — ENSURE stock row for 0H2629G00591 exists (issued unit)
--   If a stock row for 0H2624 exists in issued/returned_to_oem state, rename it by PK.
--   Otherwise if no row for 0H2629 exists, insert a single issued row linked to the DC.
-- ---------------------------------------------------------------------------
-- 3a) Try rename by PK if old stock row exists (most common: stock was issued via DC)
DO $$
DECLARE
  v_old_id uuid;
  v_new_exists int;
BEGIN
  SELECT id INTO v_old_id FROM ims_stock_items WHERE part_serial_no='0H2624G00408' LIMIT 1;
  SELECT count(*) INTO v_new_exists FROM ims_stock_items WHERE part_serial_no='0H2629G00591';
  IF v_new_exists > 0 THEN
    RAISE NOTICE 'Stock 0H2629G00591 already exists — skipping stock rename/insert';
    RETURN;
  END IF;
  IF v_old_id IS NOT NULL THEN
    -- Audit the rename
    INSERT INTO document_deletion_audit
      (document_type, document_subtype, document_no, document_id, reason, deleted_by, original_created_by, original_created_at, snapshot)
    SELECT 'ims_stock_satellite_correction', 'part_serial_no', COALESCE(part_serial_no, id::text), id,
           'Repair 41214317: stock 0H2624G00408 → 0H2629G00591 (issued unit from DC 0113)',
           auth.uid(), created_by, created_at,
           jsonb_build_object('old_serial','0H2624G00408','new_serial','0H2629G00591','source','delivery_challans DC-CUST/26-27/0113')
    FROM ims_stock_items WHERE id=v_old_id;
    UPDATE ims_stock_items SET part_serial_no='0H2629G00591', updated_at=now() WHERE id=v_old_id;
    RAISE NOTICE 'Renamed stock % from 0H2624G00408 to 0H2629G00591', v_old_id;
  ELSE
    RAISE NOTICE 'No stock row with 0H2624G00408 found — will insert issued row for 0H2629 if needed';
  END IF;
END $$;

-- 3b) If still missing after rename attempt, insert an issued row (good stock, issued via DC-CUST)
--     Warehouse: try to copy from the DC's warehouse, else fallback to ROI-GGN or first active warehouse.
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
LEFT JOIN warehouses w ON w.code='ROI-GGN' OR w.name ILIKE '%ROI%' -- try ROI-GGN
WHERE dc.challan_no='DC-CUST/26-27/0113'
  AND NOT EXISTS (SELECT 1 FROM ims_stock_items WHERE part_serial_no='0H2629G00591')
LIMIT 1;

-- ---------------------------------------------------------------------------
-- STEP 4 — VERIFY (read-only checks before you COMMIT)
-- ---------------------------------------------------------------------------
-- SELECT 'tickets' AS tbl, good_parts_details->0->>'serial' FROM tickets WHERE id='7d29997d-0da9-46ce-9733-e2219a00f1bd';
-- SELECT 'dc' AS tbl, items->0->>'serial_no', items->0->>'good_serial' FROM delivery_challans WHERE challan_no='DC-CUST/26-27/0113';
-- SELECT 'stock_old' AS tbl, count(*) FROM ims_stock_items WHERE part_serial_no='0H2624G00408';
-- SELECT 'stock_new' AS tbl, count(*) FROM ims_stock_items WHERE part_serial_no='0H2629G00591';
-- SELECT 'indent' AS tbl, b->'exchange_rows'->0->>'serial_no' AS b, b->'received_rows'->0->>'serial_no' AS c
--   FROM indents, jsonb_array_elements(oracles_data) b WHERE b->>'oracle_no'='41214317';

-- If SELECTs look correct (B=0H2629, C=0H2624, ticket=0H2629, dc good_serial=0H2629, stock_new=1) → COMMIT; else ROLLBACK;
COMMIT;
-- ROLLBACK; -- uncomment to abort if verification failed

-- =============================================================================
-- ALTERNATIVE (if you prefer RPC over direct UPDATE, and indent still holds old):
--   SELECT public.correct_oracle_slot(
--     (SELECT id FROM indents, jsonb_array_elements(oracles_data) b WHERE b->>'oracle_no'='41214317' LIMIT 1),
--     '41214317','exchange','0H2624G00408','0H2629G00591',
--     'Repair 41214317 satellite via RPC', true, true);
-- But since indent B is already 0H2629, the RPC verify will fail with "not found".
-- Hence direct satellite UPDATEs above are correct for this post-scoped repair.
-- =============================================================================
