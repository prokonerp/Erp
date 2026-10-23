-- =====================================================================
-- Read-only placeholder-serial report (2026-10-22)
--
-- One row per punctuation-only serial found in any serial-bearing source.
-- This is the dry-run / repair queue. It never writes.
--
-- security_invoker=true: underlying RLS applies to the caller. Run as an
-- admin/service role to see the whole database.
--
-- RUN: supabase db push (DBA runs it; app code never writes DB)
-- =====================================================================

CREATE OR REPLACE VIEW public.v_placeholder_serial_report
WITH (security_invoker = true)
AS
-- ---------------------------------------------------------------------
-- defective_tags
-- ---------------------------------------------------------------------
SELECT
  'defective_tags'::text AS source_table,
  'serial_no'::text AS source_column,
  t.id AS row_id,
  NULL::int AS element_index,
  t.oracle_order_no::text AS entity_ref,
  t.model_no::text AS model_no,
  t.serial_no::text AS raw_value,
  public.normalize_serial_key(t.model_no, t.serial_no) AS normalized_key,
  'tags'::text AS repair_stage,
  true AS safe_to_auto_repair
FROM public.defective_tags t
WHERE public.is_placeholder_serial(t.serial_no)

UNION ALL
-- ---------------------------------------------------------------------
-- ims_stock_items
-- ---------------------------------------------------------------------
SELECT
  'ims_stock_items', 'part_serial_no', s.id, NULL,
  s.transaction_ref, s.part_model_no, s.part_serial_no,
  public.normalize_serial_key(s.part_model_no, s.part_serial_no),
  'stock',
  (count(*) OVER (PARTITION BY s.transaction_ref) = 1)
FROM public.ims_stock_items s
WHERE public.is_placeholder_serial(s.part_serial_no)

UNION ALL
-- ---------------------------------------------------------------------
-- ims_transactions
-- ---------------------------------------------------------------------
SELECT
  'ims_transactions', 'part_serial_no', x.id, NULL,
  x.reference, x.part_model_no, x.part_serial_no,
  public.normalize_serial_key(x.part_model_no, x.part_serial_no),
  'txns',
  (count(*) OVER (PARTITION BY x.reference) = 1)
FROM public.ims_transactions x
WHERE public.is_placeholder_serial(x.part_serial_no)

UNION ALL
-- ---------------------------------------------------------------------
-- tickets.serial_no
-- ---------------------------------------------------------------------
SELECT
  'tickets', 'serial_no', t.id, NULL,
  t.case_id, NULL::text, t.serial_no,
  public.normalize_serial_key(NULL, t.serial_no),
  'tickets', true
FROM public.tickets t
WHERE public.is_placeholder_serial(t.serial_no)

UNION ALL
-- ---------------------------------------------------------------------
-- tickets.defective_parts_details[].serial
-- ---------------------------------------------------------------------
SELECT
  'tickets', 'defective_parts_details[].serial', t.id, (elem.ord - 1)::int,
  t.case_id, elem.value->>'model', elem.value->>'serial',
  public.normalize_serial_key(elem.value->>'model', elem.value->>'serial'),
  'tickets', true
FROM public.tickets t,
     jsonb_array_elements(coalesce(t.defective_parts_details, '[]'::jsonb))
       WITH ORDINALITY AS elem(value, ord)
WHERE public.is_placeholder_serial(elem.value->>'serial')

UNION ALL
-- ---------------------------------------------------------------------
-- indents typed serial columns
-- ---------------------------------------------------------------------
SELECT
  'indents', v.col, i.id, NULL,
  i.indent_no, NULL::text, v.val,
  public.normalize_serial_key(NULL, v.val),
  'indents', true
FROM public.indents i
CROSS JOIN LATERAL (
  VALUES
    ('def_serial_no', i.def_serial_no),
    ('material_exchange_serial_no', i.material_exchange_serial_no),
    ('material_rec_serial_no', i.material_rec_serial_no),
    ('product_serial', i.product_serial)
) AS v(col, val)
WHERE public.is_placeholder_serial(v.val)

UNION ALL
-- ---------------------------------------------------------------------
-- indents.oracles_data slots
-- ---------------------------------------------------------------------
SELECT
  'indents',
  slot.arr || '[]' || slot.key,
  i.id,
  (elem.ord - 1)::int,
  i.indent_no,
  elem.value->>slot.model_key,
  elem.value->>slot.key,
  public.normalize_serial_key(elem.value->>slot.model_key, elem.value->>slot.key),
  'indents', true
FROM public.indents i
CROSS JOIN LATERAL (
  VALUES
    ('defective_rows', 'def_serial_no', 'def_model_no'),
    ('exchange_rows', 'serial_no', 'model_no'),
    ('received_rows', 'serial_no', 'model_no'),
    ('customer_received_rows', 'serial_no', 'model_no')
) AS slot(arr, key, model_key)
CROSS JOIN LATERAL jsonb_array_elements(
  coalesce(i.oracles_data->slot.arr, '[]'::jsonb)
) WITH ORDINALITY AS elem(value, ord)
WHERE public.is_placeholder_serial(elem.value->>slot.key)

UNION ALL
-- ---------------------------------------------------------------------
-- grns.items[].serial_no
-- ---------------------------------------------------------------------
SELECT
  'grns', 'items[].serial_no', g.id, (elem.ord - 1)::int,
  g.grn_no, elem.value->>'model_no', elem.value->>'serial_no',
  public.normalize_serial_key(elem.value->>'model_no', elem.value->>'serial_no'),
  'grns', true
FROM public.grns g,
     jsonb_array_elements(coalesce(g.items, '[]'::jsonb))
       WITH ORDINALITY AS elem(value, ord)
WHERE public.is_placeholder_serial(elem.value->>'serial_no')

UNION ALL
-- ---------------------------------------------------------------------
-- grns.items[].good_defective_serial
-- ---------------------------------------------------------------------
SELECT
  'grns', 'items[].good_defective_serial', g.id, (elem.ord - 1)::int,
  g.grn_no, elem.value->>'model_no', elem.value->>'good_defective_serial',
  public.normalize_serial_key(elem.value->>'model_no', elem.value->>'good_defective_serial'),
  'grns', true
FROM public.grns g,
     jsonb_array_elements(coalesce(g.items, '[]'::jsonb))
       WITH ORDINALITY AS elem(value, ord)
WHERE public.is_placeholder_serial(elem.value->>'good_defective_serial')

UNION ALL
-- ---------------------------------------------------------------------
-- delivery_challans.items[] serial fields
-- ---------------------------------------------------------------------
SELECT
  'delivery_challans', 'items[].serial_no', d.id, (elem.ord - 1)::int,
  d.challan_no, elem.value->>'model_no', elem.value->>'serial_no',
  public.normalize_serial_key(elem.value->>'model_no', elem.value->>'serial_no'),
  'dcs', true
FROM public.delivery_challans d,
     jsonb_array_elements(coalesce(d.items, '[]'::jsonb))
       WITH ORDINALITY AS elem(value, ord)
WHERE public.is_placeholder_serial(elem.value->>'serial_no')

UNION ALL
SELECT
  'delivery_challans', 'items[].good_serial', d.id, (elem.ord - 1)::int,
  d.challan_no, elem.value->>'model_no', elem.value->>'good_serial',
  public.normalize_serial_key(elem.value->>'model_no', elem.value->>'good_serial'),
  'dcs', true
FROM public.delivery_challans d,
     jsonb_array_elements(coalesce(d.items, '[]'::jsonb))
       WITH ORDINALITY AS elem(value, ord)
WHERE public.is_placeholder_serial(elem.value->>'good_serial')

UNION ALL
SELECT
  'delivery_challans', 'items[].defective_serial', d.id, (elem.ord - 1)::int,
  d.challan_no, elem.value->>'model_no', elem.value->>'defective_serial',
  public.normalize_serial_key(elem.value->>'model_no', elem.value->>'defective_serial'),
  'dcs', true
FROM public.delivery_challans d,
     jsonb_array_elements(coalesce(d.items, '[]'::jsonb))
       WITH ORDINALITY AS elem(value, ord)
WHERE public.is_placeholder_serial(elem.value->>'defective_serial')

UNION ALL
-- ---------------------------------------------------------------------
-- installed_equipment
-- ---------------------------------------------------------------------
SELECT
  'installed_equipment', 'serial_no', e.id, NULL,
  e.invoice_no, e.model_no, e.serial_no,
  public.normalize_serial_key(e.model_no, e.serial_no),
  'installed_equipment', true
FROM public.installed_equipment e
WHERE public.is_placeholder_serial(e.serial_no)

UNION ALL
-- ---------------------------------------------------------------------
-- serials catalog
-- ---------------------------------------------------------------------
SELECT
  'serials', 'serial_number', s.id, NULL,
  s.serial_number, NULL::text, s.serial_number,
  public.normalize_serial_key(NULL, s.serial_number),
  'serials', true
FROM public.serials s
WHERE public.is_placeholder_serial(s.serial_number)

UNION ALL
-- ---------------------------------------------------------------------
-- invoice_items.serial_numbers[]
-- ---------------------------------------------------------------------
SELECT
  'invoice_items', 'serial_numbers[]', ii.id, (elem.ord - 1)::int,
  ii.id::text, NULL::text, elem.value,
  public.normalize_serial_key(NULL, elem.value),
  'invoice_items', true
FROM public.invoice_items ii,
     unnest(coalesce(ii.serial_numbers, ARRAY[]::text[]))
       WITH ORDINALITY AS elem(value, ord)
WHERE public.is_placeholder_serial(elem.value);

GRANT SELECT ON public.v_placeholder_serial_report TO authenticated, service_role;
