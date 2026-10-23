-- =====================================================================
-- JSON serial sanitizers (2026-10-22)
--
-- Document JSON is the one place a CHECK constraint cannot cleanly express
-- "no punctuation-only serial" without subqueries. These BEFORE triggers
-- strip placeholder tokens from item arrays on write:
--   grns.items, delivery_challans.items, general_delivery_challans.items,
--   gatepasses.items, tickets.*_parts_details, indents.oracles_data
--
-- They never remove an item and never touch qty. Scalar columns are covered
-- by CHECK constraints in 20261023000000_serial_constraints.sql.
--
-- RUN: supabase db push (DBA runs it; app code never writes DB)
-- =====================================================================

-- Clean one key inside an array of objects (used by indents.oracles_data).
CREATE OR REPLACE FUNCTION public.serial_strip_placeholder_array_key(
  p_items jsonb,
  p_key text
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(jsonb_agg(
    CASE
      WHEN elem ? p_key AND public.is_placeholder_serial(elem->>p_key)
        THEN jsonb_set(elem, ARRAY[p_key], '""'::jsonb, true)
      ELSE elem
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) AS elem;
$$;

CREATE OR REPLACE FUNCTION public.sanitize_json_items_serials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Rollback path restores exact before-images; do not re-clean them.
  IF current_setting('app.serial_repair_restore', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.items IS NOT NULL AND jsonb_typeof(NEW.items) = 'array' THEN
    NEW.items := public.serial_strip_placeholder_in_object_array(NEW.items);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sanitize_ticket_parts_serials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.serial_repair_restore', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.good_parts_details IS NOT NULL
     AND jsonb_typeof(NEW.good_parts_details) = 'array' THEN
    NEW.good_parts_details :=
      public.serial_strip_placeholder_in_object_array(NEW.good_parts_details);
  END IF;
  IF NEW.defective_parts_details IS NOT NULL
     AND jsonb_typeof(NEW.defective_parts_details) = 'array' THEN
    NEW.defective_parts_details :=
      public.serial_strip_placeholder_in_object_array(NEW.defective_parts_details);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sanitize_indent_oracle_serials()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  b jsonb;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF current_setting('app.serial_repair_restore', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.oracles_data IS NULL OR jsonb_typeof(NEW.oracles_data) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR b IN SELECT * FROM jsonb_array_elements(NEW.oracles_data) LOOP
    IF b ? 'defective_rows' THEN
      b := jsonb_set(b, '{defective_rows}',
             public.serial_strip_placeholder_array_key(b->'defective_rows', 'def_serial_no'), false);
    END IF;
    IF b ? 'exchange_rows' THEN
      b := jsonb_set(b, '{exchange_rows}',
             public.serial_strip_placeholder_array_key(b->'exchange_rows', 'serial_no'), false);
    END IF;
    IF b ? 'received_rows' THEN
      b := jsonb_set(b, '{received_rows}',
             public.serial_strip_placeholder_array_key(b->'received_rows', 'serial_no'), false);
    END IF;
    IF b ? 'customer_received_rows' THEN
      b := jsonb_set(b, '{customer_received_rows}',
             public.serial_strip_placeholder_array_key(b->'customer_received_rows', 'serial_no'), false);
    END IF;
    v_out := v_out || jsonb_build_array(b);
  END LOOP;

  NEW.oracles_data := v_out;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sanitize_grns_items_serials ON public.grns;
CREATE TRIGGER trg_sanitize_grns_items_serials
  BEFORE INSERT OR UPDATE OF items ON public.grns
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_json_items_serials();

DROP TRIGGER IF EXISTS trg_sanitize_dc_items_serials ON public.delivery_challans;
CREATE TRIGGER trg_sanitize_dc_items_serials
  BEFORE INSERT OR UPDATE OF items ON public.delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_json_items_serials();

DROP TRIGGER IF EXISTS trg_sanitize_general_dc_items_serials ON public.general_delivery_challans;
CREATE TRIGGER trg_sanitize_general_dc_items_serials
  BEFORE INSERT OR UPDATE OF items ON public.general_delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_json_items_serials();

DROP TRIGGER IF EXISTS trg_sanitize_gatepass_items_serials ON public.gatepasses;
CREATE TRIGGER trg_sanitize_gatepass_items_serials
  BEFORE INSERT OR UPDATE OF items ON public.gatepasses
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_json_items_serials();

DROP TRIGGER IF EXISTS trg_sanitize_ticket_parts_serials ON public.tickets;
CREATE TRIGGER trg_sanitize_ticket_parts_serials
  BEFORE INSERT OR UPDATE OF good_parts_details, defective_parts_details ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_ticket_parts_serials();

DROP TRIGGER IF EXISTS trg_sanitize_indent_oracle_serials ON public.indents;
CREATE TRIGGER trg_sanitize_indent_oracle_serials
  BEFORE INSERT OR UPDATE OF oracles_data ON public.indents
  FOR EACH ROW EXECUTE FUNCTION public.sanitize_indent_oracle_serials();

GRANT EXECUTE ON FUNCTION public.serial_strip_placeholder_array_key(jsonb, text) TO authenticated, service_role;
