-- Migration: 20260928000001_engineer_location_tracking.sql
-- Engineer on-duty location tracking (ADR-0001): duty sessions, raw pings,
-- live status, daily rollup output, consent log, manager gate overrides.
-- SAFE: additive only, idempotent (IF NOT EXISTS / DROP IF EXISTS +
-- CREATE), zero DROP TABLE/COLUMN, zero DELETE/TRUNCATE, zero UPDATE on
-- existing rows. No backfill. New tables only — existing tables untouched.
-- RLS is fail-closed: no permissive default, helpers-missing skips with
-- NOTICE (same guard as 20260916000003_harden_ticket_verifications_rls).
-- NOTE: timestamp 20260928xxxx chosen because 20260924000001 and
-- 20260927000001 already exist — filenames must sort after the max.
--
-- Rollback: DROP TABLE public.engineer_location_pings;
--   DROP TABLE public.engineer_live_status;
--   DROP TABLE public.engineer_gate_overrides;
--   DROP TABLE public.engineer_daily_movements;
--   DROP TABLE public.engineer_consent_events;
--   DROP TABLE public.engineer_duty_sessions;

-- =====================================================================
-- 1) TABLES (all IF NOT EXISTS)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.engineer_duty_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  end_reason text NULL,
  device_label text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_duty_session_window CHECK (ended_at IS NULL OR ended_at >= started_at)
);
COMMENT ON TABLE public.engineer_duty_sessions IS 'On-duty windows, opened/closed explicitly by the engineer. ADR-0001.';

CREATE TABLE IF NOT EXISTS public.engineer_location_pings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_ping_id uuid NOT NULL UNIQUE,
  employee_id uuid NULL,
  session_id uuid NULL,
  ticket_id uuid NULL,
  lat double precision NOT NULL,
  long double precision NOT NULL,
  accuracy_m double precision NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'heartbeat',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_ping_lat CHECK (lat >= -90 AND lat <= 90),
  CONSTRAINT chk_ping_long CHECK (long >= -180 AND long <= 180),
  CONSTRAINT chk_ping_accuracy CHECK (accuracy_m IS NULL OR accuracy_m >= 0)
);
COMMENT ON TABLE public.engineer_location_pings IS 'Raw duty fixes, 30-day TTL (see retention migration). ticket_id is intentionally FK-free to avoid cross-module coupling; validated at the fn layer.';

CREATE TABLE IF NOT EXISTS public.engineer_live_status (
  employee_id uuid PRIMARY KEY,
  on_duty boolean NOT NULL DEFAULT false,
  last_lat double precision NULL,
  last_long double precision NULL,
  last_accuracy_m double precision NULL,
  last_seen_at timestamptz NULL,
  session_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.engineer_live_status IS 'One row per engineer: latest on-duty fix. Realtime source for the admin roster. Never render a live dot from this — always "last seen X ago".';

CREATE TABLE IF NOT EXISTS public.engineer_daily_movements (
  employee_id uuid NOT NULL,
  day date NOT NULL,
  distance_m double precision NULL,
  stop_count integer NULL,
  sites jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_version integer NOT NULL DEFAULT 1,
  rolled_up_at timestamptz NULL,
  PRIMARY KEY (employee_id, day)
);
COMMENT ON TABLE public.engineer_daily_movements IS 'Permanent per-day rollup (IST days). Written by rollup_engineer_day(); never by clients.';

CREATE TABLE IF NOT EXISTS public.engineer_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NULL,
  version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  user_agent text NULL
);
COMMENT ON TABLE public.engineer_consent_events IS 'Immutable BYOD consent log. No update/delete policies by design.';

CREATE TABLE IF NOT EXISTS public.engineer_gate_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  granted_by uuid NULL,
  reason text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_override_window CHECK (expires_at > created_at)
);
COMMENT ON TABLE public.engineer_gate_overrides IS 'Time-boxed manager overrides for the location gate (dead zones). 5-120 min enforced at the fn layer.';

-- =====================================================================
-- 2) FK CONSTRAINTS — NOT VALID skips scan; VALIDATE is non-blocking
--    (same pattern as 20260916000001_engineer_carrier_identity).
-- =====================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_duty_session_employee') THEN
    ALTER TABLE public.engineer_duty_sessions
      ADD CONSTRAINT fk_duty_session_employee
      FOREIGN KEY (employee_id) REFERENCES public.employees(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ping_employee') THEN
    ALTER TABLE public.engineer_location_pings
      ADD CONSTRAINT fk_ping_employee
      FOREIGN KEY (employee_id) REFERENCES public.employees(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ping_session') THEN
    ALTER TABLE public.engineer_location_pings
      ADD CONSTRAINT fk_ping_session
      FOREIGN KEY (session_id) REFERENCES public.engineer_duty_sessions(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_live_employee') THEN
    ALTER TABLE public.engineer_live_status
      ADD CONSTRAINT fk_live_employee
      FOREIGN KEY (employee_id) REFERENCES public.employees(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_live_session') THEN
    ALTER TABLE public.engineer_live_status
      ADD CONSTRAINT fk_live_session
      FOREIGN KEY (session_id) REFERENCES public.engineer_duty_sessions(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_movement_employee') THEN
    ALTER TABLE public.engineer_daily_movements
      ADD CONSTRAINT fk_movement_employee
      FOREIGN KEY (employee_id) REFERENCES public.employees(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_consent_employee') THEN
    ALTER TABLE public.engineer_consent_events
      ADD CONSTRAINT fk_consent_employee
      FOREIGN KEY (employee_id) REFERENCES public.employees(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_override_employee') THEN
    ALTER TABLE public.engineer_gate_overrides
      ADD CONSTRAINT fk_override_employee
      FOREIGN KEY (employee_id) REFERENCES public.employees(id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

ALTER TABLE public.engineer_duty_sessions    VALIDATE CONSTRAINT fk_duty_session_employee;
ALTER TABLE public.engineer_location_pings   VALIDATE CONSTRAINT fk_ping_employee;
ALTER TABLE public.engineer_location_pings   VALIDATE CONSTRAINT fk_ping_session;
ALTER TABLE public.engineer_live_status      VALIDATE CONSTRAINT fk_live_employee;
ALTER TABLE public.engineer_live_status      VALIDATE CONSTRAINT fk_live_session;
ALTER TABLE public.engineer_daily_movements  VALIDATE CONSTRAINT fk_movement_employee;
ALTER TABLE public.engineer_consent_events   VALIDATE CONSTRAINT fk_consent_employee;
ALTER TABLE public.engineer_gate_overrides   VALIDATE CONSTRAINT fk_override_employee;

-- One open session per employee (double-tap / two-tab backstop).
CREATE UNIQUE INDEX IF NOT EXISTS uq_duty_session_open
  ON public.engineer_duty_sessions (employee_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pings_employee_time
  ON public.engineer_location_pings (employee_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_pings_ticket
  ON public.engineer_location_pings (ticket_id)
  WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_overrides_employee_active
  ON public.engineer_gate_overrides (employee_id, expires_at)
  WHERE revoked_at IS NULL;

-- =====================================================================
-- 3) touch_updated_at triggers (function exists per setup_new_supabase).
-- =====================================================================
DROP TRIGGER IF EXISTS trg_touch_duty_session ON public.engineer_duty_sessions;
CREATE TRIGGER trg_touch_duty_session BEFORE UPDATE ON public.engineer_duty_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_live_status ON public.engineer_live_status;
CREATE TRIGGER trg_touch_live_status BEFORE UPDATE ON public.engineer_live_status
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- 4) Realtime: live status streams to the admin roster.
-- =====================================================================
ALTER TABLE public.engineer_live_status REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'engineer_live_status'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.engineer_live_status;
  END IF;
END $$;

-- =====================================================================
-- 5) GRANTS (same shape as 20260922000002_grant_engineer_tables):
--    authenticated gets DML; RLS policies below stay authoritative.
-- =====================================================================
DO $$ BEGIN
  IF to_regclass('public.engineer_duty_sessions') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON public.engineer_duty_sessions TO authenticated;
    GRANT ALL ON public.engineer_duty_sessions TO service_role;
  END IF;
  IF to_regclass('public.engineer_location_pings') IS NOT NULL THEN
    GRANT SELECT, INSERT ON public.engineer_location_pings TO authenticated;
    GRANT ALL ON public.engineer_location_pings TO service_role;
  END IF;
  IF to_regclass('public.engineer_live_status') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE ON public.engineer_live_status TO authenticated;
    GRANT ALL ON public.engineer_live_status TO service_role;
  END IF;
  IF to_regclass('public.engineer_daily_movements') IS NOT NULL THEN
    GRANT SELECT ON public.engineer_daily_movements TO authenticated;
    GRANT ALL ON public.engineer_daily_movements TO service_role;
  END IF;
  IF to_regclass('public.engineer_consent_events') IS NOT NULL THEN
    GRANT SELECT, INSERT ON public.engineer_consent_events TO authenticated;
    GRANT ALL ON public.engineer_consent_events TO service_role;
  END IF;
  IF to_regclass('public.engineer_gate_overrides') IS NOT NULL THEN
    GRANT SELECT ON public.engineer_gate_overrides TO authenticated;
    GRANT ALL ON public.engineer_gate_overrides TO service_role;
  END IF;
END $$;

-- =====================================================================
-- 6) RLS — fail-closed. Own-row for engineers; admin or engineers:read
--    for full visibility; admin-only writes where engineers must not write.
--    If helpers are missing the block skips with NOTICE and RLS (enabled
--    below) denies everything — never default-allow.
-- =====================================================================
ALTER TABLE public.engineer_duty_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineer_location_pings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineer_live_status     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineer_daily_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineer_consent_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engineer_gate_overrides  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_permission') THEN
    RAISE NOTICE 'engineer_location_tracking: helpers missing — RLS enabled with no policies (deny-all)';
    RETURN;
  END IF;

  -- ---- duty sessions: engineer owns own rows; admin/reader sees all ----
  DROP POLICY IF EXISTS "own duty sessions" ON public.engineer_duty_sessions;
  CREATE POLICY "own duty sessions" ON public.engineer_duty_sessions
    FOR ALL TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'engineers', 'read')
    )
    WITH CHECK (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'engineers', 'read')
    );

  -- ---- pings: engineer inserts + reads own; admin/reader reads all ----
  DROP POLICY IF EXISTS "own pings insert" ON public.engineer_location_pings;
  CREATE POLICY "own pings insert" ON public.engineer_location_pings
    FOR INSERT TO authenticated
    WITH CHECK (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
    );
  DROP POLICY IF EXISTS "pings select" ON public.engineer_location_pings;
  CREATE POLICY "pings select" ON public.engineer_location_pings
    FOR SELECT TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'engineers', 'read')
    );

  -- ---- live status: engineer upserts own; admin/reader reads all ----
  DROP POLICY IF EXISTS "own live status" ON public.engineer_live_status;
  CREATE POLICY "own live status" ON public.engineer_live_status
    FOR ALL TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
    )
    WITH CHECK (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
    );
  DROP POLICY IF EXISTS "live status admin read" ON public.engineer_live_status;
  CREATE POLICY "live status admin read" ON public.engineer_live_status
    FOR SELECT TO authenticated
    USING (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'engineers', 'read')
    );

  -- ---- daily movements: rollup-written; engineer reads own, admin reads all ----
  DROP POLICY IF EXISTS "movements select" ON public.engineer_daily_movements;
  CREATE POLICY "movements select" ON public.engineer_daily_movements
    FOR SELECT TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'engineers', 'read')
    );

  -- ---- consent: engineer appends + reads own; admin reads all; immutable ----
  DROP POLICY IF EXISTS "own consent insert" ON public.engineer_consent_events;
  CREATE POLICY "own consent insert" ON public.engineer_consent_events
    FOR INSERT TO authenticated
    WITH CHECK (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
    );
  DROP POLICY IF EXISTS "consent select" ON public.engineer_consent_events;
  CREATE POLICY "consent select" ON public.engineer_consent_events
    FOR SELECT TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_permission(auth.uid(), 'engineers', 'read')
    );

  -- ---- overrides: engineer reads own; admin manages ----
  DROP POLICY IF EXISTS "own override read" ON public.engineer_gate_overrides;
  CREATE POLICY "own override read" ON public.engineer_gate_overrides
    FOR SELECT TO authenticated
    USING (
      employee_id IN (SELECT e.id FROM public.employees e WHERE e.auth_user_id = auth.uid())
    );
  DROP POLICY IF EXISTS "override admin all" ON public.engineer_gate_overrides;
  CREATE POLICY "override admin all" ON public.engineer_gate_overrides
    FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
END $$;
