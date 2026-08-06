ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS work_hours numeric,
  ADD COLUMN IF NOT EXISTS day_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_sunday boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

UPDATE public.attendance
SET day_value = CASE code WHEN 'P' THEN 1 WHEN 'H' THEN 0.5 ELSE 0 END,
    is_sunday = (EXTRACT(DOW FROM work_date) = 0)
WHERE day_value = 0;

CREATE TABLE IF NOT EXISTS public.attendance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  action text NOT NULL,
  old_code text,
  old_hours numeric,
  old_day_value numeric,
  new_code text,
  new_hours numeric,
  new_day_value numeric,
  changed_by uuid,
  changed_by_email text,
  undone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_audit_batch_idx ON public.attendance_audit(batch_id);
CREATE INDEX IF NOT EXISTS attendance_audit_date_idx ON public.attendance_audit(work_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_audit TO authenticated;
GRANT ALL ON public.attendance_audit TO service_role;
ALTER TABLE public.attendance_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_audit_select" ON public.attendance_audit FOR SELECT TO authenticated USING (true);
CREATE POLICY "attendance_audit_insert" ON public.attendance_audit FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "attendance_audit_update" ON public.attendance_audit FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "attendance_audit_delete" ON public.attendance_audit FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.attendance_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year int NOT NULL,
  period_month int NOT NULL,
  locked boolean NOT NULL DEFAULT true,
  locked_by uuid,
  locked_by_email text,
  locked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_year, period_month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendance_locks TO authenticated;
GRANT ALL ON public.attendance_locks TO service_role;
ALTER TABLE public.attendance_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_locks_select" ON public.attendance_locks FOR SELECT TO authenticated USING (true);
CREATE POLICY "attendance_locks_insert" ON public.attendance_locks FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "attendance_locks_update" ON public.attendance_locks FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "attendance_locks_delete" ON public.attendance_locks FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER attendance_locks_touch BEFORE UPDATE ON public.attendance_locks
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();