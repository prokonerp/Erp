-- =============================================================================
-- Oracle close hardening (follow-up to 20261013000000 / 20261013000001).
--
-- Three additive parts, all idempotent (safe to re-run):
--
--   PART 1 — backfill_exchange_rows_from_dc() + trg_dc_backfill_exchange_rows
--     Mirror of trg_grn_backfill_oracle_rows, but for Delivery Challans ->
--     Section B (exchange_rows). Fills ONLY blank model_no / serial_no from
--     the settled DC item (never overwrites, never touches warehouse/qty).
--     This unsticks oracles whose Section B was wiped after the DC was
--     posted (e.g. by the warehouse re-pick that used to clear model+serial).
--     Only fires for DCs linked by indent_id with a settled status
--     ('Submitted' / 'Closed' / 'Challan Generated', case-insensitive) —
--     the exact set oracle_docs_satisfied() counts. Standalone legacy DCs
--     (indent_id IS NULL) are skipped, consistent with the closer.
--
--   PART 2 — revalidate_closed_oracles() + trg_indents_revalidate_oracles
--     BEFORE INSERT OR UPDATE on indents. Re-opens any block with
--     status='closed' that is NOT force_closed and NO LONGER satisfies
--     _oracle_block_complete() + oracle_docs_satisfied(). Stamps
--     reopened{at,by:'system-revalidate',reason} so the UI shows it.
--     Trigger name sorts AFTER trg_indents_autoclose_oracles, so the
--     closer runs first and this only ever corrects an invalid close.
--     need_cust derivation mirrors oracles_autoclose() EXACTLY (no COALESCE)
--     so the two can never fight over typeless rows.
--
--   PART 3 — indents_leave_draft_on_save() + trg_indents_leave_draft
--     A saved indent (indent_type IS NOT NULL) leaves 'draft' -> 'open' on
--     INSERT/UPDATE. Unsaved / typeless rows stay 'draft', preserving the
--     intent of the recalc_indent_status() draft exclusion. Existing drafts
--     flip as they are next saved — no bulk status rewrite here.
--
-- SCOPE GUARDS: additive-only (no existing function/trigger/table altered);
-- never overwrites non-blank values; never touches closed/force_closed
-- blocks (Part 1) or force_closed blocks (Part 2).
--
-- RUN INSTRUCTION: supabase db push  (DBA runs it; app code never writes DB)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PART 1: DC -> Section B backfill
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.backfill_exchange_rows_from_dc()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_indent_id    uuid;
  v_oracles      jsonb;
  v_items        jsonb;
  v_item         jsonb;
  v_item_idx     int;
  v_oracle_no    text;
  v_model        text;
  v_serial       text;
  v_block        jsonb;
  v_block_idx    int;
  v_block_status text;
  v_target       jsonb;
  v_new_target   jsonb;
  v_row          jsonb;
  v_chosen_idx   int;
  v_block_changed boolean;
  v_any_changed  boolean := false;
  i              int;
  j              int;
BEGIN
  -- Scope guard: settled, non-cancelled DC linked to an indent.
  IF NEW.indent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF lower(COALESCE(NEW.status, '')) NOT IN ('submitted', 'closed', 'challan generated') THEN
    RETURN NEW;
  END IF;

  IF lower(COALESCE(NEW.status, '')) = 'cancelled' THEN
    RETURN NEW;
  END IF;

  v_indent_id := NEW.indent_id;
  v_items     := COALESCE(NEW.items, '[]'::jsonb);

  -- Lock the indent row to prevent lost updates from concurrent triggers.
  SELECT oracles_data
    INTO v_oracles
    FROM public.indents
   WHERE id = v_indent_id
   FOR UPDATE;

  IF v_oracles IS NULL OR jsonb_typeof(v_oracles) <> 'array' THEN
    RETURN NEW;
  END IF;

  FOR v_item_idx IN 0..jsonb_array_length(v_items) - 1 LOOP
    v_item      := v_items -> v_item_idx;
    v_oracle_no := upper(btrim(COALESCE(v_item->>'oracle_no', '')));

    CONTINUE WHEN v_oracle_no = '';

    -- Source values. Prefer model_no; fall back to part_no (the app writes
    -- both; part_no may equal the model for indent-generated DCs).
    v_model  := NULLIF(btrim(COALESCE(v_item->>'model_no', '')), '');
    IF v_model IS NULL THEN
      v_model := NULLIF(btrim(COALESCE(v_item->>'part_no', '')), '');
    END IF;
    v_serial := NULLIF(btrim(COALESCE(v_item->>'serial_no', '')), '');

    CONTINUE WHEN v_model IS NULL AND v_serial IS NULL;

    -- Find the matching OPEN block.
    v_block_idx := NULL;
    FOR i IN 0..jsonb_array_length(v_oracles) - 1 LOOP
      v_block        := v_oracles -> i;
      v_block_status := COALESCE(v_block->>'status', 'open');

      IF v_block_status NOT IN ('closed', 'force_closed')
         AND upper(btrim(COALESCE(v_block->>'oracle_no', ''))) = v_oracle_no THEN
        v_block_idx := i;
        EXIT;
      END IF;
    END LOOP;

    CONTINUE WHEN v_block_idx IS NULL;

    v_block  := v_oracles -> v_block_idx;
    v_target := COALESCE(v_block -> 'exchange_rows', '[]'::jsonb);

    IF jsonb_typeof(v_target) <> 'array' THEN
      CONTINUE;
    END IF;

    -- Row choice. A row is fillable when model_no OR serial_no is blank.
    -- Pass 1: serial match with a blank field.
    -- Pass 2: same index as the DC item, if it has a blank field.
    -- Pass 3: first row with any blank field.
    v_chosen_idx := NULL;

    IF v_serial IS NOT NULL THEN
      FOR j IN 0..jsonb_array_length(v_target) - 1 LOOP
        v_row := v_target -> j;
        IF lower(btrim(COALESCE(v_row->>'serial_no', ''))) = lower(v_serial)
           AND (public._oracle_row_str(v_row, 'model_no') = ''
                OR public._oracle_row_str(v_row, 'serial_no') = '') THEN
          v_chosen_idx := j;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    IF v_chosen_idx IS NULL AND v_item_idx < jsonb_array_length(v_target) THEN
      v_row := v_target -> v_item_idx;
      IF public._oracle_row_str(v_row, 'model_no') = ''
         OR public._oracle_row_str(v_row, 'serial_no') = '' THEN
        v_chosen_idx := v_item_idx;
      END IF;
    END IF;

    IF v_chosen_idx IS NULL THEN
      FOR j IN 0..jsonb_array_length(v_target) - 1 LOOP
        v_row := v_target -> j;
        IF public._oracle_row_str(v_row, 'model_no') = ''
           OR public._oracle_row_str(v_row, 'serial_no') = '' THEN
          v_chosen_idx := j;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    CONTINUE WHEN v_chosen_idx IS NULL;

    -- Fill blank fields only. NEVER overwrite non-blank.
    v_row           := v_target -> v_chosen_idx;
    v_block_changed := false;

    IF public._oracle_row_str(v_row, 'model_no') = ''
       AND v_model IS NOT NULL THEN
      v_row := jsonb_set(v_row, '{model_no}', to_jsonb(v_model));
      v_block_changed := true;
    END IF;

    IF public._oracle_row_str(v_row, 'serial_no') = ''
       AND v_serial IS NOT NULL THEN
      v_row := jsonb_set(v_row, '{serial_no}', to_jsonb(v_serial));
      v_block_changed := true;
    END IF;

    IF v_block_changed THEN
      SELECT jsonb_agg(
        CASE
          WHEN ord = v_chosen_idx THEN v_row
          ELSE v_target -> ord
        END
      )
        INTO v_new_target
        FROM generate_series(0, jsonb_array_length(v_target) - 1) AS ord;

      v_block := jsonb_set(
        v_block,
        '{exchange_rows}',
        COALESCE(v_new_target, '[]'::jsonb)
      );

      SELECT jsonb_agg(
        CASE
          WHEN ord = v_block_idx THEN v_block
          ELSE v_oracles -> ord
        END
      )
        INTO v_oracles
        FROM generate_series(0, jsonb_array_length(v_oracles) - 1) AS ord;

      v_any_changed := true;
    END IF;

  END LOOP;

  -- Only UPDATE when something changed. This re-fires
  -- trg_indents_autoclose_oracles (the desired auto-close path).
  IF v_any_changed THEN
    UPDATE public.indents
       SET oracles_data = v_oracles
     WHERE id = v_indent_id;
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_dc_backfill_exchange_rows ON public.delivery_challans;

CREATE TRIGGER trg_dc_backfill_exchange_rows
  AFTER INSERT OR UPDATE ON public.delivery_challans
  FOR EACH ROW
  WHEN (lower(COALESCE(NEW.status, '')) IN ('submitted', 'closed', 'challan generated'))
  EXECUTE FUNCTION public.backfill_exchange_rows_from_dc();

-- -----------------------------------------------------------------------------
-- PART 2: re-open wrongly-closed blocks (never force_closed)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revalidate_closed_oracles()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  need_cust     boolean;
  v_oracles     jsonb;
  v_block       jsonb;
  v_new_block   jsonb;
  v_new_oracles jsonb;
  v_changed     boolean := false;
  i             int;
BEGIN
  IF NEW.oracles_data IS NULL OR jsonb_typeof(NEW.oracles_data) <> 'array' THEN
    RETURN NEW;
  END IF;

  -- Mirrors oracles_autoclose() exactly (deliberately no COALESCE on a null
  -- indent_type) so the closer and the revalidator can never disagree.
  need_cust := NEW.indent_type::text <> 'rma_service_ship';
  v_oracles := NEW.oracles_data;

  FOR i IN 0..jsonb_array_length(v_oracles) - 1 LOOP
    v_block := v_oracles -> i;

    IF COALESCE(v_block->>'status', 'open') = 'closed'
       AND COALESCE(v_block->>'force_closed', 'false') <> 'true'
       AND NOT (public._oracle_block_complete(v_block, need_cust)
                AND public.oracle_docs_satisfied(NEW.id, v_block, need_cust)) THEN
      v_new_block := jsonb_set(v_block, '{status}', '"open"');
      v_new_block := jsonb_set(
        v_new_block,
        '{reopened}',
        jsonb_build_object(
          'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'by', 'system-revalidate',
          'reason', 'auto-revalidate: block no longer satisfies close criteria'
        )
      );

      SELECT jsonb_agg(
        CASE
          WHEN ord = i THEN v_new_block
          ELSE v_oracles -> ord
        END
      )
        INTO v_new_oracles
        FROM generate_series(0, jsonb_array_length(v_oracles) - 1) AS ord;

      v_oracles := COALESCE(v_new_oracles, v_oracles);
      v_changed := true;
    END IF;
  END LOOP;

  IF v_changed THEN
    NEW.oracles_data := v_oracles;
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_indents_revalidate_oracles ON public.indents;

-- Name sorts after trg_indents_autoclose_oracles: the closer runs first,
-- this trigger only ever corrects an invalid close.
CREATE TRIGGER trg_indents_revalidate_oracles
  BEFORE INSERT OR UPDATE ON public.indents
  FOR EACH ROW
  EXECUTE FUNCTION public.revalidate_closed_oracles();

-- -----------------------------------------------------------------------------
-- PART 3: saved indents leave 'draft'
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.indents_leave_draft_on_save()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.indent_type IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status IS NULL OR NEW.status = 'draft' THEN
        NEW.status := 'open';
      END IF;
    ELSIF OLD.status IS NULL OR OLD.status = 'draft' THEN
      NEW.status := 'open';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_indents_leave_draft ON public.indents;

CREATE TRIGGER trg_indents_leave_draft
  BEFORE INSERT OR UPDATE ON public.indents
  FOR EACH ROW
  EXECUTE FUNCTION public.indents_leave_draft_on_save();
