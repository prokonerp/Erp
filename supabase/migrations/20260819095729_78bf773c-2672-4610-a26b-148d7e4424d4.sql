REVOKE EXECUTE ON FUNCTION public.sync_assignable_employee() FROM public;
REVOKE EXECUTE ON FUNCTION public.sync_assignable_employee() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_assignable_employee() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_assignable_employee() TO postgres;
GRANT EXECUTE ON FUNCTION public.sync_assignable_employee() TO service_role;