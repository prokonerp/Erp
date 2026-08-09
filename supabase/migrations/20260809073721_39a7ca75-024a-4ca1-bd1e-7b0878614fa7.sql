CREATE TABLE public.stock_negative_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type TEXT NOT NULL CHECK (document_type IN ('invoice','dc')),
  document_id UUID,
  document_no TEXT,
  product_model TEXT NOT NULL,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  requested_qty NUMERIC NOT NULL,
  available_qty NUMERIC NOT NULL,
  resulting_negative_qty NUMERIC NOT NULL,
  overridden_by UUID REFERENCES auth.users(id),
  overridden_by_name TEXT,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.stock_negative_overrides TO authenticated;
GRANT ALL ON public.stock_negative_overrides TO service_role;

ALTER TABLE public.stock_negative_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view negative stock overrides"
  ON public.stock_negative_overrides FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can log negative stock overrides"
  ON public.stock_negative_overrides FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND overridden_by = auth.uid());

CREATE TRIGGER trg_sno_touch BEFORE UPDATE ON public.stock_negative_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.delivery_challans ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.ims_deduct_qty(_model text, _warehouse uuid, _stock_type ims_stock_type, _qty numeric, _ref text, _new_status ims_stock_status, _doc_label text DEFAULT 'document'::text, _allow_negative boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  remaining numeric := _qty;
  take numeric;
  avail numeric;
  r public.ims_stock_items%ROWTYPE;
  first_id uuid;
  tmpl public.ims_stock_items%ROWTYPE;
BEGIN
  IF _model IS NULL OR _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

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
      first_id := COALESCE(first_id, r.id);
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
      ) RETURNING id INTO first_id;
    END IF;

    remaining := remaining - take;
  END LOOP;

  -- Approved override: represent the shortfall as negative available quantity
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
    );
    remaining := 0;
  END IF;

  RETURN first_id;
END $function$;

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
  pooled_id UUID;
  is_service BOOLEAN;
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

      stock_row := NULL;
      IF serial IS NOT NULL THEN
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
      ELSIF model IS NOT NULL THEN
        pooled_id := public.ims_deduct_qty(
          model, NULL, target_type, qty,
          'DC ' || COALESCE(NEW.challan_no,''), out_status,
          'DC ' || COALESCE(NEW.challan_no,''),
          (NEW.doc_type = 'customer' AND COALESCE(NEW.allow_negative_stock, false))
        );
        IF pooled_id IS NOT NULL THEN
          SELECT * INTO stock_row FROM public.ims_stock_items WHERE id = pooled_id;
        END IF;
      END IF;

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
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND was_posting_old AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued'::public.ims_stock_status,'returned_to_oem'::public.ims_stock_status);
  END IF;

  RETURN NEW;
END $function$;

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
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.serial_numbers IS NOT NULL AND array_length(NEW.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(NEW.serial_numbers)
         AND stock_status = 'available';
    ELSIF NEW.product_id IS NOT NULL AND COALESCE(NEW.qty,0) > 0 THEN
      SELECT model, item_type INTO p_model, p_item_type
        FROM public.products WHERE id = NEW.product_id;
      SELECT COALESCE(allow_negative_stock, false) INTO allow_neg
        FROM public.invoices WHERE id = NEW.invoice_id;
      IF COALESCE(p_item_type,'product') <> 'service' AND p_model IS NOT NULL THEN
        PERFORM public.ims_deduct_qty(
          p_model, NEW.warehouse_id, 'good'::public.ims_stock_type, NEW.qty,
          'Invoice item', 'issued'::public.ims_stock_status, 'invoice',
          COALESCE(allow_neg, false)
        );
      END IF;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    removed := ARRAY(SELECT unnest(COALESCE(OLD.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(NEW.serial_numbers,'{}')));
    added   := ARRAY(SELECT unnest(COALESCE(NEW.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(OLD.serial_numbers,'{}')));
    IF array_length(removed,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(removed)
         AND stock_status = 'issued';
    END IF;
    IF array_length(added,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(added)
         AND stock_status = 'available';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.serial_numbers IS NOT NULL AND array_length(OLD.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(OLD.serial_numbers)
         AND stock_status = 'issued';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $function$;