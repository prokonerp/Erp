-- =============================================================================
-- SERIAL NUMBER CORRECTION PROPAGATION
-- =============================================================================
-- Goal: when an admin corrects a serial number in ONE place, that correction
-- must automatically ripple to EVERY table that stores the same serial value,
-- so stock, GRN/Oracle (indent), tickets, invoices, challans, gatepasses,
-- defective tags, installed equipment and the audit trail never diverge.
--
-- Source of truth = public.ims_stock_items.part_serial_no (UNIQUE, one row per
-- physical unit; every document links to stock by this value).
--
-- Trigger graph:
--   serials.serial_number  ──(UPDATE)──► ims_stock_items.part_serial_no
--                                                       │  (UPDATE)
--                                                       ▼
--                    propagate_serial_correction(old, new)  ──►  all other tables
--
-- A session flag (app.serial_propagation) is used to:
--   1. Prevent infinite trigger recursion between serials / ims_stock_items.
--   2. Bypass the "items are frozen after stock posted" guard on
--      delivery_challans / general_delivery_challans, so a correction can
--      propagate into already-dispatched/issued documents (intended behaviour).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Small helpers
-- -----------------------------------------------------------------------------

-- Replace an exact serial token inside a possibly comma-separated text field.
CREATE OR REPLACE FUNCTION public.serial_replace_token(_val text, _from text, _to text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _val IS NULL OR _from IS NULL OR _from = '' THEN _val
    ELSE (SELECT string_agg(CASE WHEN btrim(x) = _from THEN _to ELSE btrim(x) END, ', ' ORDER BY ord)
          FROM unnest(string_to_array(_val, ',')) WITH ORDINALITY AS t(x, ord))
  END;
$$;

-- Replace an exact serial string inside a JSON array of plain strings.
CREATE OR REPLACE FUNCTION public.serial_replace_json_strings(_arr jsonb, _from text, _to text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _arr IS NULL OR jsonb_typeof(_arr) <> 'array' THEN _arr
    ELSE COALESCE(
      (SELECT jsonb_agg(CASE WHEN btrim(COALESCE(elem #>> '{}','')) = _from THEN to_jsonb(_to) ELSE elem END)
       FROM jsonb_array_elements(_arr) AS elem),
      '[]'::jsonb)
  END;
$$;

-- Replace serials inside a single document line item (covers GRN / DC / GDC / gatepass keys).
CREATE OR REPLACE FUNCTION public.serial_replace_in_item(_it jsonb, _from text, _to text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          _it,
          '{serial_no}',
          to_jsonb(public.serial_replace_token(COALESCE(_it->>'serial_no',''), _from, _to)),
          false
        ),
        '{good_defective_serial}',
        to_jsonb(public.serial_replace_token(COALESCE(_it->>'good_defective_serial',''), _from, _to)),
        false
      ),
      '{serials}',
      public.serial_replace_json_strings(_it->'serials', _from, _to),
      false
    ),
    '{serial_numbers}',
    public.serial_replace_json_strings(_it->'serial_numbers', _from, _to),
    false
  );
$$;

-- Replace a given key's value (comma-aware) inside an array of objects (oracle rows).
CREATE OR REPLACE FUNCTION public.serial_replace_in_object_array(_arr jsonb, _key text, _from text, _to text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _arr IS NULL OR jsonb_typeof(_arr) <> 'array' THEN _arr
    ELSE COALESCE(
      (SELECT jsonb_agg(jsonb_set(o, ('{'||_key||'}')::text[], to_jsonb(public.serial_replace_token(COALESCE(o->>_key,''), _from, _to)), false))
       FROM jsonb_array_elements(_arr) AS o),
      '[]'::jsonb)
  END;
$$;

-- Is the serial-propagation flag currently on for this transaction?
CREATE OR REPLACE FUNCTION public.serial_propagation_on()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(current_setting('app.serial_propagation', true), '') = 'on';
$$;

-- -----------------------------------------------------------------------------
-- Master propagation routine
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.propagate_serial_correction(_old_serial text, _new_serial text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_new text;
  v_other int;
BEGIN
  v_old := NULLIF(btrim(COALESCE(_old_serial,'')), '');
  v_new := NULLIF(btrim(COALESCE(_new_serial,'')), '');
  IF v_old IS NULL OR v_new IS NULL OR v_old = v_new THEN
    RETURN;
  END IF;

  -- Turn on the session flag so nested triggers neither recurse nor enforce
  -- the frozen-items guard. LOCAL = auto-reset at end of transaction.
  PERFORM set_config('app.serial_propagation', 'on', true);

  -- Guard: the corrected serial must not already belong to a DIFFERENT stock unit.
  SELECT count(*) INTO v_other
    FROM public.ims_stock_items
   WHERE part_serial_no = v_new
     AND id <> (SELECT id FROM public.ims_stock_items WHERE part_serial_no = v_old LIMIT 1);
  IF v_other > 0 THEN
    RAISE EXCEPTION 'Serial correction blocked: "%" already exists on another stock record (%). Cannot merge.', v_new, v_other;
  END IF;

  -- Guard: the corrected serial must not collide with another catalog entry.
  SELECT count(*) INTO v_other
    FROM public.serials
   WHERE lower(coalesce(serial_number,'')) = lower(v_new)
     AND (SELECT id FROM public.serials WHERE lower(coalesce(serial_number,'')) = lower(v_old) LIMIT 1) IS DISTINCT FROM public.serials.id
     AND lower(coalesce(serial_number,'')) <> lower(v_old);
  IF v_other > 0 THEN
    RAISE EXCEPTION 'Serial correction blocked: "%" already exists in the serials catalog. Remove/rename it first.', v_new;
  END IF;

  -- ---- Plain text columns (exact token match) ----------------------------------
  UPDATE public.tickets              SET serial_no = public.serial_replace_token(serial_no, v_old, v_new)           WHERE serial_no LIKE '%'||v_old||'%';
  UPDATE public.defective_tags       SET serial_no = public.serial_replace_token(serial_no, v_old, v_new)           WHERE serial_no LIKE '%'||v_old||'%';
  UPDATE public.installed_equipment  SET serial_no = public.serial_replace_token(serial_no, v_old, v_new)           WHERE serial_no LIKE '%'||v_old||'%';

  -- Indents (typed serial columns + nested oracle blocks)
  UPDATE public.indents
     SET def_serial_no = public.serial_replace_token(def_serial_no, v_old, v_new),
         material_exchange_serial_no = public.serial_replace_token(material_exchange_serial_no, v_old, v_new),
         material_rec_serial_no = public.serial_replace_token(material_rec_serial_no, v_old, v_new),
         product_serial = public.serial_replace_token(product_serial, v_old, v_new)
   WHERE def_serial_no LIKE '%'||v_old||'%'
      OR material_exchange_serial_no LIKE '%'||v_old||'%'
      OR material_rec_serial_no LIKE '%'||v_old||'%'
      OR product_serial LIKE '%'||v_old||'%';

  UPDATE public.indents SET oracles_data = (
    SELECT COALESCE(jsonb_agg(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(
              b,
              '{defective_rows}',       public.serial_replace_in_object_array(b->'defective_rows',       'def_serial_no', v_old, v_new), false
            ),
            '{exchange_rows}',           public.serial_replace_in_object_array(b->'exchange_rows',           'serial_no', v_old, v_new), false
          ),
          '{received_rows}',             public.serial_replace_in_object_array(b->'received_rows',             'serial_no', v_old, v_new), false
        ),
        '{customer_received_rows}',      public.serial_replace_in_object_array(b->'customer_received_rows',      'serial_no', v_old, v_new), false
      )
    ), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(oracles_data,'[]'::jsonb)) AS b
  )
  WHERE oracles_data::text LIKE '%'||v_old||'%';

  -- ---- JSONB item arrays -------------------------------------------------------
  UPDATE public.grns SET items = (
    SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
  ) WHERE items::text LIKE '%'||v_old||'%';

  UPDATE public.delivery_challans SET items = (
    SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
  ) WHERE items::text LIKE '%'||v_old||'%';

  UPDATE public.general_delivery_challans SET items = (
    SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
  ) WHERE items::text LIKE '%'||v_old||'%';

  UPDATE public.gatepasses SET items = (
    SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
  ) WHERE items::text LIKE '%'||v_old||'%';

  -- ---- Invoice item serial array (TEXT[]) --------------------------------------
  UPDATE public.invoice_items
     SET serial_numbers = ARRAY(
       SELECT CASE WHEN e = v_old THEN v_new ELSE e END
         FROM unnest(serial_numbers) AS e
     )
   WHERE v_old = ANY(serial_numbers);

  -- ---- IMS audit / transfer denormalised copies --------------------------------
  UPDATE public.ims_transactions SET part_serial_no = v_new WHERE part_serial_no = v_old;
  UPDATE public.ims_transfers     SET part_serial_no = v_new WHERE part_serial_no = v_old;

  -- ---- Catalog entry ------------------------------------------------------------
  UPDATE public.serials SET serial_number = v_new
   WHERE lower(coalesce(serial_number,'')) = lower(v_old);

  -- Hand back to the caller; flag stays set until end of transaction.
END $$;

-- -----------------------------------------------------------------------------
-- Trigger on ims_stock_items.part_serial_no  (the canonical stock record)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_propagate_serial_correction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.part_serial_no IS DISTINCT FROM OLD.part_serial_no
     AND NOT public.serial_propagation_on() THEN
    PERFORM public.propagate_serial_correction(OLD.part_serial_no, NEW.part_serial_no);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_propagate_serial_correction ON public.ims_stock_items;
CREATE TRIGGER trg_propagate_serial_correction
  AFTER UPDATE OF part_serial_no ON public.ims_stock_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_propagate_serial_correction();


-- -----------------------------------------------------------------------------
-- Trigger on serials.serial_number  (Serials Manager catalog screen)
--   Funnels a catalog correction into ims_stock_items, which then cascades
--   everywhere via trg_propagate_serial_correction. We do NOT set the session
--   flag here: the stock UPDATE below fires the ims trigger, which performs the
--   full cascade (setting the flag itself so the nested catalog UPDATE is a
--   no-op and cannot recurse).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_serials_cascade_to_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_new text;
  v_other int;
BEGIN
  IF NEW.serial_number IS DISTINCT FROM OLD.serial_number
     AND NOT public.serial_propagation_on() THEN
    v_old := btrim(COALESCE(OLD.serial_number,''));
    v_new := btrim(COALESCE(NEW.serial_number,''));
    IF v_old <> '' AND v_new <> '' THEN
      -- Collision guard before touching the UNIQUE stock column.
      SELECT count(*) INTO v_other
        FROM public.ims_stock_items
       WHERE part_serial_no = v_new
         AND part_serial_no IS DISTINCT FROM v_old;
      IF v_other > 0 THEN
        RAISE EXCEPTION 'Serial correction blocked: "%" already exists on another stock record.', v_new;
      END IF;
      UPDATE public.ims_stock_items
         SET part_serial_no = v_new
       WHERE part_serial_no = v_old;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_serials_cascade_to_stock ON public.serials;
CREATE TRIGGER trg_serials_cascade_to_stock
  AFTER UPDATE OF serial_number ON public.serials
  FOR EACH ROW EXECUTE FUNCTION public.trg_serials_cascade_to_stock();

-- =============================================================================
-- Bypass the "items frozen after stock posted" guard for serial corrections.
-- Intended behaviour: a serial correction must propagate into already
-- dispatched/issued challans so stock and documents stay in sync.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.assert_items_frozen_after_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Serial-correction propagation is allowed to touch frozen line items.
  IF public.serial_propagation_on() THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'delivery_challans' THEN
    IF OLD.status IN ('Challan Generated','Submitted','Dispatched')
       AND NEW.items IS DISTINCT FROM OLD.items THEN
      RAISE EXCEPTION
        'Challan % is % — its items are frozen because stock has been posted. Cancel and re-raise instead.',
        COALESCE(OLD.challan_no, OLD.id), OLD.status;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'general_delivery_challans' THEN
    IF OLD.status IN ('Issued', 'Converted', 'Cancelled')
       AND NEW.items IS DISTINCT FROM OLD.items THEN
      RAISE EXCEPTION
        'General DC % is % — its items are frozen because stock has been posted/reversed.',
        COALESCE(OLD.dc_no, OLD.id), OLD.status;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- =============================================================================
-- Admin entry point: correct a serial directly ON the GRN.
--   Updates the GRN line item and the corresponding stock record; the
--   trg_propagate_serial_correction trigger then ripples it to every other
--   table automatically.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.correct_grn_serial(_grn_id uuid, _old_serial text, _new_serial text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gr public.grns%ROWTYPE;
  v_old text;
  v_new text;
  v_affected_items int := 0;
  v_other int;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can correct serial numbers';
  END IF;
  v_old := NULLIF(btrim(COALESCE(_old_serial,'')), '');
  v_new := NULLIF(btrim(COALESCE(_new_serial,'')), '');
  IF v_old IS NULL OR v_new IS NULL OR v_old = v_new THEN
    RAISE EXCEPTION 'Old and new serial numbers must be provided and different';
  END IF;

  SELECT * INTO gr FROM public.grns WHERE id = _grn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;

  -- Ensure the old serial is actually referenced on this GRN line item
  -- (checks serial_no, the serials/serial_numbers arrays, and good_defective_serial).
  SELECT count(*) INTO v_affected_items
    FROM public.grns, LATERAL jsonb_array_elements(COALESCE(items,'[]'::jsonb)) it
   WHERE grns.id = _grn_id
     AND public.serial_replace_in_item(it, v_old, v_new) IS DISTINCT FROM it;
  IF v_affected_items = 0 THEN
    RAISE EXCEPTION 'Serial "%" was not found on GRN %', v_old, COALESCE(gr.grn_no, gr.id::text);
  END IF;

  -- Collision guard against another stock unit already holding the new serial.
  SELECT count(*) INTO v_other
    FROM public.ims_stock_items
   WHERE part_serial_no = v_new
     AND part_serial_no IS DISTINCT FROM v_old;
  IF v_other > 0 THEN
    RAISE EXCEPTION 'Serial correction blocked: "%" already exists on another stock record.', v_new;
  END IF;

  -- Audit trail entry
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason,
     deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('grn_serial_correction', gr.category, gr.grn_no, gr.id, _reason,
     auth.uid(), gr.created_by, gr.created_at, jsonb_build_object('old_serial', v_old, 'new_serial', v_new));

  -- 1) Fix the GRN line item(s).
  UPDATE public.grns
     SET items = (
       SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
     )
   WHERE id = _grn_id;

  -- 2) Fix the stock record; the AFTER UPDATE trigger cascades everywhere else.
  UPDATE public.ims_stock_items
     SET part_serial_no = v_new
   WHERE part_serial_no = v_old;
END $$;

GRANT EXECUTE ON FUNCTION public.correct_grn_serial(uuid, text, text, text) TO authenticated;
