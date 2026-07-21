-- ============================================================
-- RMA Workflow: link columns, stock category, indent status
-- ============================================================

-- 1. Link columns on delivery_challans and grns
ALTER TABLE public.delivery_challans
  ADD COLUMN IF NOT EXISTS indent_id UUID NULL REFERENCES public.indents(id) ON DELETE SET NULL;

ALTER TABLE public.grns
  ADD COLUMN IF NOT EXISTS indent_id UUID NULL REFERENCES public.indents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stock_category TEXT NULL;

-- General GRN stock category values
DO $$ BEGIN
  ALTER TABLE public.grns
    ADD CONSTRAINT grns_stock_category_chk
    CHECK (stock_category IS NULL OR stock_category IN ('good','defective','quarantine'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_delivery_challans_indent ON public.delivery_challans(indent_id);
CREATE INDEX IF NOT EXISTS idx_grns_indent ON public.grns(indent_id);

-- 2. Allow "general" doc_type on delivery_challans
DO $$ BEGIN
  ALTER TABLE public.delivery_challans DROP CONSTRAINT IF EXISTS delivery_challans_doc_type_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;
ALTER TABLE public.delivery_challans
  ADD CONSTRAINT delivery_challans_doc_type_check
  CHECK (doc_type IN ('customer','oem','general'));

-- 3. Indent status column
ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

DO $$ BEGIN
  ALTER TABLE public.indents
    ADD CONSTRAINT indents_status_chk
    CHECK (status IN ('draft','open','in_progress','partially_completed','completed','closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 4. DC posting trigger — dispatch decrements stock; cancel reverses
-- ============================================================
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  it JSONB;
  serial TEXT;
  qty NUMERIC;
  model TEXT;
  part_name_v TEXT;
  oem_v TEXT;
  stock_row public.ims_stock_items%ROWTYPE;
  target_type TEXT;
  txn_type_v TEXT;
  new_status TEXT;
BEGIN
  -- Determine which side (customer=good, oem=defective, general=skip auto)
  IF NEW.doc_type = 'customer' THEN
    target_type := 'good';   txn_type_v := 'good_out';
  ELSIF NEW.doc_type = 'oem' THEN
    target_type := 'defective'; txn_type_v := 'defective_out';
  ELSE
    RETURN NEW; -- general DC: no auto-post
  END IF;

  -- ==== POST on transition to Dispatched ====
  IF NEW.status = 'Dispatched' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Dispatched') THEN
    IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN RETURN NEW; END IF;

    FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
      serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
      model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
      part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
      oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
      qty        := COALESCE((it->>'qty')::NUMERIC, 1);

      IF qty <= 0 THEN CONTINUE; END IF;

      -- Serial-tracked path: enforce availability
      IF serial IS NOT NULL THEN
        SELECT * INTO stock_row FROM public.ims_stock_items
          WHERE part_serial_no = serial
            AND stock_type = target_type
            AND stock_status = 'available'
          LIMIT 1;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Cannot dispatch DC %: serial "%" (%) not available in % stock',
            NEW.challan_no, serial, COALESCE(model,'—'), target_type;
        END IF;

        UPDATE public.ims_stock_items
          SET stock_status = CASE WHEN NEW.doc_type='oem' THEN 'returned_to_oem' ELSE 'issued' END,
              transaction_ref = 'DC ' || NEW.challan_no,
              updated_at = now()
          WHERE id = stock_row.id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, from_party, to_party, qty,
        indent_id, reference, notes, created_by
      ) VALUES (
        txn_type_v::txn_type_enum, -- if enum; else cast handled below
        stock_row.id,
        COALESCE(part_name_v, stock_row.part_name),
        COALESCE(model, stock_row.part_model_no),
        serial,
        COALESCE(oem_v, stock_row.oem),
        stock_row.warehouse_id, NULL,
        NULL,
        COALESCE(NEW.party_name, CASE WHEN NEW.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
        qty,
        NEW.indent_id,
        'DC ' || NEW.challan_no,
        'Auto-posted from Delivery Challan dispatch',
        NEW.created_by
      );
    END LOOP;

  -- ==== REVERSE on transition away from Dispatched (e.g., Cancelled) ====
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Dispatched' AND NEW.status <> 'Dispatched' THEN
    -- Restore any stock items linked by this DC's ref
    UPDATE public.ims_stock_items
       SET stock_status = 'available', updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued','returned_to_oem');

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment', 'DC Reversal', 0, 'DC ' || NEW.challan_no,
      'Reversal: DC status changed from Dispatched to ' || NEW.status,
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN invalid_text_representation THEN
  -- ims_transactions.txn_type is TEXT, not enum — retry without cast
  RAISE;
END $$;

-- Simpler variant: ims_transactions.txn_type is TEXT (per schema). Redefine cleanly.
CREATE OR REPLACE FUNCTION public.dc_post_inventory()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
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

  IF NEW.status = 'Dispatched' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Dispatched') THEN
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
          RAISE EXCEPTION 'Cannot dispatch DC %: serial "%" (%) not available in % stock',
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
        'Auto-posted from Delivery Challan dispatch', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Dispatched' AND NEW.status <> 'Dispatched' THEN
    UPDATE public.ims_stock_items
       SET stock_status = 'available', updated_at = now()
     WHERE transaction_ref = 'DC ' || NEW.challan_no
       AND stock_status IN ('issued','returned_to_oem');
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dc_post_inventory ON public.delivery_challans;
CREATE TRIGGER trg_dc_post_inventory
  AFTER INSERT OR UPDATE OF status ON public.delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.dc_post_inventory();

-- ============================================================
-- 5. GRN posting trigger — Approved credits stock; Rejected reverses
-- ============================================================
CREATE OR REPLACE FUNCTION public.grn_post_inventory()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT;
  target_type TEXT; txn_type_v TEXT;
  new_id UUID;
BEGIN
  -- Determine stock side
  IF NEW.category = 'customer' THEN
    target_type := 'defective'; txn_type_v := 'defective_in';
  ELSIF NEW.category = 'oem' THEN
    target_type := 'good';      txn_type_v := 'good_in';
  ELSE
    -- general: driven by stock_category (default good)
    IF COALESCE(NEW.stock_category,'good') = 'defective' THEN
      target_type := 'defective'; txn_type_v := 'defective_in';
    ELSE
      target_type := 'good';      txn_type_v := 'good_in';
    END IF;
  END IF;

  IF NEW.status = 'Approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Approved') THEN
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
        'Auto-posted from GRN approval', NEW.created_by
      );
    END LOOP;

  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Approved' AND NEW.status <> 'Approved' THEN
    -- Reverse: mark stock items scrapped and log adjustment
    UPDATE public.ims_stock_items
       SET stock_status = 'scrapped', updated_at = now()
     WHERE transaction_ref = 'GRN ' || NEW.grn_no
       AND stock_status = 'available';

    INSERT INTO public.ims_transactions(
      txn_type, part_name, qty, reference, notes, indent_id, created_by
    ) VALUES (
      'stock_adjustment', 'GRN Reversal', 0, 'GRN ' || NEW.grn_no,
      'Reversal: GRN status changed from Approved to ' || NEW.status,
      NEW.indent_id, NEW.created_by
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_grn_post_inventory ON public.grns;
CREATE TRIGGER trg_grn_post_inventory
  AFTER INSERT OR UPDATE OF status ON public.grns
  FOR EACH ROW EXECUTE FUNCTION public.grn_post_inventory();

-- ============================================================
-- 6. Indent lifecycle auto-status
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_indent_status(_indent_id UUID)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  dc_count INT; grn_count INT;
  dc_dispatched INT; grn_approved INT;
  new_status TEXT;
BEGIN
  IF _indent_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='Dispatched')
    INTO dc_count, dc_dispatched
    FROM public.delivery_challans WHERE indent_id = _indent_id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status='Approved')
    INTO grn_count, grn_approved
    FROM public.grns WHERE indent_id = _indent_id;

  IF dc_count = 0 AND grn_count = 0 THEN
    new_status := 'open';
  ELSIF (dc_dispatched + grn_approved) = 0 THEN
    new_status := 'in_progress';
  ELSIF (dc_dispatched = dc_count) AND (grn_approved = grn_count) AND (dc_count + grn_count) > 0 THEN
    new_status := 'completed';
  ELSE
    new_status := 'partially_completed';
  END IF;

  UPDATE public.indents
     SET status = new_status, updated_at = now()
   WHERE id = _indent_id AND status NOT IN ('closed','draft');
END $$;

CREATE OR REPLACE FUNCTION public.trg_indent_recalc_from_doc()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  PERFORM public.recalc_indent_status(COALESCE(NEW.indent_id, OLD.indent_id));
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_dc_indent_recalc ON public.delivery_challans;
CREATE TRIGGER trg_dc_indent_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.trg_indent_recalc_from_doc();

DROP TRIGGER IF EXISTS trg_grn_indent_recalc ON public.grns;
CREATE TRIGGER trg_grn_indent_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.grns
  FOR EACH ROW EXECUTE FUNCTION public.trg_indent_recalc_from_doc();

-- Move new indents from draft → open on first save-with-oracles
CREATE OR REPLACE FUNCTION public.indent_default_status()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status IS NULL OR NEW.status = '' THEN
    NEW.status := 'open';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_indent_default_status ON public.indents;
CREATE TRIGGER trg_indent_default_status
  BEFORE INSERT ON public.indents
  FOR EACH ROW EXECUTE FUNCTION public.indent_default_status();
