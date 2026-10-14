-- =============================================================================
-- Fix: remove dead `ord` variable colliding with the `AS ord`
-- generate_series alias (Postgres 42702 at first trigger fire).
-- Twin of the 20261014 DC-backfill fix. The committed 20261013000001 file
-- is left untouched (already applied); this patch supersedes its function.
-- Idempotent (CREATE OR REPLACE, function only). DBA: supabase db push.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.backfill_oracle_rows_from_grn()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_indent_id    uuid;
  v_category     text;
  v_oracles      jsonb;
  v_grn_items    jsonb;
  v_item         jsonb;
  v_item_idx     int;
  v_oracle_no    text;
  v_block        jsonb;
  v_block_idx    int;
  v_block_status text;
  v_target_key   text;
  v_target       jsonb;
  v_new_target   jsonb;
  v_row          jsonb;
  v_row_idx      int;
  v_chosen_idx   int;
  v_wh_id        text;
  v_wh_name      text;
  v_recv_date    text;
  v_prod_tag     text;
  v_block_changed boolean;
  v_any_changed  boolean := false;
  i              int;
  j              int;
BEGIN
  -- Scope guard: settled, non-cancelled GRN linked to an indent
  IF NEW.indent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status, '') NOT IN ('Submitted', 'Closed') THEN
    RETURN NEW;
  END IF;

  -- Cancelled is represented as status='cancelled' (text), not a boolean flag
  IF lower(COALESCE(NEW.status, '')) = 'cancelled' THEN
    RETURN NEW;
  END IF;

  v_indent_id := NEW.indent_id;
  v_category  := COALESCE(NEW.category, '');
  v_grn_items := COALESCE(NEW.items, '[]'::jsonb);

  -- Map category to target row array key
  IF v_category = 'customer' THEN
    v_target_key := 'customer_received_rows';
  ELSIF v_category = 'oem' THEN
    v_target_key := 'received_rows';
  ELSE
    -- 'general' GRNs have no oracle row mapping
    RETURN NEW;
  END IF;

  -- Lock the indent row to prevent lost updates from concurrent GRN triggers
  SELECT oracles_data
    INTO v_oracles
    FROM public.indents
   WHERE id = v_indent_id
   FOR UPDATE;

  IF v_oracles IS NULL OR jsonb_typeof(v_oracles) <> 'array' THEN
    RETURN NEW;
  END IF;

  -- Iterate each GRN item
  FOR v_item_idx IN 0..jsonb_array_length(v_grn_items) - 1 LOOP
    v_item      := v_grn_items -> v_item_idx;
    v_oracle_no := upper(btrim(COALESCE(v_item->>'oracle_no', '')));

    -- Skip items without an oracle number
    CONTINUE WHEN v_oracle_no = '';

    -- Extract source values from the GRN item (NULL if blank/missing)
    v_wh_id     := NULLIF(btrim(COALESCE(v_item->>'warehouse_id', '')), '');
    v_wh_name   := NULLIF(btrim(COALESCE(v_item->>'warehouse_name', '')), '');
    v_recv_date := NULLIF(btrim(COALESCE(v_item->>'received_date', '')), '');

    -- Find the matching OPEN block in oracles_data
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

    -- No matching open block — skip this item
    CONTINUE WHEN v_block_idx IS NULL;

    v_block   := v_oracles -> v_block_idx;
    v_target  := COALESCE(v_block -> v_target_key, '[]'::jsonb);

    -- Target row array must exist and be an array
    IF jsonb_typeof(v_target) <> 'array' THEN
      CONTINUE;
    END IF;

    -- ---------------------------------------------------------------
    -- Choose which row in the target array to fill.
    -- Pass 1: prefer row with same serial_no (case-insensitive) that has
    --         at least one blank field we can fill
    -- Pass 2: row at the same index as the GRN item, if it has blank fields
    -- Pass 3: first row with any blank field (safety net)
    -- ---------------------------------------------------------------
    v_chosen_idx := NULL;

    -- Pass 1: serial_no match with blank fields
    FOR j IN 0..jsonb_array_length(v_target) - 1 LOOP
      v_row := v_target -> j;

      IF lower(btrim(COALESCE(v_row->>'serial_no', '')))
           = lower(btrim(COALESCE(v_item->>'serial_no', '')))
         AND (
           public._oracle_row_str(v_row, 'warehouse_id') = ''
           OR public._oracle_row_str(v_row, 'received_date') = ''
           OR (v_category = 'customer'
               AND public._oracle_row_str(v_row, 'product_tag') = '')
         ) THEN
        v_chosen_idx := j;
        EXIT;
      END IF;
    END LOOP;

    -- Pass 2: first blank-field row at the same index as the GRN item
    IF v_chosen_idx IS NULL AND v_item_idx < jsonb_array_length(v_target) THEN
      v_row := v_target -> v_item_idx;

      IF public._oracle_row_str(v_row, 'warehouse_id') = ''
         OR public._oracle_row_str(v_row, 'received_date') = ''
         OR (v_category = 'customer'
             AND public._oracle_row_str(v_row, 'product_tag') = '') THEN
        v_chosen_idx := v_item_idx;
      END IF;
    END IF;

    -- Pass 3: first blank-field row anywhere in the array
    IF v_chosen_idx IS NULL THEN
      FOR j IN 0..jsonb_array_length(v_target) - 1 LOOP
        v_row := v_target -> j;

        IF public._oracle_row_str(v_row, 'warehouse_id') = ''
           OR public._oracle_row_str(v_row, 'received_date') = ''
           OR (v_category = 'customer'
               AND public._oracle_row_str(v_row, 'product_tag') = '') THEN
          v_chosen_idx := j;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    -- No fillable row found in this block — skip
    CONTINUE WHEN v_chosen_idx IS NULL;

    -- ---------------------------------------------------------------
    -- Fill blank fields from the GRN item. NEVER overwrite non-blank.
    -- NEVER touch serial_no (manual entry by design).
    -- ---------------------------------------------------------------
    v_row         := v_target -> v_chosen_idx;
    v_block_changed := false;

    -- warehouse_id
    IF public._oracle_row_str(v_row, 'warehouse_id') = ''
       AND v_wh_id IS NOT NULL THEN
      v_row := jsonb_set(v_row, '{warehouse_id}', to_jsonb(v_wh_id));
      v_block_changed := true;
    END IF;

    -- warehouse_name
    IF public._oracle_row_str(v_row, 'warehouse_name') = ''
       AND v_wh_name IS NOT NULL THEN
      v_row := jsonb_set(v_row, '{warehouse_name}', to_jsonb(v_wh_name));
      v_block_changed := true;
    END IF;

    -- received_date
    IF public._oracle_row_str(v_row, 'received_date') = ''
       AND v_recv_date IS NOT NULL THEN
      v_row := jsonb_set(v_row, '{received_date}', to_jsonb(v_recv_date));
      v_block_changed := true;
    END IF;

    -- product_tag (customer only): default to 'defective' when blank
    IF v_category = 'customer'
       AND public._oracle_row_str(v_row, 'product_tag') = '' THEN
      v_prod_tag := COALESCE(
        NULLIF(btrim(COALESCE(v_item->>'product_tag', '')), ''),
        'defective'
      );
      v_row := jsonb_set(v_row, '{product_tag}', to_jsonb(v_prod_tag));
      v_block_changed := true;
    END IF;

    -- Only rebuild arrays if something actually changed
    IF v_block_changed THEN
      -- Rebuild the target row array with the modified row
      SELECT jsonb_agg(
        CASE
          WHEN ord = v_chosen_idx THEN v_row
          ELSE v_target -> ord
        END
      )
        INTO v_new_target
        FROM generate_series(0, jsonb_array_length(v_target) - 1) AS ord;

      -- Rebuild the block with the updated target array
      v_block := jsonb_set(
        v_block,
        ARRAY[v_target_key],
        COALESCE(v_new_target, '[]'::jsonb)
      );

      -- Rebuild oracles_data with the updated block
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

  -- Only UPDATE indents when at least one field actually changed.
  -- This UPDATE re-fires trg_indents_autoclose_oracles (the desired
  -- auto-close path). We do NOT call oracles_autoclose directly.
  IF v_any_changed THEN
    UPDATE public.indents
       SET oracles_data = v_oracles
     WHERE id = v_indent_id;
  END IF;

  RETURN NEW;
END
$function$;
