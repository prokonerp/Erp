
CREATE TABLE public.charger_ah_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charger_current numeric NOT NULL UNIQUE,
  max_battery_ah numeric NOT NULL,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.charger_ah_limits TO authenticated;
GRANT ALL ON public.charger_ah_limits TO service_role;
ALTER TABLE public.charger_ah_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read charger limits" ON public.charger_ah_limits FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin manage charger limits" ON public.charger_ah_limits FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER charger_ah_limits_touch BEFORE UPDATE ON public.charger_ah_limits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
