-- =====================================================================
-- Placeholder-serial repair — HUMAN RUN, staged
--
-- Replaces punctuation-only serials with the "unknown / pooled" value:
--   stock / transactions / installed_equipment : NULL
--   tags / tickets / indent typed serials      : ''
--   document JSON item fields                  : ''
--
-- Never guesses a serial. Never deletes a document item. Never touches qty.
-- Every changed row is snapshotted into activity_log (source='repair_script',
-- severity='critical', metadata.batch_id='20261022_placeholder_serials').
--
-- serials.serial_number is NOT NULL + uniquely indexed, so a placeholder
-- there cannot be blanked automatically; it is reported by the view for
-- manual resolution. invoice_items.serial_numbers is also only reported
-- (its trigger has stock side effects) — clean it manually if needed.
--
-- RUN: entire file in Supabase SQL Editor (it has BEGIN/COMMIT), or
--      psql "$DATABASE_URL" -f supabase/repair_placeholder_serials.sql
-- ROLLBACK: supabase/repair_placeholder_serials_rollback.sql
--
-- PREREQUISITE ORDER (do not skip):
--   1. apply migrations 20261022000000 .. 20261022000006
--   2. run THIS file
--   3. apply 20261023000000_serial_constraints.sql LAST
-- =====================================================================

BEGIN;

SET LOCAL app.serial_propagation = 'on';

-- ---------------------------------------------------------------------
-- Stage 0 — report before
-- ---------------------------------------------------------------------
SELECT 'before: defective_tags' AS stage, count(*) AS offenders
  FROM public.defective_tags WHERE public.is_placeholder_serial(serial_no)
UNION ALL SELECT 'before: ims_stock_items', count(*)
  FROM public.ims_stock_items WHERE public.is_placeholder_serial(part_serial_no)
UNION ALL SELECT 'before: ims_transactions', count(*)
  FROM public.ims_transactions WHERE public.is_placeholder_serial(part_serial_no)
UNION ALL SELECT 'before: ims_transfers', count(*)
  FROM public.ims_transfers WHERE public.is_placeholder_serial(part_serial_no)
UNION ALL SELECT 'before: tickets.serial_no', count(*)
  FROM public.tickets WHERE public.is_placeholder_serial(serial_no)
UNION ALL SELECT 'before: installed_equipment', count(*)
  FROM public.installed_equipment WHERE public.is_placeholder_serial(serial_no)
UNION ALL SELECT 'before: indents typed', count(*)
  FROM public.indents
 WHERE public.is_placeholder_serial(def_serial_no)
    OR public.is_placeholder_serial(material_exchange_serial_no)
    OR public.is_placeholder_serial(material_rec_serial_no)
    OR public.is_placeholder_serial(product_serial)
UNION ALL SELECT 'before: grns.items', count(*)
  FROM public.grns WHERE items::text ~ '"[.,]+"'
UNION ALL SELECT 'before: delivery_challans.items', count(*)
  FROM public.delivery_challans WHERE items::text ~ '"[.,]+"'
UNION ALL SELECT 'before: general_delivery_challans.items', count(*)
  FROM public.general_delivery_challans WHERE items::text ~ '"[.,]+"'
UNION ALL SELECT 'before: gatepasses.items', count(*)
  FROM public.gatepasses WHERE items::text ~ '"[.,]+"'
UNION ALL SELECT 'before: tickets.parts_json', count(*)
  FROM public.tickets
 WHERE good_parts_details::text ~ '"[.,]+"'
    OR defective_parts_details::text ~ '"[.,]+"'
UNION ALL SELECT 'before: indents.oracles_data', count(*)
  FROM public.indents WHERE oracles_data::text ~ '"[.,]+"'
ORDER BY 1;

-- ---------------------------------------------------------------------
-- Stage 1 — defective_tags
-- ---------------------------------------------------------------------
INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'defective_tag', t.id, t.oracle_order_no, 'repair', 'migration',
       'Repair: placeholder serial cleared', to_jsonb(t),
       jsonb_build_object('serial_no', ''),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'tags')
  FROM public.defective_tags t
 WHERE public.is_placeholder_serial(t.serial_no);

UPDATE public.defective_tags
   SET serial_no = '', updated_at = now()
 WHERE public.is_placeholder_serial(serial_no);

-- ---------------------------------------------------------------------
-- Stage 2 — ims_stock_items
-- ---------------------------------------------------------------------
INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'ims_stock_item', s.id, s.transaction_ref, 'repair', 'migration',
       'Repair: placeholder stock serial pooled (NULL)', to_jsonb(s),
       jsonb_build_object('part_serial_no', NULL),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'stock')
  FROM public.ims_stock_items s
 WHERE public.is_placeholder_serial(s.part_serial_no);

UPDATE public.ims_stock_items
   SET part_serial_no = NULL, updated_at = now()
 WHERE public.is_placeholder_serial(part_serial_no);

-- ---------------------------------------------------------------------
-- Stage 3 — ims_transactions
-- ---------------------------------------------------------------------
INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'ims_transaction', x.id, x.reference, 'repair', 'migration',
       'Repair: placeholder transaction serial pooled (NULL)', to_jsonb(x),
       jsonb_build_object('part_serial_no', NULL),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'txns')
  FROM public.ims_transactions x
 WHERE public.is_placeholder_serial(x.part_serial_no);

UPDATE public.ims_transactions
   SET part_serial_no = NULL
 WHERE public.is_placeholder_serial(part_serial_no);

-- ---------------------------------------------------------------------
-- Stage 4 — ims_transfers
-- ---------------------------------------------------------------------
INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'ims_transfer', t.id, t.id::text, 'repair', 'migration',
       'Repair: placeholder transfer serial pooled (NULL)', to_jsonb(t),
       jsonb_build_object('part_serial_no', NULL),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'transfers')
  FROM public.ims_transfers t
 WHERE public.is_placeholder_serial(t.part_serial_no);

UPDATE public.ims_transfers
   SET part_serial_no = NULL
 WHERE public.is_placeholder_serial(part_serial_no);

-- ---------------------------------------------------------------------
-- Stage 5 — tickets.serial_no + installed_equipment
-- ---------------------------------------------------------------------
INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'ticket', t.id, t.case_id, 'repair', 'migration',
       'Repair: placeholder ticket serial cleared', to_jsonb(t),
       jsonb_build_object('serial_no', ''),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'tickets')
  FROM public.tickets t
 WHERE public.is_placeholder_serial(t.serial_no);

UPDATE public.tickets
   SET serial_no = '', updated_at = now()
 WHERE public.is_placeholder_serial(serial_no);

INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'installed_equipment', e.id, e.invoice_no, 'repair', 'migration',
       'Repair: placeholder installed-equipment serial pooled (NULL)', to_jsonb(e),
       jsonb_build_object('serial_no', NULL),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'installed_equipment')
  FROM public.installed_equipment e
 WHERE public.is_placeholder_serial(e.serial_no);

UPDATE public.installed_equipment
   SET serial_no = NULL, updated_at = now()
 WHERE public.is_placeholder_serial(serial_no);

-- ---------------------------------------------------------------------
-- Stage 6 — indents typed serial columns
-- ---------------------------------------------------------------------
INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'indent', i.id, i.indent_no, 'repair', 'migration',
       'Repair: placeholder indent typed serial cleared', to_jsonb(i),
       jsonb_build_object('typed_serials', 'cleared'),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'indents_typed')
  FROM public.indents i
 WHERE public.is_placeholder_serial(i.def_serial_no)
    OR public.is_placeholder_serial(i.material_exchange_serial_no)
    OR public.is_placeholder_serial(i.material_rec_serial_no)
    OR public.is_placeholder_serial(i.product_serial);

UPDATE public.indents
   SET def_serial_no = CASE WHEN public.is_placeholder_serial(def_serial_no) THEN '' ELSE def_serial_no END,
       material_exchange_serial_no = CASE WHEN public.is_placeholder_serial(material_exchange_serial_no) THEN '' ELSE material_exchange_serial_no END,
       material_rec_serial_no = CASE WHEN public.is_placeholder_serial(material_rec_serial_no) THEN '' ELSE material_rec_serial_no END,
       product_serial = CASE WHEN public.is_placeholder_serial(product_serial) THEN '' ELSE product_serial END
 WHERE public.is_placeholder_serial(def_serial_no)
    OR public.is_placeholder_serial(material_exchange_serial_no)
    OR public.is_placeholder_serial(material_rec_serial_no)
    OR public.is_placeholder_serial(product_serial);

-- ---------------------------------------------------------------------
-- Stage 7 — document JSON item arrays
-- ---------------------------------------------------------------------
INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'grn', g.id, g.grn_no, 'repair', 'migration',
       'Repair: placeholder serial token stripped from GRN items', to_jsonb(g),
       jsonb_build_object('items', public.serial_strip_placeholder_in_object_array(g.items)),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'grns')
  FROM public.grns g
 WHERE g.items::text ~ '"[.,]+"';

UPDATE public.grns
   SET items = public.serial_strip_placeholder_in_object_array(items),
       updated_at = now()
 WHERE items::text ~ '"[.,]+"';

INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'delivery_challan', d.id, d.challan_no, 'repair', 'migration',
       'Repair: placeholder serial token stripped from DC items', to_jsonb(d),
       jsonb_build_object('items', public.serial_strip_placeholder_in_object_array(d.items)),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'dcs')
  FROM public.delivery_challans d
 WHERE d.items::text ~ '"[.,]+"';

UPDATE public.delivery_challans
   SET items = public.serial_strip_placeholder_in_object_array(items),
       updated_at = now()
 WHERE items::text ~ '"[.,]+"';

INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'general_delivery_challan', g.id, g.id::text, 'repair', 'migration',
       'Repair: placeholder serial token stripped from general DC items', to_jsonb(g),
       jsonb_build_object('items', public.serial_strip_placeholder_in_object_array(g.items)),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'general_dcs')
  FROM public.general_delivery_challans g
 WHERE g.items::text ~ '"[.,]+"';

UPDATE public.general_delivery_challans
   SET items = public.serial_strip_placeholder_in_object_array(items)
 WHERE items::text ~ '"[.,]+"';

INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'gatepass', g.id, g.id::text, 'repair', 'migration',
       'Repair: placeholder serial token stripped from gatepass items', to_jsonb(g),
       jsonb_build_object('items', public.serial_strip_placeholder_in_object_array(g.items)),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'gatepasses')
  FROM public.gatepasses g
 WHERE g.items::text ~ '"[.,]+"';

UPDATE public.gatepasses
   SET items = public.serial_strip_placeholder_in_object_array(items)
 WHERE items::text ~ '"[.,]+"';

INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'ticket', t.id, t.case_id, 'repair', 'migration',
       'Repair: placeholder serial token stripped from ticket parts JSON', to_jsonb(t),
       jsonb_build_object(
         'good_parts_details', public.serial_strip_placeholder_in_object_array(t.good_parts_details),
         'defective_parts_details', public.serial_strip_placeholder_in_object_array(t.defective_parts_details)
       ),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'ticket_parts_json')
  FROM public.tickets t
 WHERE t.good_parts_details::text ~ '"[.,]+"'
    OR t.defective_parts_details::text ~ '"[.,]+"';

UPDATE public.tickets
   SET good_parts_details = public.serial_strip_placeholder_in_object_array(good_parts_details),
       defective_parts_details = public.serial_strip_placeholder_in_object_array(defective_parts_details),
       updated_at = now()
 WHERE good_parts_details::text ~ '"[.,]+"'
    OR defective_parts_details::text ~ '"[.,]+"';

-- oracles_data is cleaned by trg_sanitize_indent_oracle_serials; a no-op
-- update fires the BEFORE trigger.
INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, new_value, source, severity, metadata
)
SELECT 'system', 'indent', i.id, i.indent_no, 'repair', 'migration',
       'Repair: placeholder serial token stripped from oracle JSON', to_jsonb(i),
       jsonb_build_object('oracles_data', 'sanitized by trigger'),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'indents_oracles')
  FROM public.indents i
 WHERE i.oracles_data::text ~ '"[.,]+"';

UPDATE public.indents
   SET oracles_data = oracles_data
 WHERE oracles_data::text ~ '"[.,]+"';

-- ---------------------------------------------------------------------
-- Stage 8 — safe duplicate-tag dedupe
-- Only groups where every row is tied to the same non-NULL stock_item_id
-- (proof they describe one physical unit). Groups with NULL/unshared stock
-- links are left for manual review — two distinct units can share a serial.
-- ---------------------------------------------------------------------
WITH groups AS (
  SELECT lower(btrim(coalesce(model_no, ''))) AS m,
         lower(btrim(coalesce(serial_no, ''))) AS s,
         count(*) AS cnt,
         count(*) FILTER (WHERE stock_item_id IS NOT NULL) AS stock_nonnull,
         count(DISTINCT coalesce(oem_case_id::text, '')) AS oem_variants,
         count(DISTINCT coalesce(stock_item_id::text, '')) AS stock_variants
    FROM public.defective_tags
   WHERE btrim(coalesce(serial_no, '')) <> ''
   GROUP BY 1, 2
),
ranked AS (
  SELECT t.*,
         row_number() OVER (
           PARTITION BY lower(btrim(coalesce(t.model_no, ''))),
                        lower(btrim(coalesce(t.serial_no, '')))
           ORDER BY (t.stock_item_id IS NOT NULL) DESC,
                    (t.txn_id IS NOT NULL) DESC,
                    t.created_at ASC
         ) AS rn
    FROM public.defective_tags t
    JOIN groups g
      ON g.m = lower(btrim(coalesce(t.model_no, '')))
     AND g.s = lower(btrim(coalesce(t.serial_no, '')))
   WHERE g.cnt > 1
     AND g.oem_variants <= 1
     AND g.stock_variants = 1
     AND g.stock_nonnull = g.cnt
),
victims AS (
  SELECT * FROM ranked WHERE rn > 1
),
del AS (
  DELETE FROM public.defective_tags t
   USING victims v
   WHERE t.id = v.id
  RETURNING t.*
)
INSERT INTO public.activity_log(
  module, entity, entity_id, entity_ref, action, actor_kind,
  reason, old_value, source, severity, metadata
)
SELECT 'system', 'defective_tag', d.id, d.oracle_order_no, 'repair_delete', 'migration',
       'Repair: duplicate tag removed (safe group)', to_jsonb(d),
       'repair_script', 'critical',
       jsonb_build_object('batch_id', '20261022_placeholder_serials', 'stage', 'tag_dedupe')
  FROM del d;

-- ---------------------------------------------------------------------
-- Stage 9 — report after
-- ---------------------------------------------------------------------
SELECT 'after: defective_tags' AS stage, count(*) AS offenders
  FROM public.defective_tags WHERE public.is_placeholder_serial(serial_no)
UNION ALL SELECT 'after: ims_stock_items', count(*)
  FROM public.ims_stock_items WHERE public.is_placeholder_serial(part_serial_no)
UNION ALL SELECT 'after: ims_transactions', count(*)
  FROM public.ims_transactions WHERE public.is_placeholder_serial(part_serial_no)
UNION ALL SELECT 'after: ims_transfers', count(*)
  FROM public.ims_transfers WHERE public.is_placeholder_serial(part_serial_no)
UNION ALL SELECT 'after: tickets.serial_no', count(*)
  FROM public.tickets WHERE public.is_placeholder_serial(serial_no)
UNION ALL SELECT 'after: installed_equipment', count(*)
  FROM public.installed_equipment WHERE public.is_placeholder_serial(serial_no)
UNION ALL SELECT 'after: indents typed', count(*)
  FROM public.indents
 WHERE public.is_placeholder_serial(def_serial_no)
    OR public.is_placeholder_serial(material_exchange_serial_no)
    OR public.is_placeholder_serial(material_rec_serial_no)
    OR public.is_placeholder_serial(product_serial)
UNION ALL SELECT 'after: grns.items', count(*)
  FROM public.grns WHERE items::text ~ '"[.,]+"'
UNION ALL SELECT 'after: delivery_challans.items', count(*)
  FROM public.delivery_challans WHERE items::text ~ '"[.,]+"'
UNION ALL SELECT 'after: general_delivery_challans.items', count(*)
  FROM public.general_delivery_challans WHERE items::text ~ '"[.,]+"'
UNION ALL SELECT 'after: gatepasses.items', count(*)
  FROM public.gatepasses WHERE items::text ~ '"[.,]+"'
UNION ALL SELECT 'after: tickets.parts_json', count(*)
  FROM public.tickets
 WHERE good_parts_details::text ~ '"[.,]+"'
    OR defective_parts_details::text ~ '"[.,]+"'
UNION ALL SELECT 'after: indents.oracles_data', count(*)
  FROM public.indents WHERE oracles_data::text ~ '"[.,]+"'
ORDER BY 1;

-- Manual review queue (expected to be empty except serials/invoice_items,
-- which this script intentionally leaves alone).
SELECT * FROM public.v_placeholder_serial_report
 WHERE repair_stage NOT IN ('serials', 'invoice_items')
 ORDER BY source_table, row_id;

-- Duplicate real (model, serial) groups still block the UNIQUE index in
-- 20261023000000. Review these; correct one serial per group. Distinct physical
-- units that genuinely share a serial must be resolved by the operator.
SELECT lower(btrim(coalesce(model_no, ''))) AS model_key,
       lower(btrim(coalesce(serial_no, ''))) AS serial_key,
       count(*) AS tag_rows,
       array_agg(tag_no ORDER BY created_at) AS tag_nos
  FROM public.defective_tags
 WHERE btrim(coalesce(serial_no, '')) <> ''
 GROUP BY 1, 2
HAVING count(*) > 1
 ORDER BY 1, 2;

COMMIT;
