-- Migration: 20260923000005_guard_stock_rpcs.sql
-- Remediation M1: guard direct authenticated calls to stock-mutating RPCs.
--
-- CONTEXT:
--   Legitimate writers of ims_stock_items via these helpers are (a) DB triggers
--   (invoice/DC/SO cancel + posting paths, e.g. trg_invoice_cancel_restore_pooled,
--   dc_post_inventory, invoice_item_sync_serials) and (b) service_role server code
--   / manual SQL-editor repair. No direct app callers exist in src/ (only generated
--   types in src/integrations/supabase/types.ts plus comments); server fns run as
--   service_role, where auth.uid() is NULL.
--   The entry guard below therefore blocks ONLY direct authenticated calls from
--   users lacking ims edit rights, while:
--     - trigger path: pg_trigger_depth() >= 1 inside any trigger execution, so
--       document cancels/postings keep working; existing EXECUTE grants are
--       untouched and stay in place for the trigger-internal calls;
--     - service_role / SQL-editor path: auth.uid() IS NULL, so server functions
--       and manual repair keep working.
--   has_permission() itself returns true for admins (early return), so admins
--   retain direct-call access via their ims edit-equivalent rights.
--
-- SAFE: additive guard only. CREATE OR REPLACE with bodies otherwise byte-identical
--   to sources. No table changes, no data changes, no trigger rewiring.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE / DROP TABLE /
--   DROP COLUMN statements and zero GRANT/REVOKE changes (grants are preserved
--   automatically by CREATE OR REPLACE).
--
-- Overload inventory (see report): the setup script defined three ims_deduct_qty
--   texts, but lines 8530-8531 of supabase/setup_new_supabase.sql explicitly
--     DROP FUNCTION IF EXISTS public.ims_deduct_qty(text, uuid,
--       public.ims_stock_type, numeric, text, public.ims_stock_status, text);
--     DROP FUNCTION IF EXISTS public.ims_deduct_qty(text, uuid,
--       public.ims_stock_type, numeric, text, public.ims_stock_status, text, boolean);
--   before creating the RETURNS TABLE variant, and no later migration re-creates
--   them. The 8-arg RETURNS uuid text cannot coexist with the live 8-arg RETURNS
--   TABLE variant (same signature, different return type: CREATE OR REPLACE would
--   raise "cannot change return type"). Live DB evidence (generated types.ts shows
--   ims_deduct_qty returning {qty_taken, stock_item_id}[]) confirms the TABLE
--   variant is the live one. Guarded below: ims_add_qty (7-arg uuid), the live
--   ims_deduct_qty (8-arg TABLE), invoice_cancel_restore_pooled (trigger).
--   The two dropped/superseded deduct texts are intentionally NOT re-created:
--   resurrecting them would expand the callable API (scope creep) or error.

-- =====================================================================
-- 1) public.ims_add_qty (source: setup_new_supabase.sql lines 7569-7613)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ims_add_qty(
  _model text,
  _warehouse uuid,
  _stock_type public.ims_stock_type,
  _qty numeric,
  _part_name text,
  _oem text,
  _ref text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target uuid;
BEGIN
  IF pg_trigger_depth() = 0 AND auth.uid() IS NOT NULL AND NOT public.has_permission(auth.uid(), 'ims', 'edit') THEN RAISE EXCEPTION 'Only stock editors may call % directly', 'ims_add_qty'; END IF;
  IF _model IS NULL OR _qty IS NULL OR _qty <= 0 THEN RETURN NULL; END IF;

  SELECT id INTO target
    FROM public.ims_stock_items
   WHERE part_model_no = _model
     AND stock_type = _stock_type
     AND stock_status = 'available'::public.ims_stock_status
     AND part_serial_no IS NULL
     AND warehouse_id IS NOT DISTINCT FROM _warehouse
   ORDER BY created_at ASC LIMIT 1;

  IF target IS NOT NULL THEN
    UPDATE public.ims_stock_items
       SET qty = qty + _qty, updated_at = now()
     WHERE id = target;
    RETURN target;
  END IF;

  INSERT INTO public.ims_stock_items(
    oem, part_name, part_model_no, part_serial_no, warehouse_id,
    stock_type, stock_status, qty, transaction_ref, notes
  ) VALUES (
    _oem, COALESCE(_part_name, _model), _model, NULL, _warehouse,
    _stock_type, 'available'::public.ims_stock_status, _qty, _ref,
    'Quantity received into warehouse pool'
  ) RETURNING id INTO target;

  RETURN target;
END $$;

-- =====================================================================
-- 2) public.ims_deduct_qty, live 8-arg RETURNS TABLE variant
--    (source: setup_new_supabase.sql lines 8533-8626)
-- =====================================================================
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
  IF pg_trigger_depth() = 0 AND auth.uid() IS NOT NULL AND NOT public.has_permission(auth.uid(), 'ims', 'edit') THEN RAISE EXCEPTION 'Only stock editors may call % directly', 'ims_deduct_qty'; END IF;
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

-- =====================================================================
-- 3) public.invoice_cancel_restore_pooled
--    (source: 20260914000001_so_stock_reversal_robustness.sql lines 36-148)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.invoice_cancel_restore_pooled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ii RECORD;
  v_model TEXT;
  v_part_name TEXT;
  v_oem TEXT;
  v_qty NUMERIC;
  v_qty_text TEXT;
  v_added_id UUID;
  v_inv_no TEXT;
BEGIN
  IF pg_trigger_depth() = 0 AND auth.uid() IS NOT NULL AND NOT public.has_permission(auth.uid(), 'ims', 'edit') THEN RAISE EXCEPTION 'Only stock editors may call % directly', 'invoice_cancel_restore_pooled'; END IF;
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    -- Skip if stock was never posted (GDC-sourced invoice)
    IF COALESCE(NEW.skip_stock_posting, false) = true OR NEW.source_general_dc_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_inv_no := COALESCE(NEW.invoice_no, NEW.id::text);

    FOR ii IN SELECT * FROM public.invoice_items WHERE invoice_id = NEW.id LOOP
      -- Only pooled lines: serial_numbers IS NULL or empty
      IF ii.serial_numbers IS NOT NULL AND array_length(ii.serial_numbers, 1) > 0 THEN
        CONTINUE;
      END IF;

      -- Handle both text and numeric qty (qty may be stored as text in edge cases)
      BEGIN
        v_qty_text := btrim(ii.qty::text);
        IF v_qty_text IS NULL OR v_qty_text = '' THEN
          v_qty := 0;
        ELSE
          v_qty := v_qty_text::numeric;
        END IF;
      EXCEPTION WHEN others THEN
        v_qty := 0;
      END;

      IF v_qty IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      -- Resolve model via COALESCE(ii.part_model_no, ii.part_name, 'Unknown')
      -- Fallback chain: part_model_no -> part_name -> description -> Unknown
      -- Uses columns ensured above; if product_id present, try product master for richer oem/name
      v_model := COALESCE(
        NULLIF(btrim(COALESCE(ii.part_model_no, '')), ''),
        NULLIF(btrim(COALESCE(ii.part_name, '')), ''),
        NULLIF(btrim(COALESCE(ii.description, '')), ''),
        'Unknown'
      );

      v_part_name := COALESCE(
        NULLIF(btrim(COALESCE(ii.part_name, '')), ''),
        NULLIF(btrim(COALESCE(ii.description, '')), ''),
        v_model
      );

      v_oem := NULLIF(btrim(COALESCE(ii.oem, '')), '');
      IF (v_oem IS NULL OR v_oem = '') AND ii.product_id IS NOT NULL THEN
        BEGIN
          SELECT NULLIF(btrim(COALESCE(p.oem, p.brand, '')), '') INTO v_oem
          FROM public.products p WHERE p.id = ii.product_id;
        EXCEPTION WHEN others THEN
          v_oem := NULL;
        END;
      END IF;
      -- Fallback to invoice buyer snapshot oem? Keep null if unknown
      IF v_oem = '' THEN v_oem := NULL; END IF;

      -- Restore pooled qty back into warehouse pool
      BEGIN
        v_added_id := public.ims_add_qty(
          v_model,
          ii.warehouse_id,
          'good'::public.ims_stock_type,
          v_qty,
          v_part_name,
          v_oem,
          'Invoice ' || v_inv_no
        );
      EXCEPTION WHEN others THEN
        -- Do not block cancellation if stock restore fails; still log transaction
        v_added_id := NULL;
      END;

      -- Log reversal transaction: good_in, reference 'Invoice '||invoice_no
      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, reference, notes, created_by
      ) VALUES (
        'good_in'::public.ims_txn_type,
        v_added_id,
        v_part_name,
        v_model,
        NULL,
        v_oem,
        ii.warehouse_id,
        COALESCE(NEW.buyer_name, 'Customer'),
        v_qty,
        'Invoice ' || v_inv_no,
        'Reversal: Invoice cancelled',
        NEW.created_by
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
