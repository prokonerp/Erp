-- 1. Completeness check, with customer-return section made conditional
DROP FUNCTION IF EXISTS public._oracle_block_complete(jsonb);

CREATE OR REPLACE FUNCTION public._oracle_block_complete(blk jsonb, _require_customer boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
DECLARE
  drows JSONB := COALESCE(blk->'defective_rows','[]'::jsonb);
  erows JSONB := COALESCE(blk->'exchange_rows','[]'::jsonb);
  rrows JSONB := COALESCE(blk->'received_rows','[]'::jsonb);
  crows JSONB := COALESCE(blk->'customer_received_rows','[]'::jsonb);
  n INT := jsonb_array_length(drows);
  i INT;
  d JSONB; e JSONB; r JSONB; c JSONB;
  need_cust BOOLEAN := _require_customer;
  cust_touched BOOLEAN := false;
BEGIN
  IF n = 0 THEN RETURN FALSE; END IF;
  IF jsonb_array_length(erows) < n OR jsonb_array_length(rrows) < n THEN RETURN FALSE; END IF;

  -- Any partially-filled customer-return row makes section D mandatory.
  IF jsonb_array_length(crows) > 0 THEN
    FOR i IN 0..jsonb_array_length(crows)-1 LOOP
      c := crows -> i;
      IF public._oracle_row_str(c,'warehouse_id') <> ''
         OR public._oracle_row_str(c,'serial_no') <> ''
         OR public._oracle_row_str(c,'received_date') <> '' THEN
        cust_touched := true;
      END IF;
    END LOOP;
  END IF;
  IF cust_touched THEN need_cust := true; END IF;

  IF need_cust AND jsonb_array_length(crows) < n THEN RETURN FALSE; END IF;

  FOR i IN 0..n-1 LOOP
    d := drows -> i; e := erows -> i; r := rrows -> i;
    -- Section A: Defective
    IF public._oracle_row_str(d,'def_model_no') = '' OR public._oracle_row_str(d,'def_serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(d,'qty') = '' OR (public._oracle_row_str(d,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    -- Section B: Exchange
    IF public._oracle_row_str(e,'warehouse_id') = '' OR public._oracle_row_str(e,'model_no') = '' OR public._oracle_row_str(e,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(e,'qty') = '' OR (public._oracle_row_str(e,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    -- Section C: Material Received (from OEM)
    IF public._oracle_row_str(r,'warehouse_id') = '' OR public._oracle_row_str(r,'model_no') = '' OR public._oracle_row_str(r,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'qty') = '' OR (public._oracle_row_str(r,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'received_date') = '' THEN RETURN FALSE; END IF;
    -- Section D: Material Received (from Customer) — conditional
    IF need_cust THEN
      c := crows -> i;
      IF public._oracle_row_str(c,'warehouse_id') = '' OR public._oracle_row_str(c,'model_no') = '' OR public._oracle_row_str(c,'serial_no') = '' THEN RETURN FALSE; END IF;
      IF public._oracle_row_str(c,'qty') = '' OR (public._oracle_row_str(c,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
      IF public._oracle_row_str(c,'received_date') = '' THEN RETURN FALSE; END IF;
      IF public._oracle_row_str(c,'product_tag') = '' THEN RETURN FALSE; END IF;
    END IF;
  END LOOP;

  RETURN TRUE;
END
$fn$;

-- 2. Are there DC/GRN docs for this indent + oracle that are not yet settled?
CREATE OR REPLACE FUNCTION public.oracle_docs_pending(_indent_id uuid, _oracle_no text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  key TEXT := upper(btrim(COALESCE(_oracle_no,'')));
  hit INT := 0;
BEGIN
  IF _indent_id IS NULL THEN RETURN FALSE; END IF;

  SELECT count(*) INTO hit
    FROM public.delivery_challans dc
   WHERE dc.indent_id = _indent_id
     AND lower(COALESCE(dc.status,'')) <> 'cancelled'
     AND COALESCE(dc.status,'') NOT IN ('Submitted','Closed')
     AND (
       key = '' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(dc.items,'[]'::jsonb)) it
          WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key
       )
     );
  IF hit > 0 THEN RETURN TRUE; END IF;

  SELECT count(*) INTO hit
    FROM public.grns g
   WHERE g.indent_id = _indent_id
     AND lower(COALESCE(g.status,'')) <> 'cancelled'
     AND COALESCE(g.status,'') NOT IN ('Submitted','Closed')
     AND (
       key = '' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
          WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key
       )
     );
  RETURN hit > 0;
END
$fn$;

-- 3. Recompute closed-state for every block of an indent
CREATE OR REPLACE FUNCTION public.oracles_autoclose(_oracles jsonb, _indent_id uuid, _indent_type text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  out_arr JSONB := '[]'::jsonb;
  blk JSONB;
  need_cust BOOLEAN := COALESCE(_indent_type,'') <> 'rma_service_ship';
BEGIN
  IF _oracles IS NULL OR jsonb_typeof(_oracles) <> 'array' THEN RETURN _oracles; END IF;

  FOR blk IN SELECT value FROM jsonb_array_elements(_oracles) LOOP
    IF COALESCE(blk->>'status','open') <> 'closed'
       AND public._oracle_block_complete(blk, need_cust)
       AND NOT public.oracle_docs_pending(_indent_id, blk->>'oracle_no')
    THEN
      blk := blk
        || jsonb_build_object('status','closed')
        || jsonb_build_object('closed_at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
        || jsonb_build_object('closed_by_name', COALESCE(blk->>'closed_by_name','System (auto)'));
    END IF;
    out_arr := out_arr || jsonb_build_array(blk);
  END LOOP;

  RETURN out_arr;
END
$fn$;

-- 4. Apply on every indent write
CREATE OR REPLACE FUNCTION public.indents_autoclose_oracles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  NEW.oracles_data := public.oracles_autoclose(NEW.oracles_data, NEW.id, NEW.indent_type::text);
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_indents_autoclose_oracles ON public.indents;
CREATE TRIGGER trg_indents_autoclose_oracles
BEFORE INSERT OR UPDATE ON public.indents
FOR EACH ROW EXECUTE FUNCTION public.indents_autoclose_oracles();

-- 5. Re-evaluate the indent when a linked DC / GRN changes
CREATE OR REPLACE FUNCTION public.trg_indent_recalc_from_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _iid UUID := COALESCE(NEW.indent_id, OLD.indent_id);
BEGIN
  PERFORM public.recalc_indent_status(_iid);
  IF _iid IS NOT NULL THEN
    -- touching the row fires trg_indents_autoclose_oracles
    UPDATE public.indents SET updated_at = now() WHERE id = _iid;
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$fn$;

-- 6. Backfill: re-evaluate every existing indent once
UPDATE public.indents SET updated_at = updated_at WHERE oracles_data IS NOT NULL;
