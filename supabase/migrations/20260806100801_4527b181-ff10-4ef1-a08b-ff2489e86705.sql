ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS monthly_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_increment_date DATE,
  ADD COLUMN IF NOT EXISTS increment_cycle_months INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS exit_date DATE;

CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  code TEXT NOT NULL DEFAULT 'P',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance TO authenticated;
GRANT ALL ON public.attendance TO service_role;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view attendance" ON public.attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins attendance" ON public.attendance FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd attendance" ON public.attendance FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin del attendance" ON public.attendance FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS attendance_emp_date_idx ON public.attendance (employee_id, work_date);
CREATE TRIGGER attendance_touch BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.employee_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  period_year INTEGER,
  period_month INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_advances TO authenticated;
GRANT ALL ON public.employee_advances TO service_role;
ALTER TABLE public.employee_advances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view advances" ON public.employee_advances FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins advances" ON public.employee_advances FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd advances" ON public.employee_advances FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin del advances" ON public.employee_advances FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS advances_emp_period_idx ON public.employee_advances (employee_id, period_year, period_month);
CREATE TRIGGER advances_touch BEFORE UPDATE ON public.employee_advances FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.salary_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  days_in_month INTEGER NOT NULL,
  monthly_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  per_day_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  working_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  total_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  advance NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  approved_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, period_year, period_month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salary_records TO authenticated;
GRANT ALL ON public.salary_records TO service_role;
ALTER TABLE public.salary_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view salary" ON public.salary_records FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin ins salary" ON public.salary_records FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin upd salary" ON public.salary_records FOR UPDATE TO authenticated USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "admin del salary" ON public.salary_records FOR DELETE TO authenticated USING (has_role(auth.uid(),'admin') AND status <> 'paid');
CREATE TRIGGER salary_touch BEFORE UPDATE ON public.salary_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();