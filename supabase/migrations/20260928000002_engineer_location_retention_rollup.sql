-- Migration: 20260928000002_engineer_location_retention_rollup.sql
-- Engineer location rollup + retention (ADR-0001): haversine helper,
-- idempotent per-day rollup over IST calendar days, pg_cron jobs —
-- rollup yesterday 01:00 IST, purge raw pings >30d at 01:30 IST
-- (purge AFTER rollup by design so no day is deleted unrolled).
-- SAFE: additive only, idempotent (CREATE OR REPLACE, guarded cron),
-- zero writes to existing data. New functions only — STD-002 N/A.
--
-- Rollback: SELECT cron.unschedule('engineer-rollup-daily');
--   SELECT cron.unschedule('engineer-pings-purge-daily');
--   DROP FUNCTION public.rollup_engineer_day(date);
--   DROP FUNCTION public.haversine_m(double precision, double precision, double precision, double precision);

-- IST midnight boundaries: p_day is an IST calendar date; the UTC window
-- is [IST midnight, IST midnight + 1d). IST has no DST so this is exact.
CREATE OR REPLACE FUNCTION public.haversine_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
RETURNS double precision
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  ));
$$;

COMMENT ON FUNCTION public.haversine_m(double precision, double precision, double precision, double precision)
  IS 'Great-circle metres between two WGS84 points. ADR-0001 rollup.';

-- Idempotent: re-running a day overwrites it (ON CONFLICT DO UPDATE), so
-- late-arriving pings are picked up by the next run.
CREATE OR REPLACE FUNCTION public.rollup_engineer_day(p_day date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start timestamptz := (p_day::timestamp AT TIME ZONE 'Asia/Kolkata');
  v_end timestamptz := v_start + interval '1 day';
  v_rows integer := 0;
BEGIN
  WITH ordered AS (
    SELECT p.employee_id, p.captured_at, p.lat, p.long, p.accuracy_m,
           lag(p.lat) OVER w AS plat,
           lag(p.long) OVER w AS plong,
           lag(p.accuracy_m) OVER w AS pacc,
           lag(p.captured_at) OVER w AS pt
      FROM public.engineer_location_pings p
     WHERE p.captured_at >= v_start AND p.captured_at < v_end
       AND p.employee_id IS NOT NULL
    WINDOW w AS (PARTITION BY p.employee_id ORDER BY p.captured_at)
  ),
  dist AS (
    SELECT s.employee_id, coalesce(sum(s.seg_m), 0) AS distance_m
      FROM (
        SELECT o.employee_id,
          CASE
            WHEN o.plat IS NOT NULL
             AND (o.accuracy_m IS NULL OR o.accuracy_m <= 150)
             AND (o.pacc IS NULL OR o.pacc <= 150)
             AND EXTRACT(EPOCH FROM (o.captured_at - o.pt)) > 0
             AND public.haversine_m(o.plat, o.plong, o.lat, o.long)
                 / EXTRACT(EPOCH FROM (o.captured_at - o.pt)) <= 55.6
            THEN public.haversine_m(o.plat, o.plong, o.lat, o.long)
            ELSE 0
          END AS seg_m
          FROM ordered o
      ) s
     GROUP BY s.employee_id
  ),
  stops AS (
    SELECT p.employee_id, count(*) AS stop_count
      FROM public.engineer_location_pings p
     WHERE p.captured_at >= v_start AND p.captured_at < v_end
       AND p.employee_id IS NOT NULL AND p.source = 'arrive'
     GROUP BY p.employee_id
  ),
  sites AS (
    SELECT t.employee_id,
           jsonb_agg(
             jsonb_build_object(
               'v', 1,
               'ticket_id', t.ticket_id,
               'arrived_at', t.arrived_at,
               'departed_at', t.departed_at,
               'lat', t.lat,
               'long', t.long
             ) ORDER BY t.arrived_at
           ) AS sites
      FROM (
        SELECT p.employee_id, p.ticket_id,
               COALESCE(MIN(p.captured_at) FILTER (WHERE p.source = 'arrive'),
                        MIN(p.captured_at)) AS arrived_at,
               COALESCE(MAX(p.captured_at) FILTER (WHERE p.source = 'depart'),
                        MAX(p.captured_at)) AS departed_at,
               (ARRAY_AGG(p.lat ORDER BY CASE WHEN p.source = 'arrive' THEN 0 ELSE 1 END,
                          p.captured_at))[1] AS lat,
               (ARRAY_AGG(p.long ORDER BY CASE WHEN p.source = 'arrive' THEN 0 ELSE 1 END,
                          p.captured_at))[1] AS long
          FROM public.engineer_location_pings p
         WHERE p.captured_at >= v_start AND p.captured_at < v_end
           AND p.employee_id IS NOT NULL AND p.ticket_id IS NOT NULL
         GROUP BY p.employee_id, p.ticket_id
      ) t
     GROUP BY t.employee_id
  )
  INSERT INTO public.engineer_daily_movements
    (employee_id, day, distance_m, stop_count, sites, schema_version, rolled_up_at)
  SELECT e.employee_id, p_day,
         COALESCE(d.distance_m, 0),
         COALESCE(s.stop_count, 0),
         COALESCE(t.sites, '[]'::jsonb),
         1, now()
    FROM (
      SELECT DISTINCT p.employee_id
        FROM public.engineer_location_pings p
       WHERE p.captured_at >= v_start AND p.captured_at < v_end
         AND p.employee_id IS NOT NULL
    ) e
    LEFT JOIN dist d USING (employee_id)
    LEFT JOIN stops s USING (employee_id)
    LEFT JOIN sites t USING (employee_id)
  ON CONFLICT (employee_id, day) DO UPDATE SET
    distance_m = EXCLUDED.distance_m,
    stop_count = EXCLUDED.stop_count,
    sites = EXCLUDED.sites,
    schema_version = EXCLUDED.schema_version,
    rolled_up_at = EXCLUDED.rolled_up_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

COMMENT ON FUNCTION public.rollup_engineer_day(date)
  IS 'Idempotent IST-day rollup of engineer pings. Low-accuracy (>150m) and teleport (>200km/h) segments excluded from distance. ADR-0001.';

REVOKE ALL ON FUNCTION public.haversine_m(double precision, double precision, double precision, double precision) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.haversine_m(double precision, double precision, double precision, double precision) TO service_role;
REVOKE ALL ON FUNCTION public.rollup_engineer_day(date) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollup_engineer_day(date) TO service_role;

-- Cron (same guard shape as setup_new_supabase §7): IST = UTC+5:30, no DST.
-- 01:00 IST = 19:30 UTC previous day; 01:30 IST = 20:00 UTC previous day.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('engineer-rollup-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engineer-rollup-daily');
    PERFORM cron.schedule(
      'engineer-rollup-daily',
      '30 19 * * *',
      $cron$ SELECT public.rollup_engineer_day(((now() AT TIME ZONE 'Asia/Kolkata'))::date - 1); $cron$
    );
    PERFORM cron.unschedule('engineer-pings-purge-daily')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'engineer-pings-purge-daily');
    PERFORM cron.schedule(
      'engineer-pings-purge-daily',
      '0 20 * * *',
      $cron$ DELETE FROM public.engineer_location_pings WHERE received_at < now() - interval '30 days'; $cron$
    );
  ELSE
    RAISE NOTICE 'engineer_location_retention: pg_cron missing — rollup/purge not scheduled (run rollup_engineer_day manually)';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
