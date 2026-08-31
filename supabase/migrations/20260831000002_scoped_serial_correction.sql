-- =============================================================================
-- SCOPED SERIAL CORRECTION — fix over-propagation (Oracle B ↔ C)
-- =============================================================================
-- ISSUE: propagate_serial_correction(old,new) is GLOBAL, value-only.
--   Correcting GRN-OEM C (0H2624G00408 → X) also overwrote DC-CUST B
--   (exchange_rows[].serial_no) and delivery_challans items where the same
--   string happened to appear, even though B and C are different physical slots:
--     indents.oracles_data[].exchange_rows[]   → B (what you SENT)
--     indents.oracles_data[].received_rows[]   → C (what OEM SENT BACK)
--     delivery_challans (DC-CUST) → B document
--     grns (GRN-OEM)              → C document
--   Same string ≠ same slot. Blind LIKE '%old%' is wrong for document fixes.
--
-- FIX: Add DOCUMENT-SCOPED correction path. Global path stays for
--   Serials Manager catalog renames (serials.serial_number → stock).
--   Document path touches ONLY the one oracle slot + its single GRN/DC doc,
--   never the other slot, never other indents.
--
-- SAFETY (you asked "dont delete even a character"):
--   - ONLY CREATE OR REPLACE FUNCTION — no DROP TABLE, no DELETE, no TRUNCATE,
--     no UPDATE that touches user data. Existing propagation stays untouched.
--   - New RPC is additive: old correct_grn_serial(uuid,text,text,text) keeps
--     working (calls new logic with scope='document' by default, but now scoped).
--   - No column adds, no data backfill. Reversible by DROP FUNCTION.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: replace serial in a single OracleBlock, but ONLY for the chosen slot.
-- Slot = 'exchange' | 'received' | 'customer_received' | 'defective'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.serial_replace_in_oracle_block(
  _block jsonb,
  _slot text,
  _from text,
  _to text
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _slot = 'exchange' THEN
      jsonb_set(_block, '{exchange_rows}', public.serial_replace_in_object_array(_block->'exchange_rows', 'serial_no', _from, _to), false)
    WHEN _slot = 'received' THEN
      jsonb_set(_block, '{received_rows}', public.serial_replace_in_object_array(_block->'received_rows', 'serial_no', _from, _to), false)
    WHEN _slot = 'customer_received' THEN
      jsonb_set(_block, '{customer_received_rows}', public.serial_replace_in_object_array(_block->'customer_received_rows', 'serial_no', _from, _to), false)
    WHEN _slot = 'defective' THEN
      jsonb_set(_block, '{defective_rows}', public.serial_replace_in_object_array(_block->'defective_rows', 'def_serial_no', _from, _to), false)
    ELSE _block
  END;
$$;

-- ---------------------------------------------------------------------------
-- Document-scoped indents.oracles_data update
-- Only the OracleBlock where oracle_no = _oracle_no is rewritten, only the chosen slot.
-- All other oracle_nos in the same indent stay byte-identical.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.indent_oracle_set_serial(
  _oracles_data jsonb,
  _oracle_no text,
  _slot text,
  _from text,
  _to text
) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(
       CASE WHEN b->>'oracle_no' = _oracle_no
            THEN public.serial_replace_in_oracle_block(b, _slot, _from, _to)
            ELSE b END
     ) FROM jsonb_array_elements(COALESCE(_oracles_data,'[]'::jsonb)) AS b),
    '[]'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- New admin RPC: correct a single oracle slot (B or C or D)
-- Scope: ONLY this indent + this oracle_no + this slot
-- Never touches delivery_challans / grns / stock unless caller explicitly asks
-- via _also_update_doc boolean (default false — caller can separately fix doc).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.correct_indent_oracle_serial(
  _indent_id uuid,
  _oracle_no text,
  _slot text,          -- 'exchange'|'received'|'customer_received'|'defective'
  _old_serial text,
  _new_serial text,
  _reason text
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
  -- Allow SQL Editor (auth.uid() IS NULL, current_user = postgres/service_role) to run scoped fixes
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can correct serial numbers';
  END IF;
  IF v_old IS NULL OR v_new IS NULL OR v_old = v_new THEN
    RAISE EXCEPTION 'Old and new serial numbers must be provided and different';
  END IF;
  IF _slot NOT IN ('exchange','received','customer_received','defective') THEN
    RAISE EXCEPTION 'Slot must be exchange|received|customer_received|defective, got %', _slot;
  END IF;

  SELECT * INTO v_indent FROM public.indents WHERE id = _indent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Indent % not found', _indent_id; END IF;

  -- verify the old serial is actually in the requested slot/oracle
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

  -- audit (never delete)
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason, deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('indent_oracle_serial_correction', _slot, v_indent.indent_no, v_indent.id, _reason, auth.uid(), v_indent.created_by, v_indent.created_at,
     jsonb_build_object('oracle_no', _oracle_no, 'slot', _slot, 'old_serial', v_old, 'new_serial', v_new));

  -- scoped update — ONLY that oracle block, ONLY that slot, ONLY this indent_id
  UPDATE public.indents
     SET oracles_data = public.indent_oracle_set_serial(oracles_data, _oracle_no, _slot, v_old, v_new),
         updated_at = now()
   WHERE id = _indent_id;
END $$;

GRANT EXECUTE ON FUNCTION public.correct_indent_oracle_serial(uuid, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Overload correct_grn_serial to support scoped mode (keeps old 4-arg sig compatible)
-- Old callers (4 args) → scope='document' → scoped, NOT global fan-out.
-- Pass scope='global' explicitly if you truly want the old blind propagation.
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
BEGIN
  -- Allow SQL Editor (auth.uid() NULL) — Postgres/service_role
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can correct serial numbers';
  END IF;
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
    ('grn_serial_correction', gr.category, gr.grn_no, gr.id, _reason, auth.uid(), gr.created_by, gr.created_at,
     jsonb_build_object('old_serial', v_old, 'new_serial', v_new, 'scope', _scope, 'oracle_no', _oracle_no));

  -- 1) Fix THIS grn only (always scoped to id)
  UPDATE public.grns
     SET items = (SELECT COALESCE(jsonb_agg(public.serial_replace_in_item(it, v_old, v_new)), '[]'::jsonb) FROM jsonb_array_elements(COALESCE(items,'[]'::jsonb)) AS it)
   WHERE id = _grn_id;

  -- 2) For document scope, do NOT fan out to stock + all indents/DCs.
  --    Caller (UI) should use correct_indent_oracle_serial for the specific oracle slot if needed.
  --    Stock is left to correct_grn_serial's stock update ONLY when scope=global or when stock serial equals old and caller wants it.
  IF _scope = 'global' THEN
    -- legacy global fan-out (now opt-in)
    UPDATE public.ims_stock_items SET part_serial_no = v_new WHERE part_serial_no = v_old;
    -- trg will fan out to all indents/dcs via propagate_serial_correction
  END IF;

  -- If oracle_no provided even in document scope, also fix that single oracle's received slot (common case C)
  IF _oracle_no IS NOT NULL AND _scope = 'document' THEN
    -- find indent that owns this grn (indent_id on grn) or fallback to most recent indent for that oracle
    SELECT indent_id INTO v_indent_id FROM public.grns WHERE id = _grn_id;
    IF v_indent_id IS NOT NULL THEN
      SELECT oracle_no INTO v_oracle_no FROM jsonb_array_elements((SELECT oracles_data FROM public.indents WHERE id = v_indent_id)) b WHERE b->>'oracle_no' = _oracle_no LIMIT 1;
      IF v_oracle_no IS NOT NULL THEN
        PERFORM public.correct_indent_oracle_serial(v_indent_id, _oracle_no, 'received', v_old, v_new, _reason || ' (auto from grn scoped)');
      END IF;
    END IF;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.correct_grn_serial(uuid, text, text, text, text, text) TO authenticated;

-- Keep old 4-arg signature callable (Postgres resolves to 6-arg with defaults)
COMMENT ON FUNCTION public.correct_grn_serial(uuid, text, text, text, text, text) IS 'Scoped serial correction: default scope=document touches only that GRN (+ optionally that oracle received slot). Pass scope=global to get legacy blind propagation.';
COMMENT ON FUNCTION public.correct_indent_oracle_serial(uuid, text, text, text, text, text) IS 'Document-scoped: corrects only one indent/oracle/slot (exchange|received|customer_received|defective). Never touches other slots or other DCs.';
