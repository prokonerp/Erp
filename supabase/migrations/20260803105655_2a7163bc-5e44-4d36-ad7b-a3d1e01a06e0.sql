ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS closed_remarks text,
  ADD COLUMN IF NOT EXISTS lost_reason text;