-- =============================================================================
-- SERIAL CORRECTION PROPAGATION — CRITICAL REPAIRS + COVERAGE + SECURITY
-- =============================================================================
-- Delta on top of 20260830000003_serial_correction_propagation.sql.
--
-- 1) DATA-CORRUPTION FIX (critical): serial_replace_token() and
--    serial_replace_json_strings() returned SQL NULL when the field was absent
--    or empty. That NULL flowed into jsonb_set(..., NULL) inside
--    serial_replace_in_item(), which makes jsonb_set return NULL for the whole
--    document, so jsonb_agg() collapsed every GRN / DC / GDC / gatepass items
--    array to `[null]`. Any single correction therefore destroyed the line
--    items of every affected document. Both helpers are now "total" (never
--    NULL) and no field is ever injected with NULL, so documents are preserved
--    byte-for-byte except for the serial values that actually changed.
--
-- 2) SERIALS-MANAGER CASCADE FIX: propagate_serial_correction() is reached with
--    the source catalog row already holding the NEW serial (trg_serials_cascade
--    _to_stock renames serials.serial_number first, then updates stock). The
--    old "catalog collision" guard then mis-read that row as a DIFFERENT entry
--    already owning the new serial and raised "already exists in the serials
--    catalog", making it impossible to correct a serial from the Serials
--    Manager screen. The guard now only blocks when the old serial still exists
--    in the catalog (i.e. a genuinely different entry owns the new value).
--
-- 3) COVERAGE GAP: propagate_serial_correction only fixed tickets.serial_no.
--    Ticket rows also carry JSONB parts arrays that reference serial numbers:
--      - good_parts_details[].serial      (exchange part fitted on the ticket)
--      - defective_parts_details[].serial (defective part taken back)
--    In the real case GRN-OEM/26-27/0032 (oracle 41214317) these still held the
--    old serial after an admin correction. Both arrays are now rewritten.
--
-- 4) SECURITY GAP: propagate_serial_correction() is SECURITY DEFINER and (like
--    all new postgres functions) had EXECUTE granted to PUBLIC by default.
--    Because it is a void-returning function, PostgREST exposes it as a callable
--    RPC, so ANY authenticated user could rewrite serials across every table,
--    bypassing the admin-only guard. It is now restricted to service_role only.
--
-- This file only CREATE OR REPLACEs functions (no DDL that locks tables), so
-- applying it does not carry the AccessExclusiveLock deadlock risk of the
-- trigger DDL in 20260830000003.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Repair 1a: serial_replace_token — never return NULL.
-- Empty / absent / non-matching input is returned unchanged ('' not NULL), so
-- to_jsonb(...) below can never feed SQL NULL into jsonb_set.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.serial_replace_token(_val text, _from text, _to text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _from IS NULL OR _from = '' THEN COALESCE(_val,'')
    WHEN _val IS NULL OR btrim(_val) = '' THEN COALESCE(_val,'')
    ELSE COALESCE(
      (SELECT string_agg(CASE WHEN btrim(x) = _from THEN _to ELSE btrim(x) END, ', ' ORDER BY ord)
       FROM unnest(string_to_array(_val, ',')) WITH ORDINALITY AS t(x, ord)),
      COALESCE(_val,''))
  END;
$$;

-- -----------------------------------------------------------------------------
-- Repair 1b: serial_replace_json_strings — never return NULL.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.serial_replace_json_strings(_arr jsonb, _from text, _to text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _arr IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(_arr) <> 'array' THEN _arr
    ELSE COALESCE(
      (SELECT jsonb_agg(CASE WHEN btrim(COALESCE(elem #>> '{}','')) = _from THEN to_jsonb(_to) ELSE elem END)
       FROM jsonb_array_elements(_arr) AS elem),
      '[]'::jsonb)
  END;
$$;

-- -----------------------------------------------------------------------------
-- Repair 1c: serial_replace_in_object_array — never return NULL. The indents
-- oracles_data rewrite passes b->'defective_rows' etc., which is NULL when that
-- sub-key is absent; returning NULL then nulls the whole jsonb_set chain (the
-- same corruption the other two helpers caused). Return '[]' instead.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.serial_replace_in_object_array(_arr jsonb, _key text, _from text, _to text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _arr IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(_arr) <> 'array' THEN _arr
    ELSE COALESCE(
      (SELECT jsonb_agg(jsonb_set(o, ('{'||_key||'}')::text[], to_jsonb(public.serial_replace_token(COALESCE(o->>_key,''), _from, _to)), false))
       FROM jsonb_array_elements(_arr) AS o),
      '[]'::jsonb)
  END;
$$;

-- -----------------------------------------------------------------------------
-- Repair 1d: serial_replace_in_item — uses the now-total helpers, so no jsonb_set
-- call ever receives SQL NULL as its new_value and can never nuke the document.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- Master propagation routine (repaired).
--   - catalog collision guard: only blocks when the OLD serial still exists in
--     the catalog (a genuinely different entry owns the NEW value), so a rename
--     started from the Serials Manager is not falsely rejected.
--   - adds tickets.good_parts_details[].serial and
--     tickets.defective_parts_details[].serial to the propagated columns.
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
  -- Only counts when the old serial still exists in the catalog, i.e. the row
  -- holding the new value is a genuinely different entry (not the one we are
  -- renaming right now from the Serials Manager).
  SELECT count(*) INTO v_other
    FROM public.serials s
   WHERE lower(coalesce(s.serial_number,'')) = lower(v_new)
     AND lower(coalesce(s.serial_number,'')) <> lower(v_old)
     AND EXISTS (SELECT 1 FROM public.serials x WHERE lower(coalesce(x.serial_number,'')) = lower(v_old));
  IF v_other > 0 THEN
    RAISE EXCEPTION 'Serial correction blocked: "%" already exists in the serials catalog. Remove/rename it first.', v_new;
  END IF;

  -- ---- Plain text columns (exact token match) ----------------------------------
  UPDATE public.tickets              SET serial_no = public.serial_replace_token(serial_no, v_old, v_new)           WHERE serial_no LIKE '%'||v_old||'%';
  UPDATE public.defective_tags       SET serial_no = public.serial_replace_token(serial_no, v_old, v_new)           WHERE serial_no LIKE '%'||v_old||'%';
  UPDATE public.installed_equipment  SET serial_no = public.serial_replace_token(serial_no, v_old, v_new)           WHERE serial_no LIKE '%'||v_old||'%';

  -- ---- Tickets: JSONB parts arrays (good part fitted / defective part taken back)
  UPDATE public.tickets SET good_parts_details = (
    SELECT COALESCE(jsonb_agg(
      jsonb_set(elem, '{serial}', to_jsonb(public.serial_replace_token(COALESCE(elem->>'serial',''), v_old, v_new)), false)
    ), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(good_parts_details,'[]'::jsonb)) AS elem
  ) WHERE good_parts_details::text LIKE '%'||v_old||'%';

  UPDATE public.tickets SET defective_parts_details = (
    SELECT COALESCE(jsonb_agg(
      jsonb_set(elem, '{serial}', to_jsonb(public.serial_replace_token(COALESCE(elem->>'serial',''), v_old, v_new)), false)
    ), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(defective_parts_details,'[]'::jsonb)) AS elem
  ) WHERE defective_parts_details::text LIKE '%'||v_old||'%';

  -- ---- Indents (typed serial columns + nested oracle blocks)
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
-- Repair 5: assert_items_frozen_after_post used COALESCE(OLD.challan_no, OLD.id),
-- but challan_no / dc_no are TEXT while id is uuid, so PostgreSQL raised
-- "COALESCE types text and uuid cannot be matched" the moment a frozen challan
-- was touched, turning the intended friendly block into a crash and — worse —
-- skipping the intended freeze message. Cast to text so the guard reports the
-- correct exception.
-- -----------------------------------------------------------------------------
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
        COALESCE(OLD.challan_no, OLD.id::text), OLD.status;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'general_delivery_challans' THEN
    IF OLD.status IN ('Issued', 'Converted', 'Cancelled')
       AND NEW.items IS DISTINCT FROM OLD.items THEN
      RAISE EXCEPTION
        'General DC % is % — its items are frozen because stock has been posted/reversed.',
        COALESCE(OLD.dc_no, OLD.id::text), OLD.status;
    END IF;
  END IF;

  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- Security: the master propagation routine may only be invoked from inside the
-- trigger chain or by the service role for a controlled one-off sync. It must
-- NEVER be exposed as an RPC to the application roles.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.propagate_serial_correction(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.propagate_serial_correction(text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.propagate_serial_correction(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.propagate_serial_correction(text, text) TO service_role;

-- Keep the correct_grn_serial admin entry point callable (it enforces its own
-- admin check and is the only application-facing RPC for corrections).
GRANT EXECUTE ON FUNCTION public.correct_grn_serial(uuid, text, text, text) TO authenticated;