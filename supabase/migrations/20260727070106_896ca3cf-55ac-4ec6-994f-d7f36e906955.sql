CREATE OR REPLACE FUNCTION public.set_quote_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d date := COALESCE(NEW.quote_date, CURRENT_DATE);
  start_yr int;
  end_yr int;
  fy text;
  seq int;
  candidate text;
BEGIN
  IF NEW.quote_no IS NULL OR NEW.quote_no = '' THEN
    IF EXTRACT(MONTH FROM d) >= 4 THEN
      start_yr := EXTRACT(YEAR FROM d)::int;
    ELSE
      start_yr := EXTRACT(YEAR FROM d)::int - 1;
    END IF;
    end_yr := start_yr + 1;
    fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

    -- Serialize allocation for the financial year and bypass per-user RLS visibility.
    PERFORM pg_advisory_xact_lock(hashtextextended('quotations_quote_no:' || fy, 0));

    SELECT COALESCE(MAX((regexp_match(quote_no, '^PHS/' || fy || '/([0-9]+)$'))[1]::int), 0) + 1
      INTO seq
      FROM public.quotations
     WHERE quote_no ~ ('^PHS/' || fy || '/[0-9]+$');

    candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');

    WHILE EXISTS (SELECT 1 FROM public.quotations WHERE quote_no = candidate) LOOP
      seq := seq + 1;
      candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');
    END LOOP;

    NEW.quote_no := candidate;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.set_quote_no() FROM PUBLIC;

DROP POLICY IF EXISTS "own q insert" ON public.quotations;
DROP POLICY IF EXISTS "own q select" ON public.quotations;
DROP POLICY IF EXISTS "own q update" ON public.quotations;
DROP POLICY IF EXISTS "own q delete" ON public.quotations;
DROP POLICY IF EXISTS "quotations_insert_own_with_permission" ON public.quotations;
DROP POLICY IF EXISTS "quotations_select_with_permission" ON public.quotations;
DROP POLICY IF EXISTS "quotations_update_own_with_permission" ON public.quotations;
DROP POLICY IF EXISTS "quotations_delete_own_with_permission" ON public.quotations;

CREATE POLICY "quotations_insert_own_with_permission"
ON public.quotations
FOR INSERT
TO authenticated
WITH CHECK (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'create')
);

CREATE POLICY "quotations_select_with_permission"
ON public.quotations
FOR SELECT
TO authenticated
USING (
  owner_id = auth.uid()
  OR public.has_permission(auth.uid(), 'quotations', 'read')
);

CREATE POLICY "quotations_update_own_with_permission"
ON public.quotations
FOR UPDATE
TO authenticated
USING (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'edit')
)
WITH CHECK (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'edit')
);

CREATE POLICY "quotations_delete_own_with_permission"
ON public.quotations
FOR DELETE
TO authenticated
USING (
  owner_id = auth.uid()
  AND public.has_permission(auth.uid(), 'quotations', 'delete')
);