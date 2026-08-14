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
            oem_v, COALESCE(part_name_v,'(unnamed)'), model, s, NEW.warehouse_id,
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
            NEW.warehouse_id,
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
          oem_v, COALESCE(part_name_v,'(unnamed)'), model, NULL, NEW.warehouse_id,
          target_type, target_status, remainder, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
        ) RETURNING id INTO new_id;

        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
        ) VALUES (
          txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, NULL, oem_v,
          NEW.warehouse_id,
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