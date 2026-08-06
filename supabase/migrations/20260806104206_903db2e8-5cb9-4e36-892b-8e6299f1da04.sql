ALTER TABLE public.employee_advances
  ADD COLUMN IF NOT EXISTS emi_months integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS emi_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remaining_months integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS start_year integer,
  ADD COLUMN IF NOT EXISTS start_month integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

UPDATE public.employee_advances
SET emi_months = 1,
    emi_amount = COALESCE(amount, 0),
    remaining_months = 0,
    start_year = COALESCE(start_year, period_year, EXTRACT(YEAR FROM advance_date)::int),
    start_month = COALESCE(start_month, period_month, EXTRACT(MONTH FROM advance_date)::int),
    status = 'closed'
WHERE emi_amount = 0;

ALTER TABLE public.salary_records
  ADD COLUMN IF NOT EXISTS present_days numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_leave_benefit numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_days numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_salary numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emi_deduction numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emi_carry_forward numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS override_paid_days numeric,
  ADD COLUMN IF NOT EXISTS override_emi numeric,
  ADD COLUMN IF NOT EXISTS override_net numeric;