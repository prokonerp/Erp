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
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
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
            model, NULL, target_type, qty,
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