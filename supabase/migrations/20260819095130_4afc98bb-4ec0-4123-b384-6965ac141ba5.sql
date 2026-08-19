REVOKE EXECUTE ON FUNCTION public.get_assignable_engineers() FROM public;
REVOKE EXECUTE ON FUNCTION public.get_assignable_engineers() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_assignable_engineers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_assignable_engineers() TO service_role;