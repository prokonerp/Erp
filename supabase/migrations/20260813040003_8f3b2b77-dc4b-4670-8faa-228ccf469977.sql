CREATE SEQUENCE IF NOT EXISTS public.gdc_seq;

CREATE TABLE public.general_delivery_challans (
  id uuid primary key default gen_random_uuid(),
  dc_no text unique,
  dc_date date not null default current_date,
  returnable boolean not null default false,
  customer_id uuid references public.customers(id),
  customer_name text,
  billing_address text,
  shipping_address text,
  purpose text,
  branch_id uuid references public.branches(id),
  items jsonb not null default '[]'::jsonb,
  status text not null default 'Draft' check (status in ('Draft','Issued','Converted')),
  converted_invoice_id uuid references public.invoices(id),
  allow_negative_stock boolean not null default false,
  notes text,
  terms text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.general_delivery_challans TO authenticated;
GRANT ALL ON public.general_delivery_challans TO service_role;
GRANT USAGE ON SEQUENCE public.gdc_seq TO authenticated, service_role;
ALTER TABLE public.general_delivery_challans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gdc_select" ON public.general_delivery_challans FOR SELECT TO authenticated USING (true);
CREATE POLICY "gdc_insert" ON public.general_delivery_challans FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "gdc_update" ON public.general_delivery_challans FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "gdc_delete" ON public.general_delivery_challans FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.set_gdc_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.dc_no IS NULL OR NEW.dc_no = '' THEN
    NEW.dc_no := 'GDC/' || to_char(now(),'YYYY') || '/' || lpad(nextval('public.gdc_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_set_gdc_no BEFORE INSERT ON public.general_delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.set_gdc_no();

CREATE TRIGGER trg_gdc_touch BEFORE UPDATE ON public.general_delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Post stock on Issue, reusing the same helpers as DC / Invoice.
CREATE OR REPLACE FUNCTION public.gdc_post_inventory()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  it jsonb; s text; qty numeric; model text; part_name_v text;
  is_service boolean; sr public.ims_stock_items%ROWTYPE; d RECORD;
  wh uuid; party text;
BEGIN
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
END $$;

CREATE TRIGGER trg_gdc_post_inventory AFTER INSERT OR UPDATE ON public.general_delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.gdc_post_inventory();

-- Invoices created from an already-issued General DC must not deduct stock again.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS skip_stock_posting boolean NOT NULL DEFAULT false;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS source_general_dc_id uuid REFERENCES public.general_delivery_challans(id);

CREATE OR REPLACE FUNCTION public.invoice_item_sync_serials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  removed TEXT[];
  added TEXT[];
  p_model TEXT;
  p_item_type TEXT;
  allow_neg BOOLEAN := false;
  skip_post BOOLEAN := false;
  inv_no TEXT;
  inv_party TEXT;
  s TEXT;
  sr public.ims_stock_items%ROWTYPE;
  d RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT invoice_no, buyer_name, COALESCE(skip_stock_posting,false)
      INTO inv_no, inv_party, skip_post FROM public.invoices WHERE id = OLD.invoice_id;
  ELSE
    SELECT invoice_no, buyer_name, COALESCE(allow_negative_stock,false), COALESCE(skip_stock_posting,false)
      INTO inv_no, inv_party, allow_neg, skip_post FROM public.invoices WHERE id = NEW.invoice_id;
  END IF;

  IF COALESCE(skip_post,false) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
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