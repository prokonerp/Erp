-- =============================================================================
-- SCOPED SERIAL CORRECTION V2 — satellite repair + harder document scope
-- PATCH 20260831000003a — frozen-challan unblock (additive, reversible)
--   Adds PERFORM set_config('app.serial_propagation','on',true) to both
--   correct_oracle_slot and correct_grn_serial so _sync_doc updates bypass
--   assert_items_frozen_after_post() on status='Challan Generated' without
--   requiring Cancel+reraise. LOCAL flag auto-resets at tx end; mirrors
--   propagate_serial_correction() ll.132/161. No DROP, no data UPDATE at
--   migration time; reversible via re-apply of previous file.
-- =============================================================================
-- CONTEXT: Oracle 41214317 had B (exchange) and C (received) both holding
--   same string 0H2624G00408 initially. Correcting C via global
--   propagate_serial_correction also rewrote B. Migration
--   20260831000002_scoped_serial_correction.sql isolated correctors:
--     correct_indent_oracle_serial (only one indent/oracle/slot)
--     correct_grn_serial scope=document (only that GRN)
--   Now B is correct in indents.oracles_data (0H2629G00591) but satellites
--   are stale: tickets.good_parts_details still 0H2624, delivery_challans
--   .items serial_no stale, ims_stock_items missing row for 0H2629.
--
-- GOAL: Additively repair satellites without cross-slot bleed and harden
--   correct_grn_serial document path so it no longer hardcodes
--   slot='received' and no longer fans out stock globally in document mode.
--
-- SAFETY (additive only, reversible, no data loss):
--   - ONLY CREATE OR REPLACE FUNCTION — no DROP TABLE, no DROP FUNCTION,
--     no DELETE, no TRUNCATE, no UPDATE that touches user data at migration
--     time. All fixes run only when the new RPCs are explicitly called.
--   - Does NOT touch existing migration 20260831000002 — keeps it intact.
--   - Existing helpers serial_replace_token / serial_replace_in_object_array /
--     serial_replace_in_item (from 20260830000004) are reused as-is.
--   - Reversible by DROP FUNCTION IF EXISTS for the new signatures, or by
--     re-applying previous migration file.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helper: replace tickets good/defective parts array serial
--    Pattern mirrors serial_replace_in_object_array but key is 'serial' not
--    'serial_no'/'def_serial_no'. Never returns NULL; non-array -> return
--    as-is; NULL -> '[]'. Uses serial_replace_token for comma-aware exact
--    token match.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ticket_parts_set_serial(
  _arr jsonb,
  _from text,
  _to text
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _arr IS NULL THEN '[]'::jsonb
    WHEN jsonb_typeof(_arr) <> 'array' THEN _arr
    ELSE COALESCE(
      (SELECT jsonb_agg(jsonb_set(elem, '{serial}', to_jsonb(public.serial_replace_token(COALESCE(elem->>'serial',''), _from, _to)), false))
         FROM jsonb_array_elements(_arr) AS elem),
      '[]'::jsonb)
  END;
$$;

COMMENT ON FUNCTION public.ticket_parts_set_serial(jsonb, text, text) IS 'Ticket satellite helper: replaces good_parts_details[].serial / defective_parts_details[].serial via serial_replace_token. Never NULL; non-array returned as-is.';

-- ---------------------------------------------------------------------------
-- 2) New admin RPC: correct a single oracle slot with optional satellite sync
--    Scope is PK-anchored:
--      - indents: WHERE id=_indent_id via indent_oracle_set_serial (one oracle_no + one slot)
--      - tickets: WHERE id=(SELECT ticket_id FROM indents WHERE id=_indent_id) + LIKE guard
--      - delivery_challans / grns: WHERE indent_id=_indent_id AND category + oracle_no guard
--    Default _sync_ticket=true so ticket satellite is repaired; _sync_doc=false
--    so doc satellites only move when caller opts in (prevents bleed when fixing
--    only the oracle block).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_oracle_slot(
  _indent_id uuid,
  _oracle_no text,
  _slot text,
  _old_serial text,
  _new_serial text,
  _reason text,
  _sync_ticket boolean DEFAULT true,
  _sync_doc boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text := NULLIF(btrim(COALESCE(_old_serial,'')), '');
  v_new text := NULLIF(btrim(COALESCE(_new_serial,'')), '');
  v_found int := 0;
  v_indent public.indents%ROWTYPE;
BEGIN
  -- Admin guard — allow SQL Editor / service_role (auth.uid() IS NULL) for manual repair
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can correct serial numbers';
  END IF;

  -- Unblock frozen-challan satellite sync: bypass assert_items_frozen_after_post()
  -- LOCAL (=true third arg) auto-resets at transaction end; same pattern as
  -- propagate_serial_correction() line 132/161. Safe because scope remains PK-anchored
  -- (indent_id + oracle_no + LIKE guard); flag only suppresses the freeze check.
  PERFORM set_config('app.serial_propagation','on',true);

  IF v_old IS NULL OR v_new IS NULL OR v_old = v_new THEN
    RAISE EXCEPTION 'Old and new serial numbers must be provided and different';
  END IF;

  IF _slot NOT IN ('exchange','received','customer_received','defective') THEN
    RAISE EXCEPTION 'Slot must be exchange|received|customer_received|defective, got %', _slot;
  END IF;

  SELECT * INTO v_indent FROM public.indents WHERE id = _indent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Indent % not found', _indent_id;
  END IF;

  -- Verify old serial exists in the requested oracle_no + slot (same LIKE guard as correct_indent_oracle_serial)
  SELECT count(*) INTO v_found
    FROM jsonb_array_elements(COALESCE(v_indent.oracles_data,'[]'::jsonb)) b
   WHERE b->>'oracle_no' = _oracle_no
     AND (
       (_slot='exchange'          AND (b->'exchange_rows')::text LIKE '%'||v_old||'%') OR
       (_slot='received'          AND (b->'received_rows')::text LIKE '%'||v_old||'%') OR
       (_slot='customer_received' AND (b->'customer_received_rows')::text LIKE '%'||v_old||'%') OR
       (_slot='defective'         AND (b->'defective_rows')::text LIKE '%'||v_old||'%')
     );
  IF v_found = 0 THEN
    RAISE EXCEPTION 'Serial "%" not found in indent % oracle % slot %', v_old, _indent_id, _oracle_no, _slot;
  END IF;

  -- Audit (never delete) — snapshot records satellite intent
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason, deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('indent_oracle_serial_correction', _slot, COALESCE(v_indent.indent_no, v_indent.id::text), _indent_id, _reason, auth.uid(), v_indent.created_by, v_indent.created_at,
     jsonb_build_object('oracle_no', _oracle_no, 'slot', _slot, 'old_serial', v_old, 'new_serial', v_new, 'sync_ticket', _sync_ticket, 'sync_doc', _sync_doc));

  -- Scoped update — ONLY that oracle block, ONLY that slot, ONLY this indent_id
  UPDATE public.indents
     SET oracles_data = public.indent_oracle_set_serial(oracles_data, _oracle_no, _slot, v_old, v_new),
         updated_at = now()
   WHERE id = _indent_id;

  -- Optional ticket satellite sync (PK-anchored to this indent's ticket)
  IF _sync_ticket THEN
    IF _slot = 'exchange' THEN
      UPDATE public.tickets
         SET good_parts_details = public.ticket_parts_set_serial(COALESCE(good_parts_details,'[]'::jsonb), v_old, v_new)
       WHERE id = (SELECT ticket_id FROM public.indents WHERE id = _indent_id)
         AND good_parts_details::text LIKE '%'||v_old||'%';
    ELSIF _slot = 'defective' THEN
      UPDATE public.tickets
         SET defective_parts_details = public.ticket_parts_set_serial(COALESCE(defective_parts_details,'[]'::jsonb), v_old, v_new)
       WHERE id = (SELECT ticket_id FROM public.indents WHERE id = _indent_id)
         AND defective_parts_details::text LIKE '%'||v_old||'%';
    END IF;
    -- received / customer_received have no ticket satellite — skip
  END IF;

  -- Optional document satellite sync (PK-anchored to indent_id + oracle_no)
  IF _sync_doc THEN
    IF _slot = 'exchange' THEN
      UPDATE public.delivery_challans
         SET items = (
           SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb)
             FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
         )
       WHERE indent_id = _indent_id
         AND items::text LIKE '%'||v_old||'%'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) it WHERE it->>'oracle_no' = _oracle_no)
         AND status <> 'Cancelled';
    ELSIF _slot = 'received' THEN
      UPDATE public.grns
         SET items = (
           SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb)
             FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
         )
       WHERE indent_id = _indent_id
         AND category = 'oem'
         AND items::text LIKE '%'||v_old||'%'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) it WHERE it->>'oracle_no' = _oracle_no)
         AND status <> 'Cancelled';
    ELSIF _slot = 'customer_received' THEN
      UPDATE public.grns
         SET items = (
           SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb)
             FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it
         )
       WHERE indent_id = _indent_id
         AND category = 'customer'
         AND items::text LIKE '%'||v_old||'%'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) it WHERE it->>'oracle_no' = _oracle_no)
         AND status <> 'Cancelled';
    END IF;
    -- defective has no doc — skip
  END IF;

END $$;

GRANT EXECUTE ON FUNCTION public.correct_oracle_slot(uuid, text, text, text, text, text, boolean, boolean) TO authenticated;

COMMENT ON FUNCTION public.correct_oracle_slot(uuid, text, text, text, text, text, boolean, boolean) IS 'Scoped oracle-slot correction: ONLY one indent/oracle/slot. Optional satellite sync via _sync_ticket (tickets PK) and _sync_doc (delivery_challans/grns by indent_id+oracle_no). No global LIKE fan-out.';

-- ---------------------------------------------------------------------------
-- 3) Harden correct_grn_serial — keep 6-arg signature for backward compat,
--    fix two issues inside:
--    a) Dynamic slot: _oracle_no + _scope=document formerly hardcoded
--       slot=''received''. Now derives from gr.category: oem->received,
--       customer->customer_received (general falls back to received).
--    b) Single-row stock repair in document scope: do NOT fan out
--       WHERE part_serial_no=v_old globally. Instead if a stock row with
--       part_serial_no=v_old was created from THIS GRN (transaction_ref =
--       ''GRN ''||gr.grn_no), update only that row by PK (WHERE id=v_stock_id).
--       Global fan-out remains opt-in via _scope=''global''.
--    Additive only — no DELETE, no schema change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_grn_serial(
  _grn_id uuid, _old_serial text, _new_serial text, _reason text, _oracle_no text DEFAULT NULL, _scope text DEFAULT 'document'
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gr public.grns%ROWTYPE;
  v_old text := NULLIF(btrim(COALESCE(_old_serial,'')), '');
  v_new text := NULLIF(btrim(COALESCE(_new_serial,'')), '');
  v_affected int := 0;
  v_other int;
  v_indent_id uuid;
  v_oracle_no text;
  v_stock_id uuid;
  v_slot text;
BEGIN
  -- Allow SQL Editor (auth.uid() IS NULL, current_user = postgres/service_role) to run scoped fixes
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can correct serial numbers';
  END IF;

  -- Unblock frozen-challan / GRN satellite sync: same LOCAL flag as
  -- propagate_serial_correction(). Allows any downstream UPDATE to
  -- delivery_challans (via correct_indent_oracle_serial or direct items rewrite)
  -- to bypass assert_items_frozen_after_post() when status='Challan Generated'.
  PERFORM set_config('app.serial_propagation','on',true);

  IF v_old IS NULL OR v_new IS NULL OR v_old = v_new THEN
    RAISE EXCEPTION 'Old and new serial numbers must be provided and different';
  END IF;
  IF _scope NOT IN ('document','global') THEN
    RAISE EXCEPTION 'Scope must be document|global, got %', _scope;
  END IF;

  SELECT * INTO gr FROM public.grns WHERE id = _grn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;

  SELECT count(*) INTO v_affected
    FROM public.grns, LATERAL jsonb_array_elements(COALESCE(items,'[]'::jsonb)) it
   WHERE grns.id = _grn_id
     AND public.serial_replace_in_item(it, v_old, v_new) IS DISTINCT FROM it;
  IF v_affected = 0 THEN
    RAISE EXCEPTION 'Serial "%" was not found on GRN %', v_old, COALESCE(gr.grn_no, gr.id::text);
  END IF;

  SELECT count(*) INTO v_other FROM public.ims_stock_items WHERE part_serial_no = v_new AND part_serial_no IS DISTINCT FROM v_old;
  IF v_other > 0 THEN RAISE EXCEPTION 'Serial correction blocked: "%" already exists on another stock record.', v_new; END IF;

  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason, deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('grn_serial_correction', gr.category, COALESCE(gr.grn_no, gr.id::text), gr.id, _reason, auth.uid(), gr.created_by, gr.created_at,
     jsonb_build_object('old_serial', v_old, 'new_serial', v_new, 'scope', _scope, 'oracle_no', _oracle_no));

  -- 1) Fix THIS grn only (always scoped to id)
  UPDATE public.grns
     SET items = (SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb) FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it)
   WHERE id = _grn_id;

  -- 1b) Document-scoped single-row stock repair (no global fan-out).
  --     If this GRN was the source of a stock row (transaction_ref = 'GRN '||grn_no),
  --     update only that row by PK. This avoids the old blind WHERE part_serial_no=v_old
  --     that could touch unrelated stock units sharing the same string.
  IF _scope = 'document' THEN
    SELECT id INTO v_stock_id
      FROM public.ims_stock_items
     WHERE part_serial_no = v_old
       AND transaction_ref = 'GRN '||gr.grn_no
     LIMIT 1;
    IF FOUND THEN
      UPDATE public.ims_stock_items SET part_serial_no = v_new WHERE id = v_stock_id;
    END IF;
  END IF;

  -- 2) Global fan-out remains opt-in only
  IF _scope = 'global' THEN
    UPDATE public.ims_stock_items SET part_serial_no = v_new WHERE part_serial_no = v_old;
  END IF;

  -- 3) If oracle_no provided in document scope, also fix that single oracle slot — dynamic slot by category
  IF _oracle_no IS NOT NULL AND _scope = 'document' THEN
    SELECT indent_id INTO v_indent_id FROM public.grns WHERE id = _grn_id;
    IF v_indent_id IS NOT NULL THEN
      SELECT oracle_no INTO v_oracle_no
        FROM jsonb_array_elements((SELECT oracles_data FROM public.indents WHERE id = v_indent_id)) b
       WHERE b->>'oracle_no' = _oracle_no
       LIMIT 1;
      IF v_oracle_no IS NOT NULL THEN
        -- Derive slot from GRN category: oem -> received, customer -> customer_received
        IF gr.category = 'customer' THEN
          v_slot := 'customer_received';
        ELSE
          v_slot := 'received';
        END IF;
        PERFORM public.correct_indent_oracle_serial(v_indent_id, _oracle_no, v_slot, v_old, v_new, _reason || ' (auto from grn scoped)');
      END IF;
    END IF;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.correct_grn_serial(uuid, text, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.correct_grn_serial(uuid, text, text, text, text, text) IS 'Scoped serial correction v2: default scope=document touches only that GRN (+ optionally that oracle slot derived from category). Global stock fan-out is opt-in via scope=global. Single-row stock fix uses transaction_ref=GRN grn_no.';
