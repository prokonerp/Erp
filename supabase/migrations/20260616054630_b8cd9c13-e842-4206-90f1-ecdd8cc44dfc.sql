
CREATE OR REPLACE FUNCTION public.sync_pm_visits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  d text;
  desired date[];
BEGIN
  IF NEW.pm_dates IS NOT NULL THEN
    FOR d IN SELECT jsonb_array_elements_text(NEW.pm_dates)
    LOOP
      INSERT INTO public.pm_visits (amc_id, scheduled_date)
      VALUES (NEW.id, d::date)
      ON CONFLICT (amc_id, scheduled_date) DO NOTHING;
    END LOOP;

    SELECT COALESCE(array_agg((x)::date), ARRAY[]::date[])
      INTO desired
      FROM jsonb_array_elements_text(NEW.pm_dates) AS x;
  ELSE
    desired := ARRAY[]::date[];
  END IF;

  -- Remove pending PM visits whose date was removed from AMC. Keep completed.
  DELETE FROM public.pm_visits
   WHERE amc_id = NEW.id
     AND completed_at IS NULL
     AND NOT (scheduled_date = ANY(desired));

  RETURN NEW;
END;
$function$;

-- Backfill missing pm_visits for existing AMCs
INSERT INTO public.pm_visits (amc_id, scheduled_date)
SELECT a.id, (d)::date
FROM public.amcs a,
     LATERAL jsonb_array_elements_text(COALESCE(a.pm_dates, '[]'::jsonb)) AS d
ON CONFLICT (amc_id, scheduled_date) DO NOTHING;
