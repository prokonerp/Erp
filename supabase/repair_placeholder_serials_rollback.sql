-- =====================================================================
-- Rollback for repair_placeholder_serials.sql — HUMAN RUN
--
-- Restores the exact before-images captured in activity_log
-- (source='repair_script', metadata.batch_id='20261022_placeholder_serials').
-- Also drops the Phase-2 CHECK constraints and restores the old non-unique
-- defective_tags index, so a pre-repair state is reachable.
--
-- This is a destructive rollback of a repair. Run only after reviewing:
--   SELECT * FROM public.activity_log
--    WHERE source='repair_script'
--      AND metadata->>'batch_id'='20261022_placeholder_serials'
--    ORDER BY occurred_at;
--
-- RUN: entire file in Supabase SQL Editor, or psql "$DATABASE_URL" -f ...
-- =====================================================================

BEGIN;

SET LOCAL app.serial_repair_restore = 'on';
-- Restoring document items must also bypass the posted-document freeze guard.
SET LOCAL app.serial_propagation = 'on';

-- ---------------------------------------------------------------------
-- 1. Remove Phase-2 constraints/index so placeholder before-images can return.
-- ---------------------------------------------------------------------
ALTER TABLE public.defective_tags       DROP CONSTRAINT IF EXISTS defective_tags_no_placeholder_serial;
ALTER TABLE public.ims_stock_items      DROP CONSTRAINT IF EXISTS ims_stock_items_no_placeholder_serial;
ALTER TABLE public.ims_transactions     DROP CONSTRAINT IF EXISTS ims_transactions_no_placeholder_serial;
ALTER TABLE public.ims_transfers        DROP CONSTRAINT IF EXISTS ims_transfers_no_placeholder_serial;
ALTER TABLE public.tickets              DROP CONSTRAINT IF EXISTS tickets_no_placeholder_serial;
ALTER TABLE public.indents              DROP CONSTRAINT IF EXISTS indents_no_placeholder_serial;
ALTER TABLE public.installed_equipment  DROP CONSTRAINT IF EXISTS installed_equipment_no_placeholder_serial;

DROP INDEX IF EXISTS public.defective_tags_unique_model_serial;
CREATE INDEX defective_tags_unique_model_serial
  ON public.defective_tags (
    lower(btrim(coalesce(model_no, ''))),
    lower(btrim(coalesce(serial_no, '')))
  )
  WHERE btrim(coalesce(serial_no, '')) <> '';

-- ---------------------------------------------------------------------
-- 2. Restore updated rows from their full-row before-images.
-- ---------------------------------------------------------------------
UPDATE public.defective_tags t
   SET serial_no = a.old_value->>'serial_no', updated_at = now()
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'defective_tag'
   AND a.action = 'repair'
   AND a.entity_id = t.id;

UPDATE public.ims_stock_items s
   SET part_serial_no = a.old_value->>'part_serial_no', updated_at = now()
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'ims_stock_item'
   AND a.action = 'repair'
   AND a.entity_id = s.id;

UPDATE public.ims_transactions x
   SET part_serial_no = a.old_value->>'part_serial_no'
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'ims_transaction'
   AND a.action = 'repair'
   AND a.entity_id = x.id;

UPDATE public.ims_transfers x
   SET part_serial_no = a.old_value->>'part_serial_no'
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'ims_transfer'
   AND a.action = 'repair'
   AND a.entity_id = x.id;

UPDATE public.tickets t
   SET serial_no = a.old_value->>'serial_no',
       good_parts_details = a.old_value->'good_parts_details',
       defective_parts_details = a.old_value->'defective_parts_details',
       updated_at = now()
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'ticket'
   AND a.action = 'repair'
   AND a.entity_id = t.id;

UPDATE public.installed_equipment e
   SET serial_no = a.old_value->>'serial_no', updated_at = now()
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'installed_equipment'
   AND a.action = 'repair'
   AND a.entity_id = e.id;

UPDATE public.indents i
   SET def_serial_no = a.old_value->>'def_serial_no',
       material_exchange_serial_no = a.old_value->>'material_exchange_serial_no',
       material_rec_serial_no = a.old_value->>'material_rec_serial_no',
       product_serial = a.old_value->>'product_serial',
       oracles_data = a.old_value->'oracles_data'
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'indent'
   AND a.action = 'repair'
   AND a.entity_id = i.id;

UPDATE public.grns g
   SET items = a.old_value->'items', updated_at = now()
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'grn'
   AND a.action = 'repair'
   AND a.entity_id = g.id;

UPDATE public.delivery_challans d
   SET items = a.old_value->'items', updated_at = now()
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'delivery_challan'
   AND a.action = 'repair'
   AND a.entity_id = d.id;

UPDATE public.general_delivery_challans d
   SET items = a.old_value->'items'
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'general_delivery_challan'
   AND a.action = 'repair'
   AND a.entity_id = d.id;

UPDATE public.gatepasses g
   SET items = a.old_value->'items'
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'gatepass'
   AND a.action = 'repair'
   AND a.entity_id = g.id;

-- ---------------------------------------------------------------------
-- 3. Re-insert tags removed by the safe dedupe.
-- ---------------------------------------------------------------------
INSERT INTO public.defective_tags
SELECT (jsonb_populate_record(NULL::public.defective_tags, a.old_value)).*
  FROM public.activity_log a
 WHERE a.source = 'repair_script'
   AND a.metadata->>'batch_id' = '20261022_placeholder_serials'
   AND a.entity = 'defective_tag'
   AND a.action = 'repair_delete'
   AND NOT EXISTS (
     SELECT 1 FROM public.defective_tags t
      WHERE t.id = (a.old_value->>'id')::uuid
   );

-- ---------------------------------------------------------------------
-- 4. Report restored counts (spot-check against Stage 0).
-- ---------------------------------------------------------------------
SELECT 'restored rows' AS stage, count(*) AS rows
  FROM public.activity_log
 WHERE source = 'repair_script'
   AND metadata->>'batch_id' = '20261022_placeholder_serials';

COMMIT;
