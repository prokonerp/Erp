DROP POLICY IF EXISTS "view employees" ON public.employees;
CREATE POLICY "view employees" ON public.employees FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_permission(auth.uid(),'employees','read'));

DROP POLICY IF EXISTS "view salary" ON public.salary_records;
CREATE POLICY "view salary" ON public.salary_records FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_permission(auth.uid(),'payroll','read'));