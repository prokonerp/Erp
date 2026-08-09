-- 1. ims_deduct_qty now returns one row per batch consumed
DROP FUNCTION IF EXISTS public.ims_deduct_qty(text, uuid, public.ims_stock_type, numeric, text, public.ims_stock_status, text);
DROP FUNCTION IF EXISTS public.ims_deduct_qty(text, uuid, public.ims_stock_type, numeric, text, public.ims_stock_status, text, boolean);

CREATE OR REPLACE FUNCTION public.ims_deduct_qty(
  _model text, _warehouse uuid, _stock_type public.ims_stock_type, _qty numeric,
  _ref text, _new_status public.ims_stock_status, _doc_label text DEFAULT 'document',
  _allow_negative boolean DEFAULT false
)
RETURNS TABLE(stock_item_id uuid, qty_taken numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  remaining numeric := _qty;
  take numeric;
  avail numeric;
  r public.ims_stock_items%ROWTYPE;
  new_id uuid;
  tmpl public.ims_stock_items%ROWTYPE;
BEGIN
  IF _model IS NULL OR _qty IS NULL OR _qty <= 0 THEN RETURN; END IF;

  SELECT COALESCE(SUM(qty),0) INTO avail
    FROM public.ims_stock_items
   WHERE part_model_no = _model
     AND stock_type = _stock_type
     AND stock_status = 'available'::public.ims_stock_status
     AND part_serial_no IS NULL
     AND (_warehouse IS NULL OR warehouse_id = _warehouse);

  IF avail < _qty AND NOT COALESCE(_allow_negative, false) THEN
    RAISE EXCEPTION 'Cannot post %: only % unit(s) of "%" available in % stock, % requested',
      _doc_label, avail, _model, _stock_type, _qty;
  END IF;

  FOR r IN
    SELECT * FROM public.ims_stock_items
     WHERE part_model_no = _model
       AND stock_type = _stock_type
       AND stock_status = 'available'::public.ims_stock_status
       AND part_serial_no IS NULL
       AND qty > 0
       AND (_warehouse IS NULL OR warehouse_id = _warehouse)
     ORDER BY created_at ASC, id ASC
  LOOP
    EXIT WHEN remaining <= 0;
    take := LEAST(r.qty, remaining);

    IF take >= r.qty THEN
      UPDATE public.ims_stock_items
         SET stock_status = _new_status,
             transaction_ref = COALESCE(_ref, transaction_ref),
             updated_at = now()
       WHERE id = r.id;
      new_id := r.id;
    ELSE
      UPDATE public.ims_stock_items
         SET qty = r.qty - take, updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.ims_stock_items(
        oem, category, part_name, part_model_no, part_serial_no,
        warehouse_id, warehouse_type, stock_type, stock_status, qty,
        transaction_ref, notes, created_by
      ) VALUES (
        r.oem, r.category, r.part_name, r.part_model_no, NULL,
        r.warehouse_id, r.warehouse_type, r.stock_type, _new_status, take,
        _ref, 'Quantity split from pooled stock', r.created_by
      ) RETURNING id INTO new_id;
    END IF;

    stock_item_id := new_id; qty_taken := take; RETURN NEXT;
    remaining := remaining - take;
  END LOOP;

  IF remaining > 0 AND COALESCE(_allow_negative, false) THEN
    SELECT * INTO tmpl FROM public.ims_stock_items
      WHERE part_model_no = _model AND part_serial_no IS NULL
      ORDER BY created_at DESC LIMIT 1;

    INSERT INTO public.ims_stock_items(
      oem, category, part_name, part_model_no, part_serial_no,
      warehouse_id, warehouse_type, stock_type, stock_status, qty,
      transaction_ref, notes
    ) VALUES (
      tmpl.oem, tmpl.category, COALESCE(tmpl.part_name, _model), _model, NULL,
      COALESCE(_warehouse, tmpl.warehouse_id), tmpl.warehouse_type, _stock_type,
      'available'::public.ims_stock_status, -remaining,
      _ref, 'Negative stock: approved override shortfall'
    ) RETURNING id INTO new_id;

    stock_item_id := new_id; qty_taken := remaining; RETURN NEXT;
    remaining := 0;
  END IF;

  RETURN;
END $function$;

GRANT EXECUTE ON FUNCTION public.ims_deduct_qty(text, uuid, public.ims_stock_type, numeric, text, public.ims_stock_status, text, boolean) TO authenticated, service_role;

-- 2. DC posting: one transaction per batch + cancellation reversal
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
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
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

-- 3. Stock transfer: one out-transaction per batch
CREATE OR REPLACE FUNCTION public.ims_transfer_status_effects()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  linked_id UUID := NEW.stock_item_id;
  d RECORD;
  wrote_out BOOLEAN := FALSE;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('in_transit','completed') THEN

    IF linked_id IS NULL AND NEW.part_serial_no IS NOT NULL THEN
      SELECT id INTO linked_id
        FROM public.ims_stock_items
       WHERE part_serial_no = NEW.part_serial_no
         AND (NEW.source_warehouse_id IS NULL OR warehouse_id = NEW.source_warehouse_id)
       LIMIT 1;
      IF linked_id IS NOT NULL THEN
        NEW.stock_item_id := linked_id;
      END IF;
    END IF;

    IF NEW.status = 'in_transit' THEN
      IF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET stock_status = 'in_transit', updated_at = now()
         WHERE id = linked_id;
      ELSIF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            NEW.part_model_no, NEW.source_warehouse_id, NEW.stock_type, NEW.qty,
            COALESCE(NEW.transfer_no,'Transfer'), 'in_transit'::public.ims_stock_status,
            'Transfer ' || COALESCE(NEW.transfer_no,'')
          )
        LOOP
          IF linked_id IS NULL THEN
            linked_id := d.stock_item_id;
            NEW.stock_item_id := linked_id;
          END IF;
          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
          ) VALUES (
            'transfer_out', d.stock_item_id, NEW.part_name, NEW.part_model_no, NULL, NEW.oem,
            NEW.source_warehouse_id, NEW.destination_warehouse_id, d.qty_taken, NEW.id, NEW.transfer_no,
            'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
          );
          wrote_out := TRUE;
        END LOOP;
      END IF;

      IF NOT wrote_out THEN
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
        ) VALUES (
          'transfer_out', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
          NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
          'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
        );
      END IF;

    ELSIF NEW.status = 'completed' THEN
      IF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        IF linked_id IS NOT NULL THEN
          DELETE FROM public.ims_stock_items WHERE id = linked_id;
        END IF;
        linked_id := public.ims_add_qty(
          NEW.part_model_no, NEW.destination_warehouse_id, NEW.stock_type, NEW.qty,
          NEW.part_name, NEW.oem, COALESCE(NEW.transfer_no,'Transfer')
        );
        NEW.stock_item_id := linked_id;
      ELSIF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET warehouse_id  = NEW.destination_warehouse_id,
               stock_status  = 'available',
               updated_at    = now()
         WHERE id = linked_id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
      ) VALUES (
        'transfer_in', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
        NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
        'Transfer received', NEW.received_by
      );
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- 4. Invoice items: write stock movement transactions
CREATE OR REPLACE FUNCTION public.invoice_item_sync_serials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  removed TEXT[];
  added TEXT[];
  p_model TEXT;
  p_item_type TEXT;
  allow_neg BOOLEAN := false;
  inv_no TEXT;
  inv_party TEXT;
  s TEXT;
  sr public.ims_stock_items%ROWTYPE;
  d RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT invoice_no, buyer_name INTO inv_no, inv_party FROM public.invoices WHERE id = OLD.invoice_id;
  ELSE
    SELECT invoice_no, buyer_name, COALESCE(allow_negative_stock,false)
      INTO inv_no, inv_party, allow_neg FROM public.invoices WHERE id = NEW.invoice_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.serial_numbers IS NOT NULL AND array_length(NEW.serial_numbers,1) > 0 THEN
      FOREACH s IN ARRAY NEW.serial_numbers LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'available' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes
        ) VALUES (
          'good_out', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Auto-posted from Sales Invoice'
        );
      END LOOP;
    ELSIF NEW.product_id IS NOT NULL AND COALESCE(NEW.qty,0) > 0 THEN
      SELECT model, item_type INTO p_model, p_item_type
        FROM public.products WHERE id = NEW.product_id;
      IF COALESCE(p_item_type,'product') <> 'service' AND p_model IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            p_model, NEW.warehouse_id, 'good'::public.ims_stock_type, NEW.qty,
            'Invoice ' || COALESCE(inv_no,''), 'issued'::public.ims_stock_status, 'invoice',
            COALESCE(allow_neg, false)
          )
        LOOP
          sr := NULL;
          SELECT * INTO sr FROM public.ims_stock_items WHERE id = d.stock_item_id;
          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_party, qty, reference, notes
          ) VALUES (
            'good_out', d.stock_item_id, sr.part_name, sr.part_model_no, NULL, sr.oem,
            sr.warehouse_id, COALESCE(inv_party,'Customer'), d.qty_taken,
            'Invoice ' || COALESCE(inv_no,''), 'Auto-posted from Sales Invoice'
          );
        END LOOP;
      END IF;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    removed := ARRAY(SELECT unnest(COALESCE(OLD.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(NEW.serial_numbers,'{}')));
    added   := ARRAY(SELECT unnest(COALESCE(NEW.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(OLD.serial_numbers,'{}')));

    IF array_length(removed,1) > 0 THEN
      FOREACH s IN ARRAY removed LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'issued' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'available', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, reference, notes
        ) VALUES (
          'good_in', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Reversal: serial removed from Sales Invoice'
        );
      END LOOP;
    END IF;

    IF array_length(added,1) > 0 THEN
      FOREACH s IN ARRAY added LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'available' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes
        ) VALUES (
          'good_out', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Auto-posted from Sales Invoice'
        );
      END LOOP;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.serial_numbers IS NOT NULL AND array_length(OLD.serial_numbers,1) > 0 THEN
      FOREACH s IN ARRAY OLD.serial_numbers LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'issued' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'available', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, reference, notes
        ) VALUES (
          'good_in', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv_party,'Customer'), 1,
          'Invoice ' || COALESCE(inv_no,''), 'Reversal: invoice item deleted'
        );
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;