
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS amc_id uuid REFERENCES public.amcs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pm_visit_id uuid REFERENCES public.pm_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_amc_id ON public.tickets(amc_id);
CREATE INDEX IF NOT EXISTS idx_tickets_pm_visit_id ON public.tickets(pm_visit_id);
