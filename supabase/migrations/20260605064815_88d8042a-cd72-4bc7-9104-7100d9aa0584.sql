ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'India',
  ADD COLUMN IF NOT EXISTS gst_status text NOT NULL DEFAULT 'Unregistered',
  ADD COLUMN IF NOT EXISTS contacts jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Enforce GST number presence when status is Registered (trigger, not CHECK, for flexibility)
CREATE OR REPLACE FUNCTION public.validate_customer_gst()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.gst_status = 'Registered' AND (NEW.gst IS NULL OR length(trim(NEW.gst)) < 10) THEN
    RAISE EXCEPTION 'GST number is required when GST status is Registered';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_validate_customer_gst ON public.customers;
CREATE TRIGGER trg_validate_customer_gst
BEFORE INSERT OR UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.validate_customer_gst();