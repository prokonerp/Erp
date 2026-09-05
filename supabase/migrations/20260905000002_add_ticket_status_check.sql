-- 20260905000002_add_ticket_status_check.sql
-- Enforce ticket status enum at DB level (mirrors TICKET_STATUSES in src/lib/tickets.ts)

DO $$
BEGIN
  -- Drop existing check if present (name may vary)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tickets_status_check' AND conrelid = 'public.tickets'::regclass
  ) THEN
    ALTER TABLE public.tickets DROP CONSTRAINT tickets_status_check;
  END IF;
END $$;

ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('New','Call Log','In Progress','Under Observation','Waiting for Parts','Parts Received','Cancelled','Closed'));

-- Backfill any legacy invalid statuses to 'New' before constraint (safe no-op if clean)
-- UPDATE public.tickets SET status='New' WHERE status NOT IN ('New','Call Log','In Progress','Under Observation','Waiting for Parts','Parts Received','Cancelled','Closed');
