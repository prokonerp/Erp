ALTER TABLE public.employee_advances
  ADD COLUMN IF NOT EXISTS paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_installments integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.advance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id uuid NOT NULL REFERENCES public.employee_advances(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  period_year integer NOT NULL,
  period_month integer NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  kind text NOT NULL DEFAULT 'emi',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (advance_id, period_year, period_month)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advance_payments TO authenticated;
GRANT ALL ON public.advance_payments TO service_role;

ALTER TABLE public.advance_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advance_payments_select" ON public.advance_payments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "advance_payments_insert" ON public.advance_payments
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "advance_payments_update" ON public.advance_payments
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "advance_payments_delete" ON public.advance_payments
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER advance_payments_touch BEFORE UPDATE ON public.advance_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();