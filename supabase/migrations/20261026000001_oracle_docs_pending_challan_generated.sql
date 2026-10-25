-- Fix: oracle_docs_pending must agree with oracle_docs_satisfied on
-- 'Challan Generated' delivery challans. Previously a dispatched challan
-- counted as pending forever, so oracles_autoclose() could never fire.
CREATE OR REPLACE FUNCTION public.oracle_docs_pending(_indent_id uuid, _oracle_no text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  key TEXT := upper(btrim(COALESCE(_oracle_no,'')));
  hit INT := 0;
BEGIN
  IF _indent_id IS NULL THEN RETURN FALSE; END IF;

  SELECT count(*) INTO hit
    FROM public.delivery_challans dc
   WHERE dc.indent_id = _indent_id
     AND lower(COALESCE(dc.status,'')) <> 'cancelled'
     AND COALESCE(dc.status,'') NOT IN ('Submitted','Closed','Challan Generated')
     AND (
       key = '' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(dc.items,'[]'::jsonb)) it
          WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key
       )
     );
  IF hit > 0 THEN RETURN TRUE; END IF;

  SELECT count(*) INTO hit
    FROM public.grns g
   WHERE g.indent_id = _indent_id
     AND lower(COALESCE(g.status,'')) <> 'cancelled'
     AND COALESCE(g.status,'') NOT IN ('Submitted','Closed')
     AND (
       key = '' OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(COALESCE(g.items,'[]'::jsonb)) it
          WHERE upper(btrim(COALESCE(it->>'oracle_no',''))) = key
       )
     );
  RETURN hit > 0;
END
$fn$;

GRANT EXECUTE ON FUNCTION public.oracle_docs_pending(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.oracle_docs_pending(uuid, text) TO service_role;
