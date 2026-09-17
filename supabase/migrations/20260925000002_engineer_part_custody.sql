-- Migration: 20260925000002_engineer_part_custody.sql
-- Purpose: Engineers admin module Task B1-4 — close the part-custody leak.
--
-- WHAT WAS BROKEN (see plan review 2026-09-17):
--   a) GRN clear matched `WHERE part_serial_no = serial LIMIT 1` (duplicate
--      serials leaked) with three conflicting normalizations repo-wide.
--   b) A defective part pulled off a customer machine often has NO stock row,
--      so nothing was ever stamped — the view must union ticket serials.
--   c) No clear on ticket->Closed, none on DC/GDC cancel; GDC never stamped.
--   d) `custodian_employee_id` was client-writable (forgery) and leaked to
--      every ims:read holder via STOCK_SELECT.
--
-- WHAT THIS FILE DOES:
--   1) One canonical `normalize_serial()` (upper(btrim())) + expression index.
--   2) Custody timestamp columns (set_at / cleared_at / cleared_by_ref).
--   3) Replaces the GRN clear fn: normalized, ALL matching rows, cleared-by
--      stamping. Existing GRN triggers keep calling it (same name/signature).
--   4) Extends the DC stamp fn with set_at bookkeeping (same triggers).
--   5) NEW stamp on admin-confirm of a source='fsr' defective line.
--   6) NEW clear on ticket->Closed (the dispatched good part = installed).
--   7) NEW clear on DC cancel + GDC cancel (stranded dispatches).
--      Ticket CANCEL never clears (part must come back — the attention queue
--      in B3 surfaces it).
--   8) Write-lock: SECURITY INVOKER guard trigger on INSERT/UPDATE of the
--      custodian column — PostgREST user traffic must carry the
--      app.custodian_write flag (set only by the writers below);
--      service_role jobs and owner scripts are exempt. Column REVOKEs are
--      supplementary (a table-level UPDATE grant overrides a column REVOKE).
--   9) Rewrites get_engineer_material_stats(): independent per-block guards
--      (a pending failure can no longer blank holding), terminal statuses
--      excluded from holding, per-line `confirmed` flag on pending.
--  10) my_stock_custody() (own rows) + admin_stock_custody() (admin-gated).
--
-- HOW TO APPLY (run by a human — agents never push to Supabase):
--   1) Supabase dashboard → SQL editor → paste this file → Run,
--      or: `supabase db push` from the repo root.
--   2) Verify: the post-condition block at the end RAISES on any miss, so a
--      clean apply IS the verification. Then spot-check:
--        SELECT public.normalize_serial('  ab-12 ');  --> 'AB-12'
--        SELECT * FROM public.my_stock_custody();     --> own rows only
--
-- NOTES:
-- - Additive-only, idempotent (IF NOT EXISTS / CREATE OR REPLACE /
--   DROP TRIGGER IF EXISTS + CREATE, information_schema-guarded trigger
--   creation). No UPDATE/DELETE of existing rows except the custodian
--   columns this system owns.
-- - Existing custody writers are SECURITY DEFINER (run as owner), so the
--   column REVOKE does not block them; the guard trigger additionally
--   exempts every role except authenticated/anon.
-- - Never overloads a pg_catalog name (STD-001); the session flag lives
--   under app.* like the existing app_advisory_* RPCs.
--
-- Safety assertion (executable SQL): this file contains zero DELETE FROM /
--   TRUNCATE / DROP TABLE / DROP COLUMN — the ROLLBACK statements below appear
--   only inside comments and never execute.
--
-- ROLLBACK (comments only — run manually, in this order, if reverting):
--   DROP TRIGGER IF EXISTS trg_guard_custodian_write ON public.ims_stock_items;
--   DROP FUNCTION IF EXISTS public.guard_custodian_write();
--   GRANT UPDATE (custodian_employee_id) ON public.ims_stock_items TO authenticated;
--   DROP TRIGGER IF EXISTS trg_ims_clear_custodian_gdc_cancel ON public.general_delivery_challans;
--   DROP TRIGGER IF EXISTS trg_ims_clear_custodian_dc_cancel ON public.delivery_challans;
--   DROP TRIGGER IF EXISTS trg_ims_clear_custodian_ticket_close ON public.tickets;
--   DROP TRIGGER IF EXISTS trg_ims_stamp_custodian_confirm ON public.tickets;
--   DROP FUNCTION IF EXISTS public.ims_clear_custodian_on_doc_cancel();
--   DROP FUNCTION IF EXISTS public.ims_clear_custodian_on_ticket_close();
--   DROP FUNCTION IF EXISTS public.ims_stamp_custodian_on_part_confirm();
--   DROP FUNCTION IF EXISTS public.admin_stock_custody(uuid);
--   DROP FUNCTION IF EXISTS public.my_stock_custody();
--   DROP FUNCTION IF EXISTS public.normalize_serial(text);
--   DROP INDEX IF EXISTS public.idx_ims_stock_norm_serial;
--   ALTER TABLE IF EXISTS public.ims_stock_items
--     DROP COLUMN IF EXISTS custodian_set_at,
--     DROP COLUMN IF EXISTS custodian_cleared_at,
--     DROP COLUMN IF EXISTS custodian_cleared_by_ref;
--   (Leaves the 20260916000002 stamp/clear functions in their prior form only
--    if you re-apply that file; the GRN/DC bodies replaced here stay replaced.)

-- =====================================================================
-- 0) Precondition: 20260916000002 must be applied first. Without
--    ims_stock_items.custodian_employee_id the trigger below fails with a
--    cryptic error — raise the legible one instead.
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'ims_stock_items'
                   AND column_name = 'custodian_employee_id') THEN
    RAISE EXCEPTION 'Migration 20260925000002 requires 20260916000002 (ims_stock_items.custodian_employee_id missing). Apply 20260916000002 first.';
  END IF;
END $$;

-- =====================================================================
-- 1) Canonical serial normalization + expression index
-- =====================================================================
CREATE OR REPLACE FUNCTION public.normalize_serial(s text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$ SELECT upper(btrim(COALESCE(s, ''))) $$;

REVOKE ALL ON FUNCTION public.normalize_serial(text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.normalize_serial(text) TO authenticated;
  ELSE
    RAISE NOTICE 'skipping normalize_serial grant: role authenticated missing';
  END IF;
END $$;

-- =====================================================================
-- 2) Custody bookkeeping columns (nullable, no default, no backfill)
-- =====================================================================
ALTER TABLE public.ims_stock_items
  ADD COLUMN IF NOT EXISTS custodian_set_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS custodian_cleared_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS custodian_cleared_by_ref text NULL;

COMMENT ON COLUMN public.ims_stock_items.custodian_set_at
  IS 'When the current custodian took the part (set by custody writers).';
COMMENT ON COLUMN public.ims_stock_items.custodian_cleared_at
  IS 'When the current custodian last cleared (GRN / ticket-close / cancel).';
COMMENT ON COLUMN public.ims_stock_items.custodian_cleared_by_ref
  IS 'Which event last cleared custody (e.g. GRN GRN/2026/0007).';

CREATE INDEX IF NOT EXISTS idx_ims_stock_norm_serial
  ON public.ims_stock_items ((public.normalize_serial(part_serial_no)));

-- =====================================================================
-- 3) GRN clear, fixed: normalized, ALL rows, cleared-by stamping.
--    Same name/signature — the four existing GRN triggers keep working.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ims_clear_custodian_on_grn_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  it JSONB;
  serial TEXT;
  v_cleared INT;
BEGIN
  IF NEW.items IS NULL OR jsonb_typeof(NEW.items) <> 'array' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.custodian_write', 'on', true);

  FOR it IN SELECT * FROM jsonb_array_elements(NEW.items) LOOP
    IF jsonb_typeof(it->'serials') = 'array' THEN
      FOR serial IN
        SELECT public.normalize_serial(x)
          FROM jsonb_array_elements_text(it->'serials') AS x
         WHERE public.normalize_serial(x) <> ''
      LOOP
        UPDATE public.ims_stock_items
           SET custodian_employee_id = NULL,
               custodian_cleared_at = now(),
               custodian_cleared_by_ref = 'GRN ' || COALESCE(NEW.grn_no, '')
         WHERE public.normalize_serial(part_serial_no) = serial
           AND custodian_employee_id IS NOT NULL;
        GET DIAGNOSTICS v_cleared = ROW_COUNT;
        IF v_cleared = 0
           AND NOT EXISTS (SELECT 1 FROM public.ims_stock_items
                            WHERE public.normalize_serial(part_serial_no) = serial) THEN
          RAISE WARNING 'GRN %: serial "%" not found in stock items — custodian not cleared',
            NEW.grn_no, serial;
        END IF;
      END LOOP;
    ELSIF public.normalize_serial(it->>'serial_no') <> '' THEN
      serial := public.normalize_serial(it->>'serial_no');
      UPDATE public.ims_stock_items
         SET custodian_employee_id = NULL,
             custodian_cleared_at = now(),
             custodian_cleared_by_ref = 'GRN ' || COALESCE(NEW.grn_no, '')
       WHERE public.normalize_serial(part_serial_no) = serial
         AND custodian_employee_id IS NOT NULL;
      GET DIAGNOSTICS v_cleared = ROW_COUNT;
      IF v_cleared = 0
         AND NOT EXISTS (SELECT 1 FROM public.ims_stock_items
                          WHERE public.normalize_serial(part_serial_no) = serial) THEN
        RAISE WARNING 'GRN %: serial "%" not found in stock items — custodian not cleared',
          NEW.grn_no, serial;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- =====================================================================
-- 4) DC stamp, extended with set_at bookkeeping. Same triggers.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ims_stamp_custodian_on_dc_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.carrier_employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.custodian_write', 'on', true);

  UPDATE public.ims_stock_items
     SET custodian_employee_id = NEW.carrier_employee_id,
         custodian_set_at = now(),
         custodian_cleared_at = NULL,
         custodian_cleared_by_ref = NULL
   WHERE transaction_ref = 'DC ' || NEW.challan_no
     AND custodian_employee_id IS NULL;

  RETURN NEW;
END;
$$;

-- =====================================================================
-- 5) Stamp on admin-confirm of a source='fsr' defective line.
--    Custodian = the ticket's assigned engineer at confirm time. Only rows
--    with custodian IS NULL are stamped (idempotent re-confirm is a no-op).
--    `confirmed` is compared as TEXT ('true') — never cast, so junk values
--    cannot fail the ticket update.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ims_stamp_custodian_on_part_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT;
  i INT;
  new_line JSONB;
  old_line JSONB;
  serial TEXT;
BEGIN
  IF NEW.defective_parts_details IS NOT DISTINCT FROM OLD.defective_parts_details THEN
    RETURN NEW;
  END IF;
  IF NEW.assigned_employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.custodian_write', 'on', true);

  n := jsonb_array_length(COALESCE(NEW.defective_parts_details, '[]'::jsonb));
  FOR i IN 0..n-1 LOOP
    new_line := NEW.defective_parts_details->i;
    IF (new_line->>'source') = 'fsr' AND COALESCE(new_line->>'confirmed', '') = 'true' THEN
      old_line := OLD.defective_parts_details->i;
      IF old_line IS NULL OR COALESCE(old_line->>'confirmed', '') <> 'true' THEN
        serial := public.normalize_serial(new_line->>'serial');
        IF serial <> '' THEN
          UPDATE public.ims_stock_items
             SET custodian_employee_id = NEW.assigned_employee_id,
                 custodian_set_at = now(),
                 custodian_cleared_at = NULL,
                 custodian_cleared_by_ref = NULL
           WHERE public.normalize_serial(part_serial_no) = serial
             AND custodian_employee_id IS NULL;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='tickets'
                AND column_name='defective_parts_details')
     AND EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='tickets'
                AND column_name='assigned_employee_id') THEN
    DROP TRIGGER IF EXISTS trg_ims_stamp_custodian_confirm ON public.tickets;
    CREATE TRIGGER trg_ims_stamp_custodian_confirm
      AFTER UPDATE ON public.tickets
      FOR EACH ROW
      WHEN (NEW.defective_parts_details IS DISTINCT FROM OLD.defective_parts_details)
      EXECUTE FUNCTION public.ims_stamp_custodian_on_part_confirm();
  ELSE
    RAISE NOTICE 'Migration 20260925000002: confirm-stamp trigger NOT created (tickets columns missing)';
  END IF;
END $$;

-- =====================================================================
-- 6) Clear on ticket->Closed: the dispatched good part is installed,
--    job done. Defective lines stay in custody until their GRN.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ims_clear_custodian_on_ticket_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.dc_no IS NULL OR btrim(NEW.dc_no) = '' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.custodian_write', 'on', true);

  UPDATE public.ims_stock_items
     SET custodian_employee_id = NULL,
         custodian_cleared_at = now(),
         custodian_cleared_by_ref = 'TICKET-CLOSE ' || COALESCE(NEW.case_id, '')
   WHERE transaction_ref = 'DC ' || btrim(NEW.dc_no)
     AND custodian_employee_id IS NOT NULL;

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='tickets'
                AND column_name='dc_no') THEN
    DROP TRIGGER IF EXISTS trg_ims_clear_custodian_ticket_close ON public.tickets;
    CREATE TRIGGER trg_ims_clear_custodian_ticket_close
      AFTER UPDATE OF status ON public.tickets
      FOR EACH ROW
      WHEN (NEW.status = 'Closed' AND OLD.status IS DISTINCT FROM 'Closed')
      EXECUTE FUNCTION public.ims_clear_custodian_on_ticket_close();
  ELSE
    RAISE NOTICE 'Migration 20260925000002: ticket-close trigger NOT created (tickets.dc_no missing)';
  END IF;
END $$;

-- =====================================================================
-- 7) Clear on DC / GDC cancel: stranded dispatches come home.
--    Ticket CANCEL is deliberately NOT cleared here (part must come back;
--    the B3 attention queue surfaces it).
-- =====================================================================
CREATE OR REPLACE FUNCTION public.ims_clear_custodian_on_doc_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref TEXT;
BEGIN
  IF TG_TABLE_NAME = 'delivery_challans' THEN
    IF NEW.challan_no IS NULL OR btrim(NEW.challan_no) = '' THEN RETURN NEW; END IF;
    ref := 'DC ' || btrim(NEW.challan_no);
  ELSIF TG_TABLE_NAME = 'general_delivery_challans' THEN
    IF NEW.dc_no IS NULL OR btrim(NEW.dc_no) = '' THEN RETURN NEW; END IF;
    ref := 'GDC ' || btrim(NEW.dc_no);
  ELSE
    RETURN NEW;
  END IF;

  PERFORM set_config('app.custodian_write', 'on', true);

  UPDATE public.ims_stock_items
     SET custodian_employee_id = NULL,
         custodian_cleared_at = now(),
         custodian_cleared_by_ref = 'CANCEL ' || ref
   WHERE transaction_ref = ref
     AND custodian_employee_id IS NOT NULL;

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  IF to_regclass('public.delivery_challans') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ims_clear_custodian_dc_cancel ON public.delivery_challans;
    CREATE TRIGGER trg_ims_clear_custodian_dc_cancel
      AFTER UPDATE OF status ON public.delivery_challans
      FOR EACH ROW
      WHEN (NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled')
      EXECUTE FUNCTION public.ims_clear_custodian_on_doc_cancel();
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='general_delivery_challans'
                AND column_name='dc_no') THEN
    DROP TRIGGER IF EXISTS trg_ims_clear_custodian_gdc_cancel ON public.general_delivery_challans;
    CREATE TRIGGER trg_ims_clear_custodian_gdc_cancel
      AFTER UPDATE OF status ON public.general_delivery_challans
      FOR EACH ROW
      WHEN (NEW.status = 'Cancelled' AND OLD.status IS DISTINCT FROM 'Cancelled')
      EXECUTE FUNCTION public.ims_clear_custodian_on_doc_cancel();
  ELSE
    RAISE NOTICE 'Migration 20260925000002: GDC-cancel trigger NOT created (general_delivery_challans.dc_no missing)';
  END IF;
END $$;

-- =====================================================================
-- 8) Write-lock: custodian is system-owned. Direct authenticated writes
--    raise; the writers above pass via the app.custodian_write flag, and
--    every other role (service_role jobs, owner scripts) is exempt.
-- =====================================================================
-- SECURITY INVOKER on purpose (verified 2026-09-17 on scratch PG15: inside a
-- SECURITY DEFINER function current_user is the function OWNER, so a DEFINER
-- guard can never see 'authenticated' and never fires). As INVOKER,
-- current_user is the true caller: PostgREST user traffic
-- ('authenticated'/'anon') is gated, service_role jobs and owner scripts
-- pass through untouched.
CREATE OR REPLACE FUNCTION public.guard_custodian_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon')
     AND NEW.custodian_employee_id IS DISTINCT FROM OLD.custodian_employee_id
     AND COALESCE(current_setting('app.custodian_write', true), '') <> 'on' THEN
    RAISE EXCEPTION 'custodian_employee_id is system-owned: set it via the DC/GRN/part-confirm flows, not direct writes';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_custodian_write ON public.ims_stock_items;
CREATE TRIGGER trg_guard_custodian_write
  BEFORE INSERT OR UPDATE OF custodian_employee_id ON public.ims_stock_items
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_custodian_write();

-- Supplementary only: a table-level UPDATE grant (as this repo's GRANT ALL
-- pattern issues) authorizes every column, so a column REVOKE alone cannot
-- lock the field — the trigger above is the real enforcement. Kept anyway
-- so a future narrowing of the table grant fails closed, not open.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE UPDATE (custodian_employee_id) ON public.ims_stock_items FROM authenticated;
    REVOKE INSERT (custodian_employee_id) ON public.ims_stock_items FROM authenticated;
  ELSE
    RAISE NOTICE 'skipping custodian column revoke: role authenticated missing';
  END IF;
END $$;

-- =====================================================================
-- 9) Rewrite get_engineer_material_stats: holding + pending union.
--    - holding: custodian rows, terminal statuses excluded.
--    - pending: defective fsr serials not yet GRN-received (normalized),
--      each carrying its `confirmed` flag (unconfirmed = in hand, unverified).
--    - Each block degrades independently; a pending failure can no longer
--      blank holding (the old asymmetry).
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
      AND COALESCE(stock_status, '') NOT IN ('returned_to_oem', 'scrapped');
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

REVOKE ALL ON FUNCTION public.get_engineer_material_stats() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.get_engineer_material_stats() TO authenticated;
  ELSE
    RAISE NOTICE 'skipping material-stats grant: role authenticated missing';
  END IF;
END $$;

-- =====================================================================
-- 10) Own + admin custody RPCs (the client maps in ims.ts read these).
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
     AND COALESCE(s.stock_status, '') NOT IN ('returned_to_oem', 'scrapped');
EXCEPTION WHEN undefined_column THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.my_stock_custody() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.my_stock_custody() TO authenticated;
  ELSE
    RAISE NOTICE 'skipping my_stock_custody grant: role authenticated missing';
  END IF;
END $$;

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
     AND COALESCE(s.stock_status, '') NOT IN ('returned_to_oem', 'scrapped');
EXCEPTION WHEN undefined_column THEN
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_stock_custody(uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.admin_stock_custody(uuid) TO authenticated;
  ELSE
    RAISE NOTICE 'skipping admin_stock_custody grant: role authenticated missing';
  END IF;
END $$;

-- =====================================================================
-- 11) Post-conditions: a clean apply IS the verification. Anything
--     missing below RAISES (loud) instead of the old silent NOTICE.
-- =====================================================================
DO $$ DECLARE
  missing text[] := '{}';
  want text[] := ARRAY[
    'normalize_serial',
    'ims_clear_custodian_on_grn_receipt',
    'ims_stamp_custodian_on_dc_dispatch',
    'ims_stamp_custodian_on_part_confirm',
    'ims_clear_custodian_on_ticket_close',
    'ims_clear_custodian_on_doc_cancel',
    'guard_custodian_write',
    'get_engineer_material_stats',
    'my_stock_custody',
    'admin_stock_custody'
  ];
  fn text;
BEGIN
  IF to_regclass('public.ims_stock_items') IS NULL THEN
    missing := missing || 'table ims_stock_items';
  END IF;
  FOREACH fn IN ARRAY want LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname = 'public' AND p.proname = fn) THEN
      missing := missing || ('function ' || fn);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_guard_custodian_write') THEN
    missing := missing || 'trigger trg_guard_custodian_write';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ims_stamp_custodian_confirm') THEN
    missing := missing || 'trigger trg_ims_stamp_custodian_confirm';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_ims_clear_custodian_ticket_close') THEN
    missing := missing || 'trigger trg_ims_clear_custodian_ticket_close';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='ims_stock_items'
                   AND column_name='custodian_set_at') THEN
    missing := missing || 'column ims_stock_items.custodian_set_at';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ims_stock_norm_serial') THEN
    missing := missing || 'index idx_ims_stock_norm_serial';
  END IF;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'Migration 20260925000002 post-conditions FAILED: %', array_to_string(missing, ', ');
  END IF;
  RAISE NOTICE 'Migration 20260925000002 post-conditions OK';
END $$;
