-- Migration: 20260925000004_fix_stock_status_enum_compare.sql
-- Purpose: hotfix for 20260925000002 — live failure in production.
--
-- ROOT CAUSE: ims_stock_items.stock_status is the ENUM ims_stock_status
-- (setup_new_supabase.sql:1970), not text. 000002 filtered it with
--   COALESCE(stock_status, '') NOT IN ('returned_to_oem', 'scrapped')
-- which coerces '' to the enum and raises
--   22P02 invalid input value for enum ims_stock_status: ""
-- on EVERY call, breaking get_engineer_material_stats (400 on the RPC),
-- my_stock_custody, and admin_stock_custody. The scratch harness missed it
-- because its stub column was text.
--
-- FIX: compare as text — `stock_status::text` works whether the column is
-- an enum, varchar, or text, so this survives any future type change too.
-- No signature changes; clients untouched.
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste this file → Run.
--   2) Verify: post-conditions RAISE on any miss; then
--        SELECT public.get_engineer_material_stats();
--      must return a jsonb (not 22P02), and reload the PostgREST schema
--      cache (NOTIFY pgrst, 'reload schema') before retesting the app.
--
-- Safety assertion (executable SQL): zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN in this file.
--
-- ROLLBACK (comments only): re-apply 20260925000002 (it restores the prior
-- bodies verbatim — which reintroduces this bug; rollback is NOT advised).

-- =====================================================================
-- 1) get_engineer_material_stats — enum-safe status filter
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_engineer_material_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp_id uuid;
  v_emp_name text;
  v_name_unique boolean := false;
  v_holding integer := 0;
  v_pending jsonb := '[]'::jsonb;
BEGIN
  SELECT e.id, e.name INTO v_emp_id, v_emp_name
  FROM public.employees e
  WHERE e.auth_user_id = auth.uid()
    AND e.active = true
  LIMIT 1;

  IF v_emp_id IS NULL THEN
    RETURN jsonb_build_object('holding', 0, 'pending', jsonb_build_array());
  END IF;

  IF v_emp_name IS NOT NULL AND btrim(v_emp_name) <> '' THEN
    SELECT count(*) = 1 INTO v_name_unique
    FROM public.employees
    WHERE active = true
      AND name = v_emp_name;
  END IF;

  BEGIN
    SELECT count(*) INTO v_holding
    FROM public.ims_stock_items
    WHERE custodian_employee_id = v_emp_id
      AND (stock_status IS NULL OR stock_status::text NOT IN ('returned_to_oem', 'scrapped'));
  EXCEPTION WHEN undefined_column THEN
    v_holding := 0;
  END;

  BEGIN
    WITH my_tickets AS (
      SELECT t.id, t.case_id, t.defective_parts_details
      FROM public.tickets t
      WHERE t.is_deleted = false
        AND (
          t.assigned_employee_id = v_emp_id
          OR (v_name_unique AND t.assigned_engineer_name = v_emp_name)
        )
    ),
    lines AS (
      SELECT
        t.id AS ticket_id,
        t.case_id,
        (l.elem ->> 'name') AS name,
        public.normalize_serial(l.elem ->> 'serial') AS serial,
        COALESCE(l.elem ->> 'confirmed', '') = 'true' AS confirmed
      FROM my_tickets t,
           LATERAL jsonb_array_elements(
             COALESCE(t.defective_parts_details, '[]'::jsonb)
           ) AS l(elem)
      WHERE (l.elem ->> 'source') = 'fsr'
        AND public.normalize_serial(l.elem ->> 'serial') <> ''
    ),
    received AS (
      SELECT public.normalize_serial(part_serial_no) AS s
      FROM public.ims_stock_items
      WHERE transaction_ref LIKE 'GRN %'
        AND part_serial_no IS NOT NULL
    )
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'ticket_id', ticket_id,
          'case_id', case_id,
          'name', name,
          'serial', serial,
          'confirmed', confirmed
        )
      ),
      '[]'::jsonb
    )
    INTO v_pending
    FROM lines
    WHERE serial NOT IN (SELECT s FROM received);
  EXCEPTION WHEN undefined_column THEN
    v_pending := '[]'::jsonb;
  END;

  RETURN jsonb_build_object('holding', v_holding, 'pending', v_pending);
END;
$$;

-- =====================================================================
-- 2) my_stock_custody — enum-safe status filter
-- =====================================================================
CREATE OR REPLACE FUNCTION public.my_stock_custody()
RETURNS TABLE (
  stock_item_id uuid,
  part_serial_no text,
  ticket_id uuid,
  set_at timestamptz
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT s.id, s.part_serial_no, s.ticket_id, s.custodian_set_at
    FROM public.ims_stock_items s
   WHERE s.custodian_employee_id IN (
           SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid()
         )
     AND (s.stock_status IS NULL OR s.stock_status::text NOT IN ('returned_to_oem', 'scrapped'));
EXCEPTION WHEN undefined_column THEN
  RETURN;
END;
$$;

-- =====================================================================
-- 3) admin_stock_custody — enum-safe status filter
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_stock_custody(_employee_id uuid DEFAULT NULL)
RETURNS TABLE (
  stock_item_id uuid,
  custodian_employee_id uuid,
  custodian_name text,
  part_serial_no text,
  ticket_id uuid,
  set_at timestamptz
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT s.id, s.custodian_employee_id, e.name,
         s.part_serial_no, s.ticket_id, s.custodian_set_at
    FROM public.ims_stock_items s
    LEFT JOIN public.employees e ON e.id = s.custodian_employee_id
   WHERE s.custodian_employee_id IS NOT NULL
     AND (_employee_id IS NULL OR s.custodian_employee_id = _employee_id)
     AND (s.stock_status IS NULL OR s.stock_status::text NOT IN ('returned_to_oem', 'scrapped'));
EXCEPTION WHEN undefined_column THEN
  RETURN;
END;
$$;

-- =====================================================================
-- 4) Post-conditions: functions exist AND no body still coerces the enum.
--    Anything missing RAISES.
-- =====================================================================
DO $$ DECLARE
  missing text[] := '{}';
  fn text;
  want text[] := ARRAY[
    'get_engineer_material_stats',
    'my_stock_custody',
    'admin_stock_custody'
  ];
BEGIN
  FOREACH fn IN ARRAY want LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname = fn) THEN
      missing := missing || ('function ' || fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname = fn
                 AND pg_get_functiondef(p.oid) LIKE '%COALESCE(%stock_status%') THEN
      missing := missing || ('function ' || fn || ' still coerces stock_status');
    END IF;
  END LOOP;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'Migration 20260925000004 post-conditions FAILED: %', array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE 'Migration 20260925000004 post-conditions OK';
END $$;
