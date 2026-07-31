ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS asp_code text,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_warehouses_branch_id ON public.warehouses(branch_id);