
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS special_instruction text;
ALTER TABLE public.ticket_activities ADD COLUMN IF NOT EXISTS special_instruction boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_tact_special ON public.ticket_activities (ticket_id) WHERE special_instruction;
