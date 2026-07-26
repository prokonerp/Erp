CREATE OR REPLACE FUNCTION public.set_quote_no()
RETURNS trigger
LANGUAGE plpgsql
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

    -- Serialize quote-number allocation per FY to avoid race duplicates
    PERFORM pg_advisory_xact_lock(hashtextextended('quotations_quote_no:' || fy, 0));

    SELECT COALESCE(MAX(CAST(split_part(quote_no,'/',3) AS int)),0)+1 INTO seq
      FROM public.quotations WHERE quote_no LIKE 'PHS/'||fy||'/%';

    candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');

    -- Defensive: skip any already-taken numbers (in case of manual entries)
    WHILE EXISTS (SELECT 1 FROM public.quotations WHERE quote_no = candidate) LOOP
      seq := seq + 1;
      candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');
    END LOOP;

    NEW.quote_no := candidate;
  END IF;
  RETURN NEW;
END $function$;