-- =====================================================================
-- FK-spine serial correction linkage (2026-10-22)
--
-- The existing correction RPCs update documents (indent/GRN/DC/ticket JSON)
-- but miss the tag / stock / transaction rows that feed the defective list.
-- This migration adds additive wrappers; the legacy RPCs remain callable.
--
-- Linkage order (never by the junk old serial alone):
--   indent/oracle -> GRN (indent_id + items[].oracle_no)
--                 -> stock (transaction_ref='GRN '||grn_no)
--                 -> txn (stock_item_id)
--                 -> tag (stock_item_id / txn_id / oracle_order_no)
--
-- Ambiguity or a conflicting real GRN serial is refused, so the wrapper and
-- the indent update roll back together. A correction with no GRN (indent
-- before GRN generation) applies to the indent and returns status='no_grn'.
--
-- RUN: supabase db push (DBA runs it; app code never writes DB)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.sync_serial_links_for_oracle(
  p_indent_id uuid,
  p_oracle_no text,
  p_slot text,
  p_old_serial text,
  p_new_serial text,
  p_model_no text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text := btrim(coalesce(p_old_serial, ''));
  v_new text := btrim(coalesce(p_new_serial, ''));
  v_model text := NULLIF(btrim(coalesce(p_model_no, '')), '');
  v_grn_id uuid;
  v_grn_no text;
  v_grn_category text;
  v_grn_serial text;
  v_grn_serial_key text := CASE WHEN p_slot = 'defective' THEN 'good_defective_serial' ELSE 'serial_no' END;
  v_grn_item_count int := 0;
  v_stock_count int := 0;
  v_stock_ids uuid[];
  v_stock_id uuid;
  v_txn_ids uuid[];
  v_tag_ids uuid[];
  v_changed_stock int := 0;
  v_changed_txn int := 0;
  v_changed_tag int := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can correct serial numbers';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for a serial correction';
  END IF;
  IF NOT public.is_identifying_serial(v_new) THEN
    RAISE EXCEPTION 'Serial correction refused: replacement serial must contain a letter or digit';
  END IF;

  -- Resolve exactly one GRN for this indent + oracle, preferring the document
  -- that actually posted inventory, and the slot's category when known.
  SELECT g.id, g.grn_no, g.category
    INTO v_grn_id, v_grn_no, v_grn_category
    FROM public.grns g
   WHERE g.indent_id = p_indent_id
     AND g.status NOT IN ('Cancelled', 'Rejected', 'Draft')
     AND (CASE
            WHEN p_slot = 'customer_received' THEN g.category = 'customer'
            WHEN p_slot = 'received' THEN g.category IN ('oem', 'general')
            ELSE TRUE
          END)
     AND EXISTS (
       SELECT 1
         FROM jsonb_array_elements(coalesce(g.items, '[]'::jsonb)) it
        WHERE it->>'oracle_no' = p_oracle_no
     )
   ORDER BY CASE g.status
              WHEN 'Submitted' THEN 0
              WHEN 'Approved' THEN 1
              WHEN 'Received' THEN 2
              WHEN 'QC Pending' THEN 3
              ELSE 4
            END,
            g.created_at DESC
   LIMIT 1;

  IF v_grn_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'no_grn',
      'indent_id', p_indent_id,
      'oracle_no', p_oracle_no,
      'slot', p_slot
    );
  END IF;

  -- Model is optional from the caller; derive it only when the GRN line is
  -- unambiguous. Never guess between different models.
  IF v_model IS NULL THEN
    SELECT min(btrim(it->>'model_no'))
      INTO v_model
      FROM public.grns g,
           jsonb_array_elements(coalesce(g.items, '[]'::jsonb)) it
     WHERE g.id = v_grn_id
       AND it->>'oracle_no' = p_oracle_no
       AND NULLIF(btrim(coalesce(it->>'model_no', '')), '') IS NOT NULL
    HAVING count(DISTINCT btrim(it->>'model_no')) = 1;
  END IF;

  SELECT count(*), it->>v_grn_serial_key
    INTO v_grn_item_count, v_grn_serial
    FROM public.grns g,
         jsonb_array_elements(coalesce(g.items, '[]'::jsonb)) it
   WHERE g.id = v_grn_id
     AND it->>'oracle_no' = p_oracle_no
     AND (v_model IS NULL OR upper(btrim(coalesce(it->>'model_no', ''))) = upper(v_model))
   GROUP BY it->>v_grn_serial_key
   LIMIT 1;

  -- The aggregate above returns one row per distinct serial value; count the
  -- actual matching item lines separately so two identical lines still fail.
  SELECT count(*)
    INTO v_grn_item_count
    FROM public.grns g,
         jsonb_array_elements(coalesce(g.items, '[]'::jsonb)) it
   WHERE g.id = v_grn_id
     AND it->>'oracle_no' = p_oracle_no
     AND (v_model IS NULL OR upper(btrim(coalesce(it->>'model_no', ''))) = upper(v_model));

  IF v_grn_item_count = 0 THEN
    RAISE EXCEPTION 'Serial correction refused: no GRN item for oracle % (model %) on GRN %',
      p_oracle_no, coalesce(v_model, '(any)'), v_grn_no;
  END IF;
  IF v_grn_item_count > 1 THEN
    RAISE EXCEPTION 'Serial correction refused: % GRN items match oracle % (model %) on GRN %; resolve the duplicate first',
      v_grn_item_count, p_oracle_no, coalesce(v_model, '(any)'), v_grn_no;
  END IF;

  -- A GRN that already carries a different real serial is the higher-trust
  -- document. Do not overwrite it from the indent; surface the conflict.
  IF public.is_identifying_serial(v_grn_serial)
     AND upper(btrim(v_grn_serial)) <> upper(v_new) THEN
    RAISE EXCEPTION 'Serial correction refused: GRN % already carries serial % for oracle %; correct the GRN first',
      v_grn_no, v_grn_serial, p_oracle_no;
  END IF;

  -- Find the stock row this GRN line produced. Exact serial match first;
  -- placeholder/NULL fallback only when the old value was not identifying.
  SELECT count(*), array_agg(s.id)
    INTO v_stock_count, v_stock_ids
    FROM public.ims_stock_items s
   WHERE s.transaction_ref = 'GRN ' || v_grn_no
     AND (v_model IS NULL OR upper(btrim(coalesce(s.part_model_no, ''))) = upper(v_model))
     AND (
       (public.is_identifying_serial(v_old)
         AND upper(btrim(coalesce(s.part_serial_no, ''))) = upper(v_old))
       OR (v_old = '' AND s.part_serial_no IS NULL)
       OR (public.is_placeholder_serial(v_old)
           AND (s.part_serial_no IS NULL OR public.is_placeholder_serial(s.part_serial_no)))
     );

  IF v_stock_count > 1 THEN
    RAISE EXCEPTION 'Serial correction refused: % stock rows match GRN % (model %, old serial %); candidates: %',
      v_stock_count, v_grn_no, coalesce(v_model, '(any)'), v_old, v_stock_ids;
  END IF;

  IF v_stock_count = 1 THEN
    v_stock_id := v_stock_ids[1];
    BEGIN
      PERFORM set_config('app.serial_propagation', 'on', true);
      UPDATE public.ims_stock_items
         SET part_serial_no = v_new,
             updated_at = now()
       WHERE id = v_stock_id
         AND (
           part_serial_no IS NULL
           OR public.is_placeholder_serial(part_serial_no)
           OR upper(btrim(part_serial_no)) = upper(v_old)
         );
      GET DIAGNOSTICS v_changed_stock = ROW_COUNT;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'Serial correction refused: serial % already exists on another stock row', v_new;
    END;
  END IF;

  PERFORM set_config('app.serial_propagation', 'on', true);

  UPDATE public.ims_transactions
     SET part_serial_no = v_new
   WHERE (v_stock_id IS NOT NULL AND stock_item_id = v_stock_id)
      OR (reference = 'GRN ' || v_grn_no
          AND indent_id = p_indent_id
          AND (
            part_serial_no IS NULL
            OR public.is_placeholder_serial(part_serial_no)
            OR upper(btrim(part_serial_no)) = upper(v_old)
          ));
  GET DIAGNOSTICS v_changed_txn = ROW_COUNT;

  SELECT array_agg(id)
    INTO v_txn_ids
    FROM public.ims_transactions
   WHERE (v_stock_id IS NOT NULL AND stock_item_id = v_stock_id)
      OR (reference = 'GRN ' || v_grn_no AND indent_id = p_indent_id);

  UPDATE public.defective_tags
     SET serial_no = v_new,
         updated_at = now()
   WHERE (v_stock_id IS NOT NULL AND stock_item_id = v_stock_id)
      OR (v_txn_ids IS NOT NULL AND txn_id = ANY(v_txn_ids))
      OR (oracle_order_no = p_oracle_no
          AND (v_model IS NULL OR upper(btrim(coalesce(model_no, ''))) = upper(v_model))
          AND (
            serial_no IS NULL
            OR public.is_placeholder_serial(serial_no)
            OR upper(btrim(serial_no)) = upper(v_old)
          ));
  GET DIAGNOSTICS v_changed_tag = ROW_COUNT;

  SELECT array_agg(id)
    INTO v_tag_ids
    FROM public.defective_tags
   WHERE (v_stock_id IS NOT NULL AND stock_item_id = v_stock_id)
      OR (v_txn_ids IS NOT NULL AND txn_id = ANY(v_txn_ids))
      OR (oracle_order_no = p_oracle_no
          AND (v_model IS NULL OR upper(btrim(coalesce(model_no, ''))) = upper(v_model)));

  -- The GRN item follows only when it had no real identity (or still held the
  -- old value). A different real serial was refused above.
  IF NOT public.is_identifying_serial(v_grn_serial)
     OR upper(btrim(v_grn_serial)) = upper(v_old) THEN
    UPDATE public.grns g
       SET items = (
             SELECT coalesce(jsonb_agg(
               CASE
                 WHEN it->>'oracle_no' = p_oracle_no
                  AND (v_model IS NULL OR upper(btrim(coalesce(it->>'model_no', ''))) = upper(v_model))
                 THEN public.serial_strip_placeholder_in_item(
                        jsonb_set(it, ARRAY[v_grn_serial_key], to_jsonb(v_new), true)
                      )
                 ELSE it
               END
             ), '[]'::jsonb)
             FROM jsonb_array_elements(coalesce(g.items, '[]'::jsonb)) it
           ),
           updated_at = now()
     WHERE g.id = v_grn_id;
  END IF;

  PERFORM public.log_activity(
    'ims', 'serial_correction', p_indent_id, 'serial_correction',
    jsonb_build_object(
      'oracle_no', p_oracle_no, 'slot', p_slot,
      'old_serial', v_old, 'grn_no', v_grn_no
    ),
    jsonb_build_object(
      'oracle_no', p_oracle_no, 'slot', p_slot,
      'new_serial', v_new, 'grn_no', v_grn_no
    ),
    p_reason, p_oracle_no, 'rpc', 'critical',
    jsonb_build_object(
      'grn_id', v_grn_id,
      'stock_id', v_stock_id,
      'txn_ids', v_txn_ids,
      'tag_ids', v_tag_ids,
      'changed_stock', v_changed_stock,
      'changed_txn', v_changed_txn,
      'changed_tag', v_changed_tag
    )
  );

  RETURN jsonb_build_object(
    'status', 'applied',
    'grn_id', v_grn_id,
    'grn_no', v_grn_no,
    'stock_id', v_stock_id,
    'txn_ids', coalesce(v_txn_ids, '{}'::uuid[]),
    'tag_ids', coalesce(v_tag_ids, '{}'::uuid[]),
    'changed_stock', v_changed_stock,
    'changed_txn', v_changed_txn,
    'changed_tag', v_changed_tag
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_oracle_slot_linked(
  _indent_id uuid,
  _oracle_no text,
  _slot text,
  _old_serial text,
  _new_serial text,
  _reason text,
  _sync_ticket boolean DEFAULT true,
  _sync_doc boolean DEFAULT false,
  _model_no text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_placeholder_serial(_new_serial) OR NOT public.is_identifying_serial(_new_serial) THEN
    RAISE EXCEPTION 'Serial correction refused: replacement serial must contain a letter or digit';
  END IF;

  -- Legacy document/indent/ticket update, then the FK-spine satellite sync.
  -- Any exception from the sync rolls back the whole transaction.
  PERFORM public.correct_oracle_slot(
    _indent_id, _oracle_no, _slot, _old_serial, _new_serial, _reason,
    _sync_ticket, _sync_doc
  );

  RETURN public.sync_serial_links_for_oracle(
    _indent_id, _oracle_no, _slot, _old_serial, _new_serial, _model_no, _reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.correct_grn_serial_linked(
  _grn_id uuid,
  _old_serial text,
  _new_serial text,
  _reason text,
  _oracle_no text DEFAULT NULL,
  _scope text DEFAULT 'document',
  _model_no text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_indent_id uuid;
  v_category text;
  v_slot text;
BEGIN
  IF public.is_placeholder_serial(_new_serial) OR NOT public.is_identifying_serial(_new_serial) THEN
    RAISE EXCEPTION 'Serial correction refused: replacement serial must contain a letter or digit';
  END IF;

  PERFORM public.correct_grn_serial(
    _grn_id, _old_serial, _new_serial, _reason, _oracle_no, _scope
  );

  SELECT indent_id, category
    INTO v_indent_id, v_category
    FROM public.grns
   WHERE id = _grn_id;

  IF v_indent_id IS NULL OR _oracle_no IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'grn_only',
      'grn_id', _grn_id,
      'reason', 'GRN has no indent/oracle anchor; stock row was handled by correct_grn_serial'
    );
  END IF;

  v_slot := CASE WHEN v_category = 'customer' THEN 'customer_received' ELSE 'received' END;

  RETURN public.sync_serial_links_for_oracle(
    v_indent_id, _oracle_no, v_slot, _old_serial, _new_serial, _model_no, _reason
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_serial_links_for_oracle(uuid, text, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_oracle_slot_linked(uuid, text, text, text, text, text, boolean, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.correct_grn_serial_linked(uuid, text, text, text, text, text, text) TO authenticated, service_role;
