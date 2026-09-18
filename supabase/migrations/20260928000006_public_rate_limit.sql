-- Migration: 20260928000006_public_rate_limit.sql
-- Durable Postgres-backed sliding-window limiter for the public
-- (unauthenticated) raise-ticket endpoints.
--
-- Why: src/lib/public-rate-limit.ts keeps counts in a per-instance Map, so
-- on Vercel each cold start / instance resets the throttle. This table +
-- RPC is the shared counter; the TS wrapper (checkRateLimitDurable) prefers
-- the RPC and falls back to the in-memory check when it is unreachable, so
-- a DB outage degrades to a softer limit rather than an open gate.
--
-- SAFE: additive only, idempotent (IF NOT EXISTS / CREATE OR REPLACE),
-- zero writes to existing data. New table + function only.
--
-- Rollback: DROP FUNCTION public.check_public_rate_limit(text, integer, integer);
--   DROP TABLE public.public_rate_limit_hits;

-- =====================================================================
-- 1) Hit log (one row per allowed hit; pruned per-key on every call,
--    plus a 1-day global TTL so abandoned keys cannot grow the table).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.public_rate_limit_hits (
  bucket_key text NOT NULL,
  hit_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.public_rate_limit_hits IS
  'Durable per-IP hit log for public throttles (challenge/submit/staged-upload). Written only via check_public_rate_limit().';

CREATE INDEX IF NOT EXISTS idx_public_rate_limit_key_time
  ON public.public_rate_limit_hits (bucket_key, hit_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_rate_limit_ttl
  ON public.public_rate_limit_hits (hit_at);

-- Fail-closed: RLS on with NO policies (deny-all for anon/authenticated);
-- only service_role touches the table (bypasses RLS).
ALTER TABLE public.public_rate_limit_hits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF to_regclass('public.public_rate_limit_hits') IS NOT NULL THEN
    GRANT ALL ON public.public_rate_limit_hits TO service_role;
  END IF;
END $$;

-- =====================================================================
-- 2) Sliding-window check-and-record RPC (service_role-only).
--    Returns jsonb { allowed: bool, retry_after_ms: int }.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.check_public_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_max integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window interval := make_interval(secs => GREATEST(p_window_seconds, 1));
  v_cutoff timestamptz := now() - v_window;
  v_count integer;
  v_oldest timestamptz;
BEGIN
  -- Prune this bucket to the live window (indexed range delete).
  DELETE FROM public.public_rate_limit_hits
   WHERE bucket_key = p_key AND hit_at <= v_cutoff;
  -- Global TTL for buckets never seen again (windows are minutes-long).
  DELETE FROM public.public_rate_limit_hits
   WHERE hit_at < now() - interval '1 day';

  SELECT count(*), MIN(hit_at) INTO v_count, v_oldest
    FROM public.public_rate_limit_hits
   WHERE bucket_key = p_key AND hit_at > v_cutoff;

  IF v_count >= GREATEST(p_max, 1) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'retry_after_ms', GREATEST(0, EXTRACT(EPOCH FROM (v_oldest + v_window - now()))::bigint * 1000)
    );
  END IF;

  INSERT INTO public.public_rate_limit_hits (bucket_key) VALUES (p_key);
  RETURN jsonb_build_object('allowed', true, 'retry_after_ms', 0);
END $$;

COMMENT ON FUNCTION public.check_public_rate_limit(text, integer, integer)
  IS 'Durable sliding-window limiter for public endpoints. Service-role only; TS wrapper falls back to in-memory on failure.';

REVOKE ALL ON FUNCTION public.check_public_rate_limit(text, integer, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_public_rate_limit(text, integer, integer) TO service_role;
