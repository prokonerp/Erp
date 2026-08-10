ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS oracle_number text
  GENERATED ALWAYS AS ((oracles_data -> 0 ->> 'oracle_no')) STORED;

CREATE INDEX IF NOT EXISTS idx_indents_oracle_number
  ON public.indents (oracle_number);