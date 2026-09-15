-- Migration: 20260921000001_engineer_material_stats_rpc.sql
-- Engineer dashboard fast path: ONE database call for material holding +
-- pending materials (defective FSR serials not yet GRN'd).
--
-- WHY: the dashboard previously fanned out to a server function that issued
-- ~6 sequential queries (plus a serverless cold start). This SECURITY
-- DEFINER function does it all in one roundtrip; the engineer portal calls
-- it directly from the client (no server hop, no cold start).
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste this file → Run,
--      or: `supabase db push` from the repo root.
--   2) Verify: SELECT public.get_engineer_material_stats();
--      → {"holding": 0, "pending": []} (as any signed-in user).
--
-- NOTES:
-- - Additive-only, idempotent (CREATE OR REPLACE + REVOKE/GRANT).
-- - SECURITY DEFINER is safe here: the employee is resolved INSIDE the
--   function from auth.uid(), so a caller can only ever see their own rows.
--   EXECUTE is revoked from PUBLIC and granted to authenticated only.
-- - Name fallback mirrors the app queue rule (exact name match, only when
--   the display name is unique across active employees).
-- - Missing custodian column (migration 20260916000002 not applied) degrades
--   holding to 0 instead of failing the whole call.

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
    WHERE custodian_employee_id = v_emp_id;
  EXCEPTION WHEN undefined_column THEN
    -- Custody tracking migration not applied yet: degrade, don't fail.
    v_holding := 0;
  END;

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
      btrim(l.elem ->> 'serial') AS serial
    FROM my_tickets t,
         LATERAL jsonb_array_elements(
           COALESCE(t.defective_parts_details, '[]'::jsonb)
         ) AS l(elem)
    WHERE (l.elem ->> 'source') = 'fsr'
      AND nullif(btrim(l.elem ->> 'serial'), '') IS NOT NULL
  ),
  received AS (
    SELECT lower(btrim(part_serial_no)) AS s
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
        'serial', serial
      )
    ),
    '[]'::jsonb
  )
  INTO v_pending
  FROM lines
  WHERE lower(serial) NOT IN (SELECT s FROM received);

  RETURN jsonb_build_object('holding', v_holding, 'pending', v_pending);
END;
$$;

REVOKE ALL ON FUNCTION public.get_engineer_material_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_engineer_material_stats() TO authenticated;
