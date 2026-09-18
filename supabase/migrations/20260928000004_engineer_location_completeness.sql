-- Migration: 20260928000004_engineer_location_completeness.sql
-- Engineer location completeness (ADR-0001 follow-up): spoof-flag storage,
-- global kill switch, stale-session reaper.
--
-- SAFE: additive only, idempotent (IF NOT EXISTS / guarded DO blocks),
-- zero writes to existing rows. Requires 20260928000001 applied.
--
-- Rollback: SELECT cron.unschedule('engineer-session-reaper');
--   DROP FUNCTION public.reap_stale_duty_sessions();
--   DROP TABLE public.engineer_location_settings;
--   ALTER TABLE public.engineer_location_pings DROP COLUMN spoof_flags;

-- 1) Spoof flags on pings (advisory only — never blocks the engineer).
ALTER TABLE public.engineer_location_pings
  ADD COLUMN IF NOT EXISTS spoof_flags text[] NOT NULL DEFAULT '{}';

-- 2) Global kill switch (single row; all access via service-role server fns).
CREATE TABLE IF NOT EXISTS public.engineer_location_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  tracking_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.engineer_location_settings IS 'Kill switch for duty tracking. When false the gate passes through and duty start/pings refuse with TRACKING_DISABLED. ADR-0001.';
INSERT INTO public.engineer_location_settings (id, tracking_enabled, updated_at)
  VALUES (1, true, now())
  ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_touch_location_settings ON public.engineer_location_settings;
CREATE TRIGGER trg_touch_location_settings BEFORE UPDATE ON public.engineer_location_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.engineer_location_settings ENABLE ROW LEVEL SECURITY;
-- No authenticated policies by design: deny-all direct access.

DO $$ BEGIN
  IF to_regclass('public.engineer_location_settings') IS NOT NULL THEN
    GRANT ALL ON public.engineer_location_settings TO service_role;
  END IF;
END $$;

-- 3) Stale-session reaper: close sessions idle >2h, flip live rows off-duty.
CREATE OR REPLACE FUNCTION public.reap_stale_duty_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff timestamptz := now() - interval '2 hours';
  v_closed integer := 0;
BEGIN
  WITH idle AS (
    SELECT s.id AS session_id, s.employee_id
      FROM public.engineer_duty_sessions s
      LEFT JOIN public.engineer_live_status l
        ON l.employee_id = s.employee_id
     WHERE s.ended_at IS NULL
       AND COALESCE(l.last_seen_at, s.started_at) < v_cutoff
  ),
  closed AS (
    UPDATE public.engineer_duty_sessions s
       SET ended_at = now(), end_reason = 'auto_closed'
      FROM idle
     WHERE s.id = idle.session_id
       AND s.ended_at IS NULL
    RETURNING s.employee_id
  )
  SELECT count(*) INTO v_closed FROM closed;

  UPDATE public.engineer_live_status l
     SET on_duty = false, session_id = null, updated_at = now()
   WHERE l.on_duty = true
     AND NOT EXISTS (
       SELECT 1 FROM public.engineer_duty_sessions s
        WHERE s.employee_id = l.employee_id AND s.ended_at IS NULL
     );
  RETURN v_closed;
END $$;

COMMENT ON FUNCTION public.reap_stale_duty_sessions()
  IS 'Closes duty sessions idle >2h and clears orphaned on-duty flags. ADR-0001.';

REVOKE ALL ON FUNCTION public.reap_stale_duty_sessions() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_stale_duty_sessions() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('engineer-session-reaper')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engineer-session-reaper');
    PERFORM cron.schedule(
      'engineer-session-reaper',
      '*/15 * * * *',
      $cron$ SELECT public.reap_stale_duty_sessions(); $cron$
    );
  ELSE
    RAISE NOTICE 'engineer_location_completeness: pg_cron missing — session reaper not scheduled';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
