CREATE OR REPLACE FUNCTION public.get_assignable_engineers()
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  department text,
  role text,
  active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, phone, department, role, active
  FROM public.employees
  WHERE active = true
  ORDER BY name;
$$;

CREATE OR REPLACE VIEW public.assignable_engineers AS
SELECT id, name, phone, department, role, active
FROM public.get_assignable_engineers();

GRANT SELECT ON public.assignable_engineers TO authenticated;
GRANT ALL ON public.assignable_engineers TO service_role;