ALTER TABLE public.amcs ADD COLUMN IF NOT EXISTS bill_date date;
UPDATE public.amcs SET bill_date = start_date WHERE bill_date IS NULL;