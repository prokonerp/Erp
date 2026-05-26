
CREATE TABLE public.pm_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amc_id uuid NOT NULL REFERENCES public.amcs(id) ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  completed_at timestamptz,
  completed_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (amc_id, scheduled_date)
);

CREATE INDEX idx_pm_visits_scheduled ON public.pm_visits(scheduled_date);
CREATE INDEX idx_pm_visits_amc ON public.pm_visits(amc_id);

ALTER TABLE public.pm_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view pm_visits" ON public.pm_visits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated insert pm_visits" ON public.pm_visits FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated update pm_visits" ON public.pm_visits FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated delete pm_visits" ON public.pm_visits FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_pm_visits_updated_at
BEFORE UPDATE ON public.pm_visits
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Sync function: create pm_visits rows from amcs.pm_dates
CREATE OR REPLACE FUNCTION public.sync_pm_visits()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  d text;
BEGIN
  IF NEW.pm_dates IS NOT NULL THEN
    FOR d IN SELECT jsonb_array_elements_text(NEW.pm_dates)
    LOOP
      INSERT INTO public.pm_visits (amc_id, scheduled_date)
      VALUES (NEW.id, d::date)
      ON CONFLICT (amc_id, scheduled_date) DO NOTHING;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_amcs_sync_pm
AFTER INSERT OR UPDATE OF pm_dates ON public.amcs
FOR EACH ROW EXECUTE FUNCTION public.sync_pm_visits();

-- Backfill existing AMCs
INSERT INTO public.pm_visits (amc_id, scheduled_date)
SELECT a.id, (d)::date
FROM public.amcs a, jsonb_array_elements_text(a.pm_dates) d
ON CONFLICT (amc_id, scheduled_date) DO NOTHING;
