
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS last_login timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity timestamptz,
  ADD COLUMN IF NOT EXISTS last_logout timestamptz,
  ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.record_user_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.app_users
     SET last_login = now(),
         last_activity = now(),
         login_count = COALESCE(login_count,0) + 1
   WHERE user_id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.record_user_activity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.app_users
     SET last_activity = now()
   WHERE user_id = auth.uid();
END $$;

CREATE OR REPLACE FUNCTION public.record_user_logout()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  UPDATE public.app_users
     SET last_logout = now()
   WHERE user_id = auth.uid();
END $$;

GRANT EXECUTE ON FUNCTION public.record_user_login()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_activity() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_logout()   TO authenticated;
