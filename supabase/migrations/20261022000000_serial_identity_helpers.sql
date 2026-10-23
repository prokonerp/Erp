-- =====================================================================
-- Serial identity helpers (2026-10-22)
--
-- Pure predicates + normalizers shared by the DB-side guards, the repair
-- scripts and (mirrored) src/lib/serial.ts. No table writes.
--
-- Contract:
--   identifying serial  = contains at least one ASCII letter or digit
--   placeholder serial  = non-empty, but contains no letter/digit
--   pooled serial       = NULL (stock/txn) or '' (text/jsonb) — legal
--
-- RUN: supabase db push (DBA runs it; app code never writes DB)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_identifying_serial(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_value IS NOT NULL AND btrim(p_value) ~ '[A-Za-z0-9]';
$$;

CREATE OR REPLACE FUNCTION public.is_placeholder_serial(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_value IS NOT NULL
     AND btrim(p_value) <> ''
     AND btrim(p_value) !~ '[A-Za-z0-9]';
$$;

-- Placeholder -> NULL. Callers that need '' wrap with coalesce(...,'').
CREATE OR REPLACE FUNCTION public.sanitize_serial(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN public.is_placeholder_serial(p_value) THEN NULL
    ELSE NULLIF(upper(btrim(p_value)), '')
  END;
$$;

-- Exact SQL mirror of identityKey(model, serial) in src/lib/serial.ts.
CREATE OR REPLACE FUNCTION public.normalize_serial_key(p_model text, p_serial text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT upper(btrim(coalesce(p_model, ''))) || '|' || upper(btrim(coalesce(p_serial, '')));
$$;

-- Comma string -> comma string with placeholders removed, order preserved,
-- duplicates collapsed by first occurrence. '' when nothing identifying.
CREATE OR REPLACE FUNCTION public.serial_strip_placeholder_tokens(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT string_agg(token, ',' ORDER BY first_ord)
  FROM (
    SELECT btrim(x) AS token, min(ord) AS first_ord
    FROM unnest(string_to_array(coalesce(p_value, ''), ',')) WITH ORDINALITY AS t(x, ord)
    WHERE public.is_identifying_serial(x)
    GROUP BY btrim(x)
  ) q;
$$;

-- One GRN/DC/gatepass item: strip placeholder serial fields, never touch qty,
-- never drop the item. Handles serial_no, serial, good_defective_serial,
-- good_serial, defective_serial, serials[], serial_numbers[].
CREATE OR REPLACE FUNCTION public.serial_strip_placeholder_in_item(p_item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_item jsonb := coalesce(p_item, '{}'::jsonb);
  v_arr jsonb;
BEGIN
  IF v_item ? 'serial_no' AND public.is_placeholder_serial(v_item->>'serial_no') THEN
    v_item := jsonb_set(v_item, '{serial_no}', '""'::jsonb, true);
  END IF;

  -- Ticket parts arrays use the key `serial`, not `serial_no`.
  IF v_item ? 'serial' AND public.is_placeholder_serial(v_item->>'serial') THEN
    v_item := jsonb_set(v_item, '{serial}', '""'::jsonb, true);
  END IF;

  IF v_item ? 'good_defective_serial'
     AND public.is_placeholder_serial(v_item->>'good_defective_serial') THEN
    v_item := jsonb_set(v_item, '{good_defective_serial}', '""'::jsonb, true);
  END IF;

  -- Delivery challan rows carry separate good/defective serial fields.
  IF v_item ? 'good_serial'
     AND public.is_placeholder_serial(v_item->>'good_serial') THEN
    v_item := jsonb_set(v_item, '{good_serial}', '""'::jsonb, true);
  END IF;

  IF v_item ? 'defective_serial'
     AND public.is_placeholder_serial(v_item->>'defective_serial') THEN
    v_item := jsonb_set(v_item, '{defective_serial}', '""'::jsonb, true);
  END IF;

  IF v_item ? 'serials' AND jsonb_typeof(v_item->'serials') = 'array' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      INTO v_arr
      FROM (
        SELECT btrim(x) AS t
        FROM jsonb_array_elements_text(v_item->'serials') AS x
        WHERE public.is_identifying_serial(x)
      ) q;
    v_item := jsonb_set(v_item, '{serials}', v_arr, true);
  END IF;

  IF v_item ? 'serial_numbers' AND jsonb_typeof(v_item->'serial_numbers') = 'array' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      INTO v_arr
      FROM (
        SELECT btrim(x) AS t
        FROM jsonb_array_elements_text(v_item->'serial_numbers') AS x
        WHERE public.is_identifying_serial(x)
      ) q;
    v_item := jsonb_set(v_item, '{serial_numbers}', v_arr, true);
  END IF;

  RETURN v_item;
END;
$$;

-- Array of items -> array of cleaned items.
CREATE OR REPLACE FUNCTION public.serial_strip_placeholder_in_object_array(p_items jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(jsonb_agg(public.serial_strip_placeholder_in_item(elem)), '[]'::jsonb)
  FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) AS elem;
$$;

GRANT EXECUTE ON FUNCTION public.is_identifying_serial(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_placeholder_serial(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sanitize_serial(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_serial_key(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.serial_strip_placeholder_tokens(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.serial_strip_placeholder_in_item(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.serial_strip_placeholder_in_object_array(jsonb) TO authenticated, service_role;
