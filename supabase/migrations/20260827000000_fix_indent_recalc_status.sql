-- Fix recalc_indent_status to treat the app's actual DC posting status
-- ('Challan Generated') as a completed document, matching dc_post_inventory
-- and the UI. Previously it only counted status='Submitted', so a DC generated
-- from an Oracle/Indent (which is saved as 'Challan Generated') never flipped
-- the indent to completed and the Oracle kept prompting "Generate DC" — leading
-- to duplicate dispatches and the "not in stock" error.
CREATE OR REPLACE FUNCTION public.recalc_indent_status(_indent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
 AS $function$
DECLARE
  dc_count INT; grn_count INT;
  dc_done INT; grn_done INT;
  new_status TEXT;
BEGIN
  IF _indent_id IS NULL THEN RETURN; END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status IN ('Submitted','Challan Generated'))
    INTO dc_count, dc_done
    FROM public.delivery_challans WHERE indent_id = _indent_id;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status IN ('Submitted','Challan Generated'))
    INTO grn_count, grn_done
    FROM public.grns WHERE indent_id = _indent_id;

  IF dc_count = 0 AND grn_count = 0 THEN
    new_status := 'open';
  ELSIF (dc_done + grn_done) = 0 THEN
    new_status := 'in_progress';
  ELSIF (dc_done = dc_count) AND (grn_done = grn_count) AND (dc_count + grn_count) > 0 THEN
    new_status := 'completed';
  ELSE
    new_status := 'partially_completed';
  END IF;

  UPDATE public.indents
     SET status = new_status, updated_at = now()
   WHERE id = _indent_id AND status NOT IN ('closed','draft');
END $function$;
