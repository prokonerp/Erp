-- Add customer_id FK to amcs
ALTER TABLE public.amcs ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_amcs_customer_id ON public.amcs(customer_id);

-- Add FK constraint to tickets.customer_id (column already exists)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tickets_customer_id_fkey'
  ) THEN
    ALTER TABLE public.tickets ADD CONSTRAINT tickets_customer_id_fkey
      FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tickets_customer_id ON public.tickets(customer_id);

-- Backfill tickets.customer_id by matching company/contact name + phone
UPDATE public.tickets t
SET customer_id = c.id
FROM public.customers c
WHERE t.customer_id IS NULL
  AND (
    (t.customer_phone IS NOT NULL AND t.customer_phone <> '' AND regexp_replace(t.customer_phone,'\D','','g') = regexp_replace(c.phone,'\D','','g'))
    OR lower(trim(t.customer_name)) = lower(trim(c.company))
    OR lower(trim(t.customer_name)) = lower(trim(c.contact_name))
  );

-- Backfill amcs.customer_id by matching client_name/client_company + contact_no
UPDATE public.amcs a
SET customer_id = c.id
FROM public.customers c
WHERE a.customer_id IS NULL
  AND (
    (a.contact_no IS NOT NULL AND a.contact_no <> '' AND regexp_replace(a.contact_no,'\D','','g') = regexp_replace(c.phone,'\D','','g'))
    OR lower(trim(a.client_company)) = lower(trim(c.company))
    OR lower(trim(a.client_name)) = lower(trim(c.contact_name))
    OR lower(trim(a.client_name)) = lower(trim(c.company))
  );