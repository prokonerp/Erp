
-- 1. Columns
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

ALTER TABLE public.indents
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

ALTER TABLE public.amcs
  ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Backfill tickets
UPDATE public.tickets SET is_deleted = true WHERE deleted_at IS NOT NULL AND is_deleted = false;

-- 2. Indexes for dashboard counts
CREATE INDEX IF NOT EXISTS idx_tickets_active ON public.tickets (created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_indents_active ON public.indents (created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_amcs_active    ON public.amcs    (end_date)        WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_tickets_archived ON public.tickets (deleted_at) WHERE is_deleted = true;
CREATE INDEX IF NOT EXISTS idx_indents_archived ON public.indents (deleted_at) WHERE is_deleted = true;
CREATE INDEX IF NOT EXISTS idx_amcs_archived    ON public.amcs    (deleted_at) WHERE is_deleted = true;

-- 3. Update SELECT policies to hide soft-deleted from non-admin users
DROP POLICY IF EXISTS "auth view tickets" ON public.tickets;
CREATE POLICY "auth view tickets" ON public.tickets FOR SELECT
  USING (auth.uid() IS NOT NULL AND (is_deleted = false OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "auth view indents" ON public.indents;
CREATE POLICY "auth view indents" ON public.indents FOR SELECT
  USING (auth.uid() IS NOT NULL AND (is_deleted = false OR public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "Authenticated can view amcs" ON public.amcs;
CREATE POLICY "Authenticated can view amcs" ON public.amcs FOR SELECT
  USING (auth.uid() IS NOT NULL AND (is_deleted = false OR public.has_role(auth.uid(),'admin')));

-- 4. Restrict hard DELETE to admins only (soft delete from app is an UPDATE; admin Archive purge uses service role)
DROP POLICY IF EXISTS "Creator or admin delete tickets" ON public.tickets;
CREATE POLICY "Admin only hard delete tickets" ON public.tickets FOR DELETE
  USING (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Creator or admin delete indents" ON public.indents;
CREATE POLICY "Admin only hard delete indents" ON public.indents FOR DELETE
  USING (public.has_role(auth.uid(),'admin'));

-- amcs had no explicit delete policy; add admin-only
DROP POLICY IF EXISTS "Admin only hard delete amcs" ON public.amcs;
CREATE POLICY "Admin only hard delete amcs" ON public.amcs FOR DELETE
  USING (public.has_role(auth.uid(),'admin'));

-- 5. Enable realtime
ALTER TABLE public.tickets REPLICA IDENTITY FULL;
ALTER TABLE public.indents REPLICA IDENTITY FULL;
ALTER TABLE public.amcs    REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.indents; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.amcs;    EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 6. Cleanup function — hard-deletes anything soft-deleted >30 days ago
CREATE OR REPLACE FUNCTION public.purge_archived_records()
RETURNS TABLE(tickets_deleted int, indents_deleted int, amcs_deleted int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE t int := 0; i int := 0; a int := 0;
BEGIN
  WITH d AS (DELETE FROM public.indents WHERE is_deleted = true AND deleted_at < now() - interval '30 days' RETURNING 1)
    SELECT count(*) INTO i FROM d;
  WITH d AS (DELETE FROM public.amcs    WHERE is_deleted = true AND deleted_at < now() - interval '30 days' RETURNING 1)
    SELECT count(*) INTO a FROM d;
  WITH d AS (DELETE FROM public.tickets WHERE is_deleted = true AND deleted_at < now() - interval '30 days' RETURNING 1)
    SELECT count(*) INTO t FROM d;
  RETURN QUERY SELECT t, i, a;
END $$;

REVOKE ALL ON FUNCTION public.purge_archived_records() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_archived_records() TO service_role;

-- 7. Schedule daily purge at 02:00 IST (20:30 UTC)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-archived-records-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-archived-records-daily');
    PERFORM cron.schedule(
      'purge-archived-records-daily',
      '30 20 * * *',
      $cron$ SELECT public.purge_archived_records(); $cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
