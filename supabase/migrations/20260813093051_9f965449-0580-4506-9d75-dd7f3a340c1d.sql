ALTER TABLE public.general_delivery_challans
  DROP CONSTRAINT IF EXISTS general_delivery_challans_status_check;
ALTER TABLE public.general_delivery_challans
  ADD CONSTRAINT general_delivery_challans_status_check
  CHECK (status = ANY (ARRAY['Draft'::text, 'Issued'::text, 'Converted'::text, 'Cancelled'::text]));

ALTER TABLE public.general_delivery_challans
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid;

-- Guard terminal states / legal transitions
CREATE OR REPLACE FUNCTION public.gdc_guard_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.status IN ('Cancelled','Converted') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'General DC % is % — it is a terminal state and cannot change', OLD.dc_no, OLD.status;
  END IF;
  IF NEW.status = 'Cancelled' AND OLD.status <> 'Issued' THEN
    RAISE EXCEPTION 'Only an Issued General DC can be cancelled (current: %)', OLD.status;
  END IF;
  IF NEW.status = 'Cancelled' AND NULLIF(btrim(COALESCE(NEW.cancelled_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'A reason is required to cancel a General DC';
  END IF;
  IF NEW.status = 'Cancelled' AND OLD.status = 'Issued' THEN
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
    NEW.cancelled_by := COALESCE(NEW.cancelled_by, auth.uid());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_gdc_guard_status ON public.general_delivery_challans;
CREATE TRIGGER trg_gdc_guard_status
  BEFORE UPDATE ON public.general_delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.gdc_guard_status();

-- Stock posting + reversal on cancel
CREATE OR REPLACE FUNCTION public.gdc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  it jsonb; s text; qty numeric; model text; part_name_v text;
  is_service boolean; sr public.ims_stock_items%ROWTYPE; d RECORD; r RECORD;
  wh uuid; party text; ref text;
BEGIN
  -- Reversal: Issued -> Cancelled restores every batch this DC consumed.
  IF TG_OP = 'UPDATE' AND NEW.status = 'Cancelled' AND OLD.status = 'Issued' THEN
    ref := 'GDC ' || COALESCE(OLD.dc_no,'');
    FOR r IN SELECT * FROM public.ims_stock_items WHERE transaction_ref = ref LOOP
      UPDATE public.ims_stock_items
         SET stock_status = 'available'::public.ims_stock_status, updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, qty, reference, notes, created_by
      ) VALUES (
        'good_in'::public.ims_txn_type, r.id, r.part_name, r.part_model_no, r.part_serial_no, r.oem,
        r.warehouse_id, r.qty, ref,
        'Reversal: General DC cancelled after issuing', COALESCE(NEW.cancelled_by, NEW.created_by)
      );
    END LOOP;
    RETURN NEW;
  END IF;

  IF NEW.status <> 'Issued' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'Issued' THEN RETURN NEW; END IF;
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

  party := COALESCE(NEW.customer_name, 'Customer');

  FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    model := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
    part_name_v := NULLIF(btrim(COALESCE(it->>'part_name','')), '');
    qty := COALESCE(NULLIF(it->>'qty','')::numeric, 0);
    wh := NULLIF(it->>'warehouse_id','')::uuid;
    IF qty <= 0 THEN CONTINUE; END IF;

    is_service := false;
    IF NULLIF(it->>'product_id','') IS NOT NULL THEN
      SELECT (item_type = 'service') INTO is_service FROM public.products WHERE id = (it->>'product_id')::uuid;
    END IF;
    IF COALESCE(is_service,false) THEN CONTINUE; END IF;

    IF COALESCE(jsonb_array_length(COALESCE(it->'serial_numbers','[]'::jsonb)),0) > 0 THEN
      FOR s IN SELECT jsonb_array_elements_text(it->'serial_numbers') LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items
          WHERE part_serial_no = s AND stock_status = 'available'::public.ims_stock_status LIMIT 1;
        IF sr.id IS NULL THEN
          RAISE EXCEPTION 'Cannot issue %: serial "%" is not available in stock', NEW.dc_no, s;
        END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued'::public.ims_stock_status,
               transaction_ref = 'GDC ' || NEW.dc_no, updated_at = now()
         WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes, created_by
        ) VALUES (
          'good_out'::public.ims_txn_type, sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, party, 1, 'GDC ' || NEW.dc_no,
          'Auto-posted from General Delivery Challan', NEW.created_by
        );
      END LOOP;
    ELSIF model IS NOT NULL THEN
      FOR d IN SELECT * FROM public.ims_deduct_qty(
          model, wh, 'good'::public.ims_stock_type, qty,
          'GDC ' || COALESCE(NEW.dc_no,''), 'issued'::public.ims_stock_status,
          'General Delivery Challan', COALESCE(NEW.allow_negative_stock,false))
      LOOP
        sr := NULL;
        SELECT * INTO sr FROM public.ims_stock_items WHERE id = d.stock_item_id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes, created_by
        ) VALUES (
          'good_out'::public.ims_txn_type, d.stock_item_id,
          COALESCE(part_name_v, sr.part_name), COALESCE(model, sr.part_model_no), NULL, sr.oem,
          sr.warehouse_id, party, d.qty_taken, 'GDC ' || COALESCE(NEW.dc_no,''),
          'Auto-posted from General Delivery Challan', NEW.created_by
        );
      END LOOP;
    END IF;
  END LOOP;

  RETURN NEW;
END $function$;

-- Delete allowed only on Drafts, for admins or users with General DC delete rights
DROP POLICY IF EXISTS gdc_delete ON public.general_delivery_challans;
CREATE POLICY gdc_delete ON public.general_delivery_challans
  FOR DELETE TO authenticated
  USING (
    status = 'Draft'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_permission(auth.uid(), 'general_dc', 'delete'))
  );

INSERT INTO public.app_modules(key, label, sort_order)
VALUES ('general_dc', 'General DC', 26)
ON CONFLICT (key) DO NOTHING;