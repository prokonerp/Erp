
CREATE OR REPLACE FUNCTION public._oracle_row_str(v JSONB, k TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT btrim(COALESCE(v ->> k, '')) $$;

CREATE OR REPLACE FUNCTION public._oracle_block_complete(blk JSONB) RETURNS BOOLEAN
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  drows JSONB := COALESCE(blk->'defective_rows','[]'::jsonb);
  erows JSONB := COALESCE(blk->'exchange_rows','[]'::jsonb);
  rrows JSONB := COALESCE(blk->'received_rows','[]'::jsonb);
  n INT := jsonb_array_length(drows);
  i INT;
  d JSONB; e JSONB; r JSONB;
BEGIN
  IF n = 0 THEN RETURN FALSE; END IF;
  IF jsonb_array_length(erows) < n OR jsonb_array_length(rrows) < n THEN RETURN FALSE; END IF;
  FOR i IN 0..n-1 LOOP
    d := drows -> i; e := erows -> i; r := rrows -> i;
    IF public._oracle_row_str(d,'def_model_no') = '' OR public._oracle_row_str(d,'def_serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(d,'qty') = '' OR (public._oracle_row_str(d,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(e,'warehouse_id') = '' OR public._oracle_row_str(e,'model_no') = '' OR public._oracle_row_str(e,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(e,'qty') = '' OR (public._oracle_row_str(e,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'warehouse_id') = '' OR public._oracle_row_str(r,'model_no') = '' OR public._oracle_row_str(r,'serial_no') = '' THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'qty') = '' OR (public._oracle_row_str(r,'qty'))::numeric <= 0 THEN RETURN FALSE; END IF;
    IF public._oracle_row_str(r,'received_date') = '' THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
END $$;

DO $$
DECLARE
  r RECORD;
  new_blocks JSONB;
  blk JSONB;
  changed BOOLEAN;
  now_ts TEXT := to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  FOR r IN SELECT id, oracles_data FROM public.indents WHERE oracles_data IS NOT NULL LOOP
    new_blocks := '[]'::jsonb;
    changed := FALSE;
    FOR blk IN SELECT * FROM jsonb_array_elements(r.oracles_data) LOOP
      IF COALESCE(blk->>'status','open') <> 'closed' AND public._oracle_block_complete(blk) THEN
        blk := blk || jsonb_build_object(
          'status','closed',
          'closed_at', now_ts,
          'closed_by', COALESCE(blk->'closed_by','null'::jsonb),
          'closed_by_name', COALESCE(blk->'closed_by_name', to_jsonb('System (backfill)'::text))
        );
        changed := TRUE;
      END IF;
      new_blocks := new_blocks || jsonb_build_array(blk);
    END LOOP;
    IF changed THEN
      UPDATE public.indents SET oracles_data = new_blocks, updated_at = now() WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

-- Keep the helpers so future ingest paths can reuse the same completeness check.
