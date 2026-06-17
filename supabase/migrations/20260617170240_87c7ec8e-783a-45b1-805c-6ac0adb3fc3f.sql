ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS defective_parts_received boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS defective_parts_details jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS good_parts_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS good_parts_details jsonb NOT NULL DEFAULT '[]'::jsonb;