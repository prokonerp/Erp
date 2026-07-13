
ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS code TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS pin_code TEXT,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.delivery_challans ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);
ALTER TABLE public.grns ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);
ALTER TABLE public.gatepasses ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES public.branches(id);

CREATE INDEX IF NOT EXISTS idx_delivery_challans_branch ON public.delivery_challans(branch_id);
CREATE INDEX IF NOT EXISTS idx_grns_branch ON public.grns(branch_id);
CREATE INDEX IF NOT EXISTS idx_gatepasses_branch ON public.gatepasses(branch_id);
CREATE INDEX IF NOT EXISTS idx_branches_company ON public.branches(company_id);
