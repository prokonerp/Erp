
-- 1. Extend completeness check to Section D (customer received rows).
CREATE OR REPLACE FUNCTION public._oracle_block_complete(blk jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  drows JSONB := COALESCE(blk->'defective_rows','[]'::jsonb);
  erows JSONB := COALESCE(blk->'exchange_rows','[]'::jsonb);
  rrows JSONB := COALESCE(blk->'received_rows','[]'::jsonb);
  crows JSONB := COALESCE(blk->'customer_received_rows','[]'::jsonb);
  n INT := jsonb_array_length(drows);
  i INT;
  d JSONB; e JSONB; r JSONB; c JSONB;
BEGIN
  IF n = 0 THEN RETURN FALSE; END IF;
  IF jsonb_array_length(erows) < n OR jsonb_array_length(rrows) < n OR jsonb_array_length(crows) < n THEN RETURN FALSE; END IF;
  FOR i IN 0..n-1 LOOP
    d := drows -> i; e := erows -> i; r := rrows -> i; c := crows -> i;
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
    -- Section D: Material Received (from Customer)
    IF public._oracle_row_str(c,'warehouse_id') = '' OR public._oracle_row_str(c,'model_no') = '' OR public._oracle_row_str(c,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(c,'qty') = '' OR (public._oracle_row_str(c,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(c,'received_date') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(c,'product_tag') = '' THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $function$;

-- 2. Recalculate every indent's oracle statuses per the new rule.
DO $$
DECLARE
  rec RECORD;
  arr JSONB;
  out_arr JSONB;
  blk JSONB;
  new_blk JSONB;
  complete BOOLEAN;
  cur_status TEXT;
  now_ts TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  FOR rec IN SELECT id, oracles_data FROM public.indents WHERE oracles_data IS NOT NULL LOOP
    arr := rec.oracles_data;
    IF jsonb_typeof(arr) <> 'array' THEN CONTINUE; END IF;
    out_arr := '[]'::jsonb;
    FOR blk IN SELECT * FROM jsonb_array_elements(arr) LOOP
      complete := public._oracle_block_complete(blk);
      cur_status := COALESCE(blk->>'status','open');
      IF complete AND cur_status <> 'closed' THEN
        new_blk := blk
          || jsonb_build_object('status','closed')
          || jsonb_build_object('closed_at', COALESCE(blk->>'closed_at', now_ts));
      ELSIF (NOT complete) AND cur_status = 'closed' THEN
        -- Previously closed under looser rule; reopen to reflect Section D gap.
        new_blk := blk
          || jsonb_build_object('status','open','closed_by',NULL,'closed_by_name',NULL,'closed_at',NULL);
      ELSE
        new_blk := blk;
      END IF;
      out_arr := out_arr || jsonb_build_array(new_blk);
    END LOOP;
    IF out_arr IS DISTINCT FROM arr THEN
      UPDATE public.indents SET oracles_data = out_arr, updated_at = now() WHERE id = rec.id;
    END IF;
  END LOOP;
END $$;
