
-- ============================================================
-- Backfill: DC → IMS
-- Idempotent per (DC reference + serial). Best-effort stock update.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_dc_to_ims(_dc_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  dc public.delivery_challans%ROWTYPE;
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT;
  ref TEXT;
  target_type public.ims_stock_type;
  txn_type_v public.ims_txn_type;
  target_status public.ims_stock_status;
  stock_row public.ims_stock_items%ROWTYPE;
  inserted_count int := 0;
  exists_txn boolean;
BEGIN
  SELECT * INTO dc FROM public.delivery_challans WHERE id = _dc_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF dc.status NOT IN ('Challan Generated','Submitted') THEN RETURN 0; END IF;
  IF dc.items IS NULL OR jsonb_typeof(dc.items) <> 'array' THEN RETURN 0; END IF;

  IF dc.doc_type = 'customer' THEN
    target_type := 'good'::public.ims_stock_type;
    txn_type_v := 'good_out'::public.ims_txn_type;
    target_status := 'issued'::public.ims_stock_status;
  ELSIF dc.doc_type = 'oem' THEN
    target_type := 'defective'::public.ims_stock_type;
    txn_type_v := 'defective_out'::public.ims_txn_type;
    target_status := 'returned_to_oem'::public.ims_stock_status;
  ELSE
    RETURN 0;
  END IF;

  ref := 'DC ' || dc.challan_no;

  FOR it IN SELECT * FROM jsonb_array_elements(dc.items) LOOP
    serial     := NULLIF(btrim(COALESCE(it->>'serial_no','')), '');
    model      := NULLIF(btrim(COALESCE(it->>'model_no','')), '');
    part_name_v:= NULLIF(btrim(COALESCE(it->>'part_name','')), '');
    oem_v      := NULLIF(btrim(COALESCE(it->>'oem','')), '');
    qty        := COALESCE((it->>'qty')::NUMERIC, 1);
    IF qty <= 0 THEN CONTINUE; END IF;

    -- Duplicate check: match on reference + serial (or reference + part_name when no serial)
    SELECT EXISTS (
      SELECT 1 FROM public.ims_transactions
       WHERE reference = ref
         AND ((serial IS NOT NULL AND part_serial_no = serial)
           OR (serial IS NULL AND part_serial_no IS NULL
               AND COALESCE(part_name,'') = COALESCE(part_name_v,'')
               AND COALESCE(part_model_no,'') = COALESCE(model,'')))
    ) INTO exists_txn;
    IF exists_txn THEN CONTINUE; END IF;

    stock_row := NULL;
    IF serial IS NOT NULL THEN
      SELECT * INTO stock_row FROM public.ims_stock_items
        WHERE part_serial_no = serial AND stock_type = target_type
          AND stock_status = 'available'::public.ims_stock_status
        LIMIT 1;
      IF FOUND THEN
        UPDATE public.ims_stock_items
           SET stock_status = target_status,
               transaction_ref = ref,
               updated_at = now()
         WHERE id = stock_row.id;
      END IF;
    END IF;

    INSERT INTO public.ims_transactions(
      txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
      from_warehouse_id, to_party, qty, indent_id, reference, notes, created_by, txn_date
    ) VALUES (
      txn_type_v, stock_row.id,
      COALESCE(part_name_v, stock_row.part_name),
      COALESCE(model, stock_row.part_model_no),
      serial,
      COALESCE(oem_v, stock_row.oem),
      stock_row.warehouse_id,
      COALESCE(dc.party_name, CASE WHEN dc.doc_type='oem' THEN 'OEM' ELSE 'Customer' END),
      qty, dc.indent_id, ref,
      'Backfilled from historical Delivery Challan', dc.created_by,
      COALESCE(dc.challan_date::timestamptz, dc.created_at)
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END $$;

-- ============================================================
-- Backfill: GRN → IMS (Submitted only)
-- Idempotent per (GRN reference + serial). Creates fresh stock rows only when missing.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_grn_to_ims(_grn_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gr public.grns%ROWTYPE;
  it JSONB;
  serial TEXT; qty NUMERIC; model TEXT; part_name_v TEXT; oem_v TEXT; batch_v TEXT; cond TEXT;
  ref TEXT;
  target_type public.ims_stock_type;
  target_status public.ims_stock_status;
  txn_type_v public.ims_txn_type;
  base_type public.ims_stock_type;
  base_txn public.ims_txn_type;
  new_id uuid;
  inserted_count int := 0;
  exists_txn boolean;
BEGIN
  SELECT * INTO gr FROM public.grns WHERE id = _grn_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF gr.status <> 'Submitted' THEN RETURN 0; END IF;
  IF gr.items IS NULL OR jsonb_typeof(gr.items) <> 'array' THEN RETURN 0; END IF;

  IF gr.category = 'customer' THEN
    base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
  ELSIF gr.category = 'oem' THEN
    base_type := 'good'::public.ims_stock_type; base_txn := 'good_in'::public.ims_txn_type;
  ELSE
    IF COALESCE(gr.stock_category,'good') = 'defective' THEN
      base_type := 'defective'::public.ims_stock_type; base_txn := 'defective_in'::public.ims_txn_type;
    ELSE
      base_type := 'good'::public.ims_stock_type; base_txn := 'good_in'::public.ims_txn_type;
    END IF;
  END IF;

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

    SELECT EXISTS (
      SELECT 1 FROM public.ims_transactions
       WHERE reference = ref
         AND ((serial IS NOT NULL AND part_serial_no = serial)
           OR (serial IS NULL AND part_serial_no IS NULL
               AND COALESCE(part_name,'') = COALESCE(part_name_v,'')
               AND COALESCE(part_model_no,'') = COALESCE(model,'')))
    ) INTO exists_txn;
    IF exists_txn THEN CONTINUE; END IF;

    IF gr.category = 'customer' THEN
      IF cond = 'good' THEN
        target_type := 'good'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'good_in'::public.ims_txn_type;
      ELSIF cond = 'scrap' THEN
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'scrapped'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      ELSE
        target_type := 'defective'::public.ims_stock_type;
        target_status := 'available'::public.ims_stock_status;
        txn_type_v := 'defective_in'::public.ims_txn_type;
      END IF;
    ELSE
      target_type := base_type;
      target_status := 'available'::public.ims_stock_status;
      txn_type_v := base_txn;
    END IF;

    INSERT INTO public.ims_stock_items(
      oem, part_name, part_model_no, part_serial_no, warehouse_id,
      stock_type, stock_status, qty, transaction_ref, notes, created_by
    ) VALUES (
      oem_v, COALESCE(part_name_v,'(unnamed)'), model, serial, gr.warehouse_id,
      target_type, target_status, qty, ref, batch_v, gr.created_by
    ) RETURNING id INTO new_id;

    INSERT INTO public.ims_transactions(
      txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
      to_warehouse_id, from_party, qty, indent_id, reference, notes, created_by, txn_date
    ) VALUES (
      txn_type_v, new_id, COALESCE(part_name_v,'(unnamed)'), model, serial, oem_v,
      gr.warehouse_id,
      COALESCE(gr.source_name, CASE gr.category WHEN 'oem' THEN 'OEM' WHEN 'customer' THEN 'Customer' ELSE 'General' END),
      qty, gr.indent_id, ref,
      'Backfilled from historical GRN', gr.created_by,
      COALESCE(gr.grn_date::timestamptz, gr.created_at)
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END $$;

-- ============================================================
-- Run backfill for ALL existing historical documents
-- ============================================================
DO $$
DECLARE
  r RECORD;
  total_dc int := 0;
  total_grn int := 0;
  n int;
BEGIN
  FOR r IN SELECT id FROM public.delivery_challans
           WHERE status IN ('Challan Generated','Submitted')
           ORDER BY created_at LOOP
    n := public.sync_dc_to_ims(r.id);
    total_dc := total_dc + n;
  END LOOP;

  FOR r IN SELECT id FROM public.grns
           WHERE status = 'Submitted'
           ORDER BY created_at LOOP
    n := public.sync_grn_to_ims(r.id);
    total_grn := total_grn + n;
  END LOOP;

  RAISE NOTICE 'IMS backfill complete — DC transactions created: %, GRN transactions created: %', total_dc, total_grn;
END $$;
