ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS special_instruction_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz;