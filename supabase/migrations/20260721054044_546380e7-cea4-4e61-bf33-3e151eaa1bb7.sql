
-- Audit columns for submit/print lifecycle on DC and GRN
ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS printed_by UUID,
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

ALTER TABLE public.grns
  ADD COLUMN IF NOT EXISTS submitted_by UUID,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS printed_by UUID,
  ADD COLUMN IF NOT EXISTS printed_at TIMESTAMPTZ;

-- Rework DC inventory trigger to fire on Submitted (was Dispatched).
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type TEXT; txn_type_v TEXT;
BEGIN
  IF NEW.doc_type = 'customer' THEN
    target_type := 'good';      txn_type_v := 'good_out';
  ELSIF NEW.doc_type = 'oem' THEN
    target_type := 'defective'; txn_type_v := 'defective_out';
  ELSE
    RETURN NEW;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);
      IF qty <= 0 THEN CONTINUE; END IF;

      stock_row := NULL;
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial AND stock_type = target_type
            AND stock_status = 'available' LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot submit DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;
        UPDATE public.ims_stock_items
          SET stock_status = CASE WHEN NEW.doc_type='oem' THEN 'returned_to_oem' ELSE 'issued' END,
              transaction_ref = 'DC ' || NEW.challan_no, updated_at = now()
          WHERE id = stock_row.id;
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
        'Auto-posted from Delivery Challan submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available', updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued','returned_to_oem');
  END IF;

  RETURN NEW;
END $function$;

-- Rework GRN inventory trigger to fire on Submitted (was Approved).
CREATE OR REPLACE FUNCTION public.grn_post_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  target_type TEXT; txn_type_v TEXT;
  new_id UUID;
BEGIN
  IF NEW.category = 'customer' THEN
    target_type := 'defective'; txn_type_v := 'defective_in';
  ELSIF NEW.category = 'oem' THEN
    target_type := 'good';      txn_type_v := 'good_in';
  ELSE
    IF COALESCE(NEW.stock_category,'good') = 'defective' THEN
      target_type := 'defective'; txn_type_v := 'defective_in';
    ELSE
      target_type := 'good';      txn_type_v := 'good_in';
    END IF;
  END IF;

  IF NEW.status = 'Submitted' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Submitted') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      batch_v    := NULLIF(btrim(COALESCE(it->>'batch_no','')), '');
      qty        := COALESCE((it->>'qty_accepted')::NUMERIC, (it->>'qty_received')::NUMERIC, 0);
      IF qty <= 0 THEN CONTINUE; END IF;

      INSERT INTO public.ims_stock_items(
        oem, part_name, part_model_no, part_serial_no, warehouse_id,
        stock_type, stock_status, qty, transaction_ref, notes, created_by
      ) VALUES (
        oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, NEW.warehouse_id,
        target_type, 'available', qty, 'GRN ' || NEW.grn_no, batch_v, NEW.created_by
      ) RETURNING id INTO new_id;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
        NEW.warehouse_id,
        COALESCE(NEW.source_name, CASE NEW.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
        qty, NEW.indent_id, 'GRN ' || NEW.grn_no,
        'Auto-posted from GRN submission', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Submitted' AND NEW.status = 'Cancelled' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped', updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available';

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment', 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN cancelled after submission',
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $function$;

-- Indent status recalculation now driven by Submitted docs.
CREATE OR REPLACE FUNCTION public.recalc_indent_status(_indent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  dc_count INT; grn_count INT;
  dc_done INT; grn_done INT;
  new_status TEXT;
BEGIN
  IF _indent_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='Submitted')
    INTO dc_count, dc_done
    FROM public.delivery_challans WHERE indent_id = _indent_id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='Submitted')
    INTO grn_count, grn_done
    FROM public.grns WHERE indent_id = _indent_id;

  IF dc_count = 0 AND grn_count = 0 THEN
    new_status := 'open';
  ELSIF (dc_done + grn_done) = 0 THEN
    new_status := 'in_progress';
  ELSIF (dc_done = dc_count) AND (grn_done = grn_count) AND (dc_count + grn_count) > 0 THEN
    new_status := 'completed';
  ELSE
    new_status := 'partially_completed';
  END IF;

  UPDATE public.indents
     SET status = new_status, updated_at = now()
   WHERE id = _indent_id AND status NOT IN ('closed','draft');
END $function$;

-- Backfill: existing "Dispatched" DCs and "Approved" GRNs are effectively already
-- posted to inventory. Mark them as Submitted so the new lifecycle is consistent
-- and reporting/indent recalculation continues to see them as completed.
UPDATE public.delivery_challans SET status = 'Submitted' WHERE status = 'Dispatched';
UPDATE public.grns SET status = 'Submitted' WHERE status = 'Approved';
