
-- Part 1: admin_edit_grn_reverse — reverses stock for a Submitted GRN and flips it back to Draft
CREATE OR REPLACE FUNCTION public.admin_edit_grn_reverse(_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gr public.grns%ROWTYPE;
  ref TEXT;
  locked_count INT;
  invoice_hit INT;
  serials TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can edit submitted GRNs';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT * INTO gr FROM public.grns WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;
  IF gr.status <> 'Submitted' THEN
    RAISE EXCEPTION 'Only Submitted GRNs can be edited';
  END IF;

  ref := 'GRN ' || gr.grn_no;

  -- collect serials from this GRN's stock rows
  SELECT COALESCE(array_agg(part_serial_no) FILTER (WHERE part_serial_no IS NOT NULL), '{}')
    INTO serials
    FROM public.ims_stock_items WHERE transaction_ref = ref;

  -- invoice linkage guard
  IF array_length(serials, 1) > 0 THEN
    SELECT count(*) INTO invoice_hit
      FROM public.invoice_items
     WHERE serial_numbers && serials;
    IF invoice_hit > 0 THEN
      RAISE EXCEPTION 'Invoice exists. Create correction entry instead';
    END IF;
  END IF;

  -- downstream consumption guard
  SELECT count(*) INTO locked_count
    FROM public.ims_stock_items
   WHERE transaction_ref = ref
     AND stock_status NOT IN ('available'::public.ims_stock_status,
                              'scrapped'::public.ims_stock_status);
  IF locked_count > 0 THEN
    RAISE EXCEPTION 'Cannot edit GRN %: % stock item(s) already issued/reserved. Reverse those first.', gr.grn_no, locked_count;
  END IF;

  -- audit before reversal
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason,
     deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('grn_edit_reverse', gr.category, gr.grn_no, gr.id, _reason,
     auth.uid(), gr.created_by, gr.created_at, to_jsonb(gr));

  -- reverse
  DELETE FROM public.ims_transactions WHERE reference = ref;
  DELETE FROM public.ims_stock_items  WHERE transaction_ref = ref;

  -- flip back to Draft; re-posting handled by grn_post_inventory on next Submit
  UPDATE public.grns
     SET status = 'Draft',
         submitted_at = NULL,
         submitted_by = NULL,
         updated_at = now()
   WHERE id = _id;

  IF gr.indent_id IS NOT NULL THEN
    PERFORM public.recalc_indent_status(gr.indent_id);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_edit_grn_reverse(uuid, text) TO authenticated;

-- Part 2: admin_reopen_oracle
CREATE OR REPLACE FUNCTION public.admin_reopen_oracle(_indent_id uuid, _oracle_no text, _reason text, _scope text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ind public.indents%ROWTYPE;
  g RECORD;
  d RECORD;
  ref TEXT;
  serials TEXT[];
  invoice_hit INT;
  new_od JSONB;
  i INT;
  blk JSONB;
  found_blk BOOLEAN := false;
  locked_count INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can reopen an Oracle';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF _scope NOT IN ('grn','dc','full') THEN
    RAISE EXCEPTION 'Invalid scope. Use grn, dc, or full';
  END IF;

  SELECT * INTO ind FROM public.indents WHERE id = _indent_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Indent not found'; END IF;

  -- Invoice guard across every GRN on this indent
  SELECT COALESCE(array_agg(DISTINCT s.part_serial_no) FILTER (WHERE s.part_serial_no IS NOT NULL), '{}')
    INTO serials
    FROM public.grns g2
    JOIN public.ims_stock_items s ON s.transaction_ref = 'GRN ' || g2.grn_no
   WHERE g2.indent_id = _indent_id;
  IF array_length(serials,1) > 0 THEN
    SELECT count(*) INTO invoice_hit FROM public.invoice_items WHERE serial_numbers && serials;
    IF invoice_hit > 0 THEN
      RAISE EXCEPTION 'Invoice exists. Use correction workflow';
    END IF;
  END IF;

  -- GRN reversal
  IF _scope IN ('grn','full') THEN
    FOR g IN
      SELECT * FROM public.grns
       WHERE indent_id = _indent_id AND status = 'Submitted'
    LOOP
      ref := 'GRN ' || g.grn_no;
      SELECT count(*) INTO locked_count
        FROM public.ims_stock_items
       WHERE transaction_ref = ref
         AND stock_status NOT IN ('available'::public.ims_stock_status,
                                  'scrapped'::public.ims_stock_status);
      IF locked_count > 0 THEN
        RAISE EXCEPTION 'Cannot reopen: GRN % has % consumed stock item(s)', g.grn_no, locked_count;
      END IF;

      INSERT INTO public.document_deletion_audit
        (document_type, document_subtype, document_no, document_id, reason,
         deleted_by, original_created_by, original_created_at, snapshot)
      VALUES
        ('grn_reopen', g.category, g.grn_no, g.id, _reason,
         auth.uid(), g.created_by, g.created_at, to_jsonb(g));

      DELETE FROM public.ims_transactions WHERE reference = ref;
      DELETE FROM public.ims_stock_items  WHERE transaction_ref = ref;

      UPDATE public.grns
         SET status = 'Draft',
             submitted_at = NULL,
             submitted_by = NULL,
             updated_at = now()
       WHERE id = g.id;
    END LOOP;
  END IF;

  -- DC reversal
  IF _scope IN ('dc','full') THEN
    FOR d IN
      SELECT * FROM public.delivery_challans
       WHERE indent_id = _indent_id
         AND status IN ('Challan Generated','Submitted')
    LOOP
      ref := 'DC ' || d.challan_no;

      INSERT INTO public.document_deletion_audit
        (document_type, document_subtype, document_no, document_id, reason,
         deleted_by, original_created_by, original_created_at, snapshot)
      VALUES
        ('dc_reopen', d.doc_type, d.challan_no, d.id, _reason,
         auth.uid(), d.created_by, d.created_at, to_jsonb(d));

      -- release stock back to available
      UPDATE public.ims_stock_items
         SET stock_status = 'available'::public.ims_stock_status,
             transaction_ref = NULL,
             updated_at = now()
       WHERE transaction_ref = ref
         AND stock_status IN ('issued'::public.ims_stock_status,
                              'returned_to_oem'::public.ims_stock_status,
                              'reserved'::public.ims_stock_status);

      DELETE FROM public.ims_transactions WHERE reference = ref;
      DELETE FROM public.ims_reservations WHERE reference = ref;

      UPDATE public.delivery_challans
         SET status = 'Draft', updated_at = now()
       WHERE id = d.id;
    END LOOP;
  END IF;

  -- Patch the oracle block with reopened flag
  new_od := COALESCE(ind.oracles_data, '[]'::jsonb);
  IF jsonb_typeof(new_od) = 'array' THEN
    FOR i IN 0..jsonb_array_length(new_od)-1 LOOP
      blk := new_od -> i;
      IF btrim(COALESCE(blk->>'oracle_no','')) = btrim(COALESCE(_oracle_no,'')) THEN
        blk := blk || jsonb_build_object('reopened', jsonb_build_object(
          'at', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SSOF'),
          'by', auth.uid()::text,
          'reason', _reason,
          'scope', _scope
        ));
        new_od := jsonb_set(new_od, ARRAY[i::text], blk, false);
        found_blk := true;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.indents
     SET oracles_data = new_od,
         updated_at = now()
   WHERE id = _indent_id;

  PERFORM public.recalc_indent_status(_indent_id);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_reopen_oracle(uuid, text, text, text) TO authenticated;
