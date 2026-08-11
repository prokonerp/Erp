
CREATE OR REPLACE FUNCTION public.oracle_docs_satisfied(_indent_id uuid, blk jsonb, _require_customer boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  key TEXT := upper(btrim(COALESCE(blk->>'oracle_no','')));
  erows JSONB := COALESCE(blk->'exchange_rows','[]'::jsonb);
  rrows JSONB := COALESCE(blk->'received_rows','[]'::jsonb);
  crows JSONB := COALESCE(blk->'customer_received_rows','[]'::jsonb);
  need_dc BOOLEAN := false;
  need_oem BOOLEAN := false;
  need_cust BOOLEAN := false;
  cust_touched BOOLEAN := false;
  el JSONB;
  pend INT; done INT;
BEGIN
  IF _indent_id IS NULL THEN RETURN FALSE; END IF;

  FOR el IN SELECT value FROM jsonb_array_elements(erows) LOOP
    IF public._oracle_row_str(el,'warehouse_id') <> '' OR public._oracle_row_str(el,'model_no') <> ''
       OR public._oracle_row_str(el,'serial_no') <> '' OR public._oracle_row_str(el,'qty') <> '' THEN
      need_dc := true;
    END IF;
  END LOOP;

  FOR el IN SELECT value FROM jsonb_array_elements(rrows) LOOP
    IF public._oracle_row_str(el,'warehouse_id') <> '' OR public._oracle_row_str(el,'model_no') <> ''
       OR public._oracle_row_str(el,'serial_no') <> '' OR public._oracle_row_str(el,'qty') <> '' THEN
      need_oem := true;
    END IF;
  END LOOP;

  FOR el IN SELECT value FROM jsonb_array_elements(crows) LOOP
    IF public._oracle_row_str(el,'warehouse_id') <> '' OR public._oracle_row_str(el,'model_no') <> ''
       OR public._oracle_row_str(el,'serial_no') <> '' OR public._oracle_row_str(el,'qty') <> '' THEN
      cust_touched := true;
    END IF;
  END LOOP;
  need_cust := (_require_customer AND jsonb_array_length(crows) > 0) OR cust_touched;

  -- Delivery Challan (Section B)
  IF need_dc THEN
    SELECT
      count(*) FILTER (WHERE COALESCE(dc.status,'') NOT IN ('Submitted','Closed')),
      count(*) FILTER (WHERE COALESCE(dc.status,'') IN ('Submitted','Closed'))
      INTO pend, done
      FROM public.delivery_challans dc
     WHERE dc.indent_id = _indent_id
       AND lower(COALESCE(dc.status,'')) <> 'cancelled'
       AND (key = '' OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(dc.items,'[]'::jsonb)) it
              WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key));
    IF COALESCE(done,0) = 0 OR COALESCE(pend,0) > 0 THEN RETURN FALSE; END IF;
  END IF;

  -- OEM GRN (Section C)
  IF need_oem THEN
    SELECT
      count(*) FILTER (WHERE COALESCE(g.status,'') NOT IN ('Submitted','Closed')),
      count(*) FILTER (WHERE COALESCE(g.status,'') IN ('Submitted','Closed'))
      INTO pend, done
      FROM public.grns g
     WHERE g.indent_id = _indent_id
       AND lower(COALESCE(g.status,'')) <> 'cancelled'
       AND COALESCE(g.category,'') <> 'customer'
       AND (key = '' OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
              WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key));
    IF COALESCE(done,0) = 0 OR COALESCE(pend,0) > 0 THEN RETURN FALSE; END IF;
  END IF;

  -- Customer GRN (Section D)
  IF need_cust THEN
    SELECT
      count(*) FILTER (WHERE COALESCE(g.status,'') NOT IN ('Submitted','Closed')),
      count(*) FILTER (WHERE COALESCE(g.status,'') IN ('Submitted','Closed'))
      INTO pend, done
      FROM public.grns g
     WHERE g.indent_id = _indent_id
       AND lower(COALESCE(g.status,'')) <> 'cancelled'
       AND COALESCE(g.category,'') = 'customer'
       AND (key = '' OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
              WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key));
    IF COALESCE(done,0) = 0 OR COALESCE(pend,0) > 0 THEN RETURN FALSE; END IF;
  END IF;

  RETURN TRUE;
END
$function$;

CREATE OR REPLACE FUNCTION public.oracles_autoclose(_oracles jsonb, _indent_id uuid, _indent_type text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  out_arr JSONB := '[]'::jsonb;
  blk JSONB;
  need_cust BOOLEAN := COALESCE(_indent_type,'') <> 'rma_service_ship';
BEGIN
  IF _oracles IS NULL OR jsonb_typeof(_oracles) <> 'array' THEN RETURN _oracles; END IF;

  FOR blk IN SELECT value FROM jsonb_array_elements(_oracles) LOOP
    IF COALESCE(blk->>'status','open') <> 'closed'
       AND public._oracle_block_complete(blk, need_cust)
       AND public.oracle_docs_satisfied(_indent_id, blk, need_cust)
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
$function$;
