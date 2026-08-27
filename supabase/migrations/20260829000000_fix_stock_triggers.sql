-- =====================================================================
-- Fixes for stock-posting triggers (S1)
-- These CREATE OR REPLACE the existing functions so the fixes apply to
-- already-running databases. Signatures match supabase/setup_new_supabase.sql.
-- 1a. GRN serialized intake must create one stock row per serial.
-- 1b. GRN/IMS backfill must honour the per-row warehouse_id.
-- 1c. Delivery Challan must be one-shot + use the line's warehouse.
-- 1d. assert_items_frozen_after_post must freeze as soon as stock is posted.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a + 1b: grn_post_inventory
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grn_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  cond TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  new_id UUID;
  serial_list TEXT[];
  s TEXT;
  remainder NUMERIC;
  wh UUID;
BEGIN
  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      cond       := lower(btrim(COALESCE(it->>'condition','')));
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      -- 1b: honour the per-row warehouse, fall back to the document warehouse.
      wh := CASE WHEN NULLIF(btrim(COALESCE(it->>'warehouse_id','')),'') ~ '^[0-9a-fA-F-]{36}$'
           THEN NULLIF(btrim(COALESCE(it->>'warehouse_id','')),'')::uuid
           ELSE NEW.warehouse_id
      END;

      IF cond NOT IN ('good','defective','scrap') THEN
        RAISE EXCEPTION 'GRN %: line item "%" has an invalid or missing condition (%). Allowed values: Good, Defective, Scrap.',
          NEW.grn_no, COALESCE(part_name_v, model, '(unnamed)'), COALESCE(NULLIF(cond,''),'empty');
      END IF;

      IF cond = 'good' THEN
        target_type := 'good'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'good_in'::public.ims_txn_type;
      ELSIF cond = 'defective' THEN
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      ELSE
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'scrapped'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      END IF;

      -- 1a: expand a JSON serials array into one row per serial; fall back to the
      -- comma-joined serial_no only when `serials` is absent.
      IF jsonb_typeof(it->'serials') = 'array' THEN
        SELECT array_agg(btrim(x)) INTO serial_list
        FROM jsonb_array_elements_text(it->'serials') AS x
        WHERE btrim(x) <> '';
      ELSIF serial IS NOT NULL THEN
        SELECT array_agg(btrim(x)) INTO serial_list
        FROM unnest(string_to_array(serial, ',')) AS x
        WHERE btrim(x) <> '';
      ELSE
        serial_list := NULL;
      END IF;

      IF serial_list IS NOT NULL AND array_length(serial_list, 1) > 0 THEN
        FOREACH s IN ARRAY serial_list LOOP
          INSERT INTO public.ims_stock_items(
            oem, part_name, part_model_no, part_serial_no, warehouse_id,
            stock_type, stock_status, qty, transaction_ref, notes, created_by
          ) VALUES (
            oem_v, COALESCE(part_name_v,'(unnamed)'), model, s, wh,
            target_type, target_status, 1, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
          )
          ON CONFLICT (part_serial_no) DO UPDATE SET
            warehouse_id    = EXCLUDED.warehouse_id,
            stock_type      = EXCLUDED.stock_type,
            stock_status    = EXCLUDED.stock_status,
            qty             = 1,
            part_name       = COALESCE(EXCLUDED.part_name, public.ims_stock_items.part_name),
            part_model_no   = COALESCE(EXCLUDED.part_model_no, public.ims_stock_items.part_model_no),
            oem             = COALESCE(EXCLUDED.oem, public.ims_stock_items.oem),
            transaction_ref = EXCLUDED.transaction_ref,
            updated_at      = now()
          RETURNING id INTO new_id;

          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
          ) VALUES (
            txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, s, oem_v,
            wh,
            COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
            1, NEW.indent_id, 'GRN ' || NEW.grn_no,
            'Auto-posted from GRN submission', NEW.created_by
          );
        END LOOP;

        remainder := qty - array_length(serial_list, 1);
      ELSE
        remainder := qty;
      END IF;

      IF remainder > 0 THEN
        INSERT INTO public.ims_stock_items(
          oem, part_name, part_model_no, part_serial_no, warehouse_id,
          stock_type, stock_status, qty, transaction_ref, notes, created_by
        ) VALUES (
          oem_v, COALESCE(part_name_v,'(unnamed)'), model, NULL, wh,
          target_type, target_status, remainder, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
        ) RETURNING id INTO new_id;

        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
        ) VALUES (
          txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, NULL, oem_v,
          wh,
          COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
          remainder, NEW.indent_id, 'GRN ' || NEW.grn_no,
          'Auto-posted from GRN submission', NEW.created_by
        );
      END IF;
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available'::public.ims_stock_status;

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment'::public.ims_txn_type, 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END
$function$;

-- ---------------------------------------------------------------------
-- 1a + 1b: sync_grn_to_ims (historical backfill)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_grn_to_ims(_grn_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $fn$
DECLARE
  gr public.grns%ROWTYPE;
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT; cond TEXT;
  ref TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  new_id uuid;
  inserted_count int := 0;
  exists_txn boolean;
  serial_list TEXT[];
  s TEXT;
  wh uuid;
BEGIN
  SELECT * INTO gr FROM public.grns WHERE id = _grn_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF gr.status <> 'Submitted' THEN RETURN 0; END IF;
  IF gr.items IS NULL OR jsonb_typeof(gr.items) <> 'array' THEN RETURN 0; END IF;

  ref := 'GRN ' || gr.grn_no;

  FOR it IN SELECT * FROM jsonb_array_elements(gr.items) LOOP
    serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
    model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
    part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
    oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
    batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
    cond       := lower(btrim(COALESCE(it->>'condition','')));
    qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
    IF qty <= 0 THEN CONTINUE; END IF;

    -- 1b: honour the per-row warehouse, fall back to the document warehouse.
    wh := CASE WHEN NULLIF(btrim(COALESCE(it->>'warehouse_id','')),'') ~ '^[0-9a-fA-F-]{36}$'
         THEN NULLIF(btrim(COALESCE(it->>'warehouse_id','')),'')::uuid
         ELSE gr.warehouse_id
    END;

    -- 1a: expand a JSON serials array into one row per serial; fall back to the
    -- comma-joined serial_no only when `serials` is absent.
    IF jsonb_typeof(it->'serials') = 'array' THEN
      SELECT array_agg(btrim(x)) INTO serial_list
      FROM jsonb_array_elements_text(it->'serials') AS x
      WHERE btrim(x) <> '';
    ELSIF serial IS NOT NULL THEN
      SELECT array_agg(btrim(x)) INTO serial_list
      FROM unnest(string_to_array(serial, ',')) AS x
      WHERE btrim(x) <> '';
    ELSE
      serial_list := NULL;
    END IF;

    IF cond NOT IN ('good','defective','scrap') THEN
      RAISE EXCEPTION 'GRN %: line item "%" has an invalid or missing condition (%). Allowed values: Good, Defective, Scrap.',
        gr.grn_no, COALESCE(part_name_v, model, '(unnamed)'), COALESCE(NULLIF(cond,''),'empty');
    END IF;

    IF cond = 'good' THEN
      target_type := 'good'::public.ims_stock_type;
      target_status := 'available'::public.ims_stock_status;
      txn_type_v := 'good_in'::public.ims_txn_type;
    ELSIF cond = 'defective' THEN
      target_type := 'defective'::public.ims_stock_type;
      target_status := 'available'::public.ims_stock_status;
      txn_type_v := 'defective_in'::public.ims_txn_type;
    ELSE
      target_type := 'defective'::public.ims_stock_type;
      target_status := 'scrapped'::public.ims_stock_status;
      txn_type_v := 'defective_in'::public.ims_txn_type;
    END IF;

    IF serial_list IS NOT NULL AND array_length(serial_list, 1) > 0 THEN
      FOREACH s IN ARRAY serial_list LOOP
        SELECT EXISTS (
          SELECT 1 FROM public.ims_transactions
           WHERE reference = ref AND part_serial_no = s
        ) INTO exists_txn;
        IF exists_txn THEN CONTINUE; END IF;

        INSERT INTO public.ims_stock_items(
          oem, part_name, part_model_no, part_serial_no, warehouse_id,
          stock_type, stock_status, qty, transaction_ref, notes, created_by
        ) VALUES (
          oem_v, COALESCE(part_name_v,'(unnamed)'), model, s, wh,
          target_type, target_status, 1, ref, batch_v, gr.created_by
        ) RETURNING id INTO new_id;

        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by, txn_date
        ) VALUES (
          txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, s, oem_v,
          wh,
          COALESCE(gr.source_name, CASE gr.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
          1, gr.indent_id, ref,
          'Backfilled from historical GRN', gr.created_by,
          COALESCE(gr.grn_date::timestamptz, gr.created_at)
        );
        inserted_count := inserted_count + 1;
      END LOOP;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM public.ims_transactions
         WHERE reference = ref
           AND part_serial_no IS NULL
           AND COALESCE(part_name,'') = COALESCE(part_name_v,'')
           AND COALESCE(part_model_no,'') = COALESCE(model,'')
      ) INTO exists_txn;
      IF exists_txn THEN CONTINUE; END IF;

      INSERT INTO public.ims_stock_items(
        oem, part_name, part_model_no, part_serial_no, warehouse_id,
        stock_type, stock_status, qty, transaction_ref, notes, created_by
      ) VALUES (
        oem_v, COALESCE(part_name_v,'(unnamed)'), model, NULL, wh,
        target_type, target_status, qty, ref, batch_v, gr.created_by
      ) RETURNING id INTO new_id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by, txn_date
      ) VALUES (
        txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, NULL, oem_v,
        wh,
        COALESCE(gr.source_name, CASE gr.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
        qty, gr.indent_id, ref,
        'Backfilled from historical GRN', gr.created_by,
        COALESCE(gr.grn_date::timestamptz, gr.created_at)
      );
      inserted_count := inserted_count + 1;
    END IF;
  END LOOP;

  RETURN inserted_count;
END
$fn$;

-- ---------------------------------------------------------------------
-- 1c: dc_post_inventory — one-shot posting + line warehouse
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  item_stock_type TEXT;
  is_posting_new BOOLEAN;
  was_posting_old BOOLEAN;
  out_status public.ims_stock_status;
  is_service BOOLEAN;
  d RECORD;
  rev RECORD;
  wh UUID;
BEGIN
  IF NEW.doc_type NOT IN ('customer','oem') THEN RETURN NEW; END IF;

  is_posting_new  := NEW.status IN ('Challan Generated','Submitted');
  was_posting_old := TG_OP = 'UPDATE' AND OLD.status IN ('Challan Generated','Submitted');

  IF is_posting_new AND (TG_OP = 'INSERT' OR NOT was_posting_old) THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      IF NEW.doc_type = 'oem' THEN
        serial := NULLIF(btrim(COALESCE(it->>'good_defective_serial','')), '');
      ELSE
        serial := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      END IF;
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      is_service := FALSE;
      IF NULLIF(it->>'product_id','') IS NOT NULL THEN
        SELECT (item_type = 'service') INTO is_service
          FROM public.products WHERE id = (it->>'product_id')::uuid;
      END IF;
      IF COALESCE(is_service, FALSE) THEN CONTINUE; END IF;

      -- 1c: use the line's warehouse (NULL means "any warehouse" for ims_deduct_qty).
      wh := NULLIF(btrim(COALESCE(it->>'warehouse_id','')), '')::uuid;

      IF NEW.doc_type = 'customer' THEN
        target_type := 'good'::public.ims_stock_type;
      ELSE
        item_stock_type := lower(btrim(COALESCE(it->>'stock_type','')));
        IF item_stock_type LIKE 'defect%' THEN
          target_type := 'defective'::public.ims_stock_type;
        ELSIF item_stock_type LIKE 'good%' THEN
          target_type := 'good'::public.ims_stock_type;
        ELSE
          target_type := 'defective'::public.ims_stock_type;
        END IF;
      END IF;

      txn_type_v := CASE WHEN target_type = 'good'::public.ims_stock_type
                         THEN 'good_out'::public.ims_txn_type
                         ELSE 'defective_out'::public.ims_txn_type END;

      out_status := CASE WHEN NEW.doc_type = 'oem'
                         THEN 'returned_to_oem'::public.ims_stock_status
                         ELSE 'issued'::public.ims_stock_status END;

      IF serial IS NOT NULL THEN
        stock_row := NULL;
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot post DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'-'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = out_status,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;

        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
        ) VALUES (
          txn_type_v, stock_row.id,
          COALESCE(part_name_v, stock_row.part_name),
          COALESCE(model, stock_row.part_model_no),
          serial, COALESCE(oem_v, stock_row.oem),
          stock_row.warehouse_id,
          COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
          qty, NEW.indent_id, 'DC ' || NEW.challan_no,
          'Auto-posted from Delivery Challan', NEW.created_by
        );

      ELSIF model IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            model, wh, target_type, qty,
            'DC ' || COALESCE(NEW.challan_no,''), out_status,
            'DC ' || COALESCE(NEW.challan_no,''),
            (NEW.doc_type = 'customer' AND COALESCE(NEW.allow_negative_stock, false))
          )
        LOOP
          stock_row := NULL;
          SELECT * INTO stock_row FROM public.ims_stock_items WHERE id = d.stock_item_id;

          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by
          ) VALUES (
            txn_type_v, d.stock_item_id,
            COALESCE(part_name_v, stock_row.part_name),
            COALESCE(model, stock_row.part_model_no),
            NULL, COALESCE(oem_v, stock_row.oem),
            stock_row.warehouse_id,
            COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
            d.qty_taken, NEW.indent_id, 'DC ' || NEW.challan_no,
            'Auto-posted from Delivery Challan', NEW.created_by
          );
        END LOOP;
      END IF;
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND was_posting_old AND NEW.status = 'Cancelled' THEN
    FOR rev IN
      SELECT * FROM public.ims_stock_items
       WHERE transaction_ref = 'DC ' || NEW.challan_no
         AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status)
    LOOP
      UPDATE public.ims_stock_items
         SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
       WHERE id = rev.id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        CASE WHEN rev.stock_type = 'good'::public.ims_stock_type
             THEN 'good_in'::public.ims_txn_type
             ELSE 'defective_in'::public.ims_txn_type END,
        rev.id, rev.part_name, rev.part_model_no, rev.part_serial_no, rev.oem,
        rev.warehouse_id,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        rev.qty, NEW.indent_id, 'DC ' || NEW.challan_no,
        'Reversal: DC cancelled after posting', NEW.created_by
      );
    END LOOP;
  END IF;

  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------
-- 1d: assert_items_frozen_after_post — freeze as soon as stock is posted
-- (also corrected in 20260823100000_bugfix_hardening.sql).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_items_frozen_after_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'delivery_challans' THEN
    IF OLD.status IN ('Challan Generated','Submitted','Dispatched')
       AND NEW.items IS DISTINCT FROM OLD.items THEN
      RAISE EXCEPTION
        'Challan % is % — its items are frozen because stock has been posted. Cancel and re-raise instead.',
        COALESCE(OLD.challan_no, OLD.id), OLD.status;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'general_delivery_challans' THEN
    IF OLD.status IN ('Issued', 'Converted', 'Cancelled')
       AND NEW.items IS DISTINCT FROM OLD.items THEN
      RAISE EXCEPTION
        'General DC % is % — its items are frozen because stock has been posted/reversed.',
        COALESCE(OLD.dc_no, OLD.id), OLD.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
