-- Migration: 20260925000006_scope_engineer_material_received.sql
-- Purpose: scope the `received` CTE in get_engineer_material_stats() to
--   CUSTOMER defective-return GRNs only (transaction_ref LIKE
--   'GRN GRN-CUST/%'), so a purchase/general receipt can no longer clear an
--   engineer's pending defective serial.
--
-- WHAT WAS BROKEN (supsersedes 20260925000004 §1, body otherwise verbatim):
--   The `received` CTE matched ANY ims_stock_items row with
--     transaction_ref LIKE 'GRN %'
--   by normalized serial, globally. A serial bought via a purchase GRN
--   (GRN-OEM/..., GRN-GEN/...) — any branch, any ticket — cleared the
--   engineer's "pending" for that defective serial. Pending counts were
--   silently understated whenever a serial collided with a purchase receipt.
--
-- PREDICATE CHOSEN + WHY:
--   `transaction_ref LIKE 'GRN GRN-CUST/%'`.
--   The GRN posting trigger writes transaction_ref as 'GRN ' || grn_no, and
--   set_grn_no() (setup_new_supabase.sql) prefixes grn_no by category:
--     customer → 'GRN-CUST/...' (defective parts received back from customer),
--     oem      → 'GRN-OEM/...'  (purchase),
--     general  → 'GRN-GEN/...'  (purchase).
--   Only the customer leg represents the engineer's FSR defective parts being
--   received, so only it may clear pending.
--
-- TICKET-LINKAGE INVESTIGATION (why no serial+ticket scoping):
--   ims_stock_items HAS a ticket_id FK, but the GRN posting trigger
--   (20260829000000_fix_stock_triggers.sql) inserts stock rows WITHOUT
--   ticket_id (column list: oem/part_name/part_model_no/part_serial_no/
--   warehouse_id/stock_type/stock_status/qty/transaction_ref/notes/
--   created_by) and the ON CONFLICT (part_serial_no) upsert never sets it
--   either — so ticket_id on GRN-posted rows is NULL/unreliable and cannot
--   scope `received` per ticket. grns.ticket_no is free text (not an FK) and
--   tickets.grn_no (20260918000001) is a nullable admin-stamped link, so no
--   reliable per-ticket join exists today. The category-prefix predicate is
--   the minimal safe scoping available.
--
-- ASSUMPTIONS / EDGE CASES (flagged):
--   1) grn_no values follow the generator prefixes. A customer GRN saved with
--      a hand-typed non-prefixed grn_no will NOT match → the serial stays
--      pending (fail-safe direction: over-reports pending, never hides it).
--      Same for odd-cased prefixes (LIKE is case-sensitive) — fail-safe.
--   2) part_serial_no is UNIQUE: a later purchase GRN for the same serial
--      OVERWRITES transaction_ref via ON CONFLICT DO UPDATE, which can flip a
--      CUST receipt row into a purchase ref (serial reappears as pending) or
--      vice versa. Pre-existing upsert behaviour, untouched here.
--   3) my_stock_custody / admin_stock_custody from 20260925000004 are
--      untouched — this migration replaces get_engineer_material_stats only.
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste this file → Run,
--      or: `supabase db push` from the repo root.
--   2) Verify: the post-condition block at the end RAISES on any miss, so a
--      clean apply IS the verification. Then reload the PostgREST schema
--      cache (NOTIFY pgrst, 'reload schema') before retesting the app.
--
-- VERIFY (read-only — safe to run any time):
--   SELECT public.get_engineer_material_stats();
--   -- pending must still list FSR defective serials with no customer-GRN
--   -- receipt, and must NOT drop a serial that only has a GRN-OEM/GRN-GEN
--   -- receipt. Spot-check the predicate directly:
--   SELECT transaction_ref, part_serial_no
--     FROM public.ims_stock_items
--    WHERE transaction_ref LIKE 'GRN %'
--      AND transaction_ref NOT LIKE 'GRN GRN-CUST/%'
--    LIMIT 20;
--   -- every row above is now IGNORED by `received` (would previously clear).
--
-- NOTES:
-- - Additive-only, idempotent (CREATE OR REPLACE, role-guarded GRANTs).
--   Apply-twice is clean. No signature change; clients untouched.
-- - Fail-soft EXCEPTION blocks and enum-safe stock_status::text filter from
--   20260925000004 kept verbatim.
--
-- Safety assertion (executable SQL): this file contains zero DELETE FROM /
--   TRUNCATE / DROP TABLE / DROP COLUMN — the ROLLBACK statements below appear
--   only inside comments and never execute.
--
-- ROLLBACK (comments only — run manually if reverting):
--   -- Re-apply 20260925000004 §1 (restores the global `LIKE 'GRN %'`
--   -- received CTE — reintroduces this bug; rollback is NOT advised).

-- =====================================================================
-- 1) get_engineer_material_stats — customer-GRN-scoped `received` CTE
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
      -- SCOPED (20260925000006): customer defective-return GRNs ONLY — see
      -- header. Purchase/general receipts (GRN-OEM/, GRN-GEN/, custom refs)
      -- must not clear an engineer's pending defective serial.
      SELECT public.normalize_serial(part_serial_no) AS s
      FROM public.ims_stock_items
      WHERE transaction_ref LIKE 'GRN GRN-CUST/%'
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
-- 2) GRANTs (mirrors 20260921000001: REVOKE PUBLIC + authenticated EXECUTE;
--    grant is role-guarded so a bare scratch cluster NOTICE-skips, never
--    aborts. CREATE OR REPLACE already preserves existing grants — this
--    re-asserts them.)
-- =====================================================================
REVOKE ALL ON FUNCTION public.get_engineer_material_stats() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.get_engineer_material_stats() TO authenticated;
  ELSE
    RAISE NOTICE 'skipping function grant: role authenticated missing';
  END IF;
END $$;

-- =====================================================================
-- 3) Post-conditions: function exists, body is customer-GRN-scoped, the old
--    global predicate is gone, and no body still coerces the enum.
--    Anything missing RAISES. position() is used (literal match) because
--    LIKE patterns cannot assert the ABSENCE of the exact old string.
-- =====================================================================
DO $$ DECLARE
  missing text[] := '{}';
  fndef text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public' AND p.proname = 'get_engineer_material_stats') THEN
    missing := missing || 'function get_engineer_material_stats';
  ELSE
    SELECT pg_get_functiondef(p.oid) INTO fndef FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_engineer_material_stats' LIMIT 1;
    IF position('GRN-CUST' in fndef) = 0 THEN
      missing := missing || 'function get_engineer_material_stats missing GRN-CUST scoping';
    END IF;
    IF position('LIKE ''GRN %''' in fndef) > 0 THEN
      missing := missing || 'function get_engineer_material_stats still has global LIKE ''GRN %'' predicate';
    END IF;
    IF position('COALESCE(' in fndef) > 0
       AND position('stock_status' in fndef) > 0
       AND fndef LIKE '%COALESCE(%stock_status%' THEN
      missing := missing || 'function get_engineer_material_stats still coerces stock_status';
    END IF;
  END IF;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'Migration 20260925000006 post-conditions FAILED: %', array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE 'Migration 20260925000006 post-conditions OK';
END $$;
