-- =====================================================================
-- Unified append-only activity log (2026-10-22)
--
-- One forensic feed for corrections, status changes and service-account
-- actions. Existing sinks stay untouched:
--   ims_audit_log            (trigger-fed, 4 IMS tables)
--   document_deletion_audit  (RPC-fed legal deletion/edit record)
-- activity_log is additive and is the cross-module feed.
--
-- Phase 1 scope: table + actor resolver + writer primitives. Module/UI
-- triggers are added in later migrations; this file is safe on its own.
--
-- RUN: supabase db push (DBA runs it; app code never writes DB)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.activity_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  module          text NOT NULL,
  entity          text NOT NULL,
  entity_id       uuid,
  entity_ref      text,
  action          text NOT NULL,
  actor_id        uuid REFERENCES auth.users(id),
  actor_name      text,
  actor_kind      text NOT NULL DEFAULT 'user',
  on_behalf_of    uuid REFERENCES auth.users(id),
  reason          text,
  old_value       jsonb,
  new_value       jsonb,
  changed_fields  text[],
  request_id      text,
  source          text NOT NULL DEFAULT 'trigger',
  severity        text NOT NULL DEFAULT 'info',
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS activity_log_occurred_at_idx
  ON public.activity_log (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS activity_log_entity_idx
  ON public.activity_log (entity, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_actor_idx
  ON public.activity_log (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_module_idx
  ON public.activity_log (module, occurred_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_ref_idx
  ON public.activity_log (entity_ref);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.activity_log'::regclass
      AND conname = 'activity_log_severity_chk'
  ) THEN
    ALTER TABLE public.activity_log
      ADD CONSTRAINT activity_log_severity_chk
      CHECK (severity IN ('info', 'warn', 'critical'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.activity_log'::regclass
      AND conname = 'activity_log_actor_kind_chk'
  ) THEN
    ALTER TABLE public.activity_log
      ADD CONSTRAINT activity_log_actor_kind_chk
      CHECK (actor_kind IN ('user', 'service_account', 'system', 'migration', 'unknown'));
  END IF;
END $$;

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_log_read ON public.activity_log;
CREATE POLICY activity_log_read ON public.activity_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS activity_log_no_client_write ON public.activity_log;
CREATE POLICY activity_log_no_client_write ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (false);

-- No UPDATE/DELETE policy: append-only for clients. SECURITY DEFINER writers
-- bypass RLS; service_role owns maintenance/retention.

GRANT SELECT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

-- ---------------------------------------------------------------------
-- Actor resolution
-- Precedence: explicit RPC arg > transaction GUC app.actor_id >
-- auth.uid() > unknown. A service-account write (service_role, no auth.uid)
-- is visible and countable as actor_kind='service_account', never hidden.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activity_actor()
RETURNS TABLE(actor_id uuid, actor_name text, actor_kind text, on_behalf_of uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_guc   text := NULLIF(current_setting('app.actor_id', true), '');
  v_name  text := NULLIF(current_setting('app.actor_name', true), '');
  v_on    uuid;
  v_kind  text;
  v_on_raw text := NULLIF(current_setting('app.on_behalf_of', true), '');
BEGIN
  IF v_guc IS NOT NULL
     AND v_guc ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_uid := v_guc::uuid;
    v_kind := 'service_account';
  ELSIF v_uid IS NOT NULL THEN
    v_kind := 'user';
  ELSE
    v_kind := 'unknown';
  END IF;

  IF v_name IS NULL AND v_uid IS NOT NULL THEN
    SELECT coalesce(u.email, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', v_uid::text)
      INTO v_name
      FROM auth.users u
     WHERE u.id = v_uid;
  END IF;

  IF v_on_raw IS NOT NULL
     AND v_on_raw ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_on := v_on_raw::uuid;
  END IF;

  RETURN QUERY SELECT v_uid, v_name, v_kind, v_on;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_activity_actor(
  p_actor_id uuid,
  p_actor_name text,
  p_on_behalf_of uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.actor_id', coalesce(p_actor_id::text, ''), true);
  PERFORM set_config('app.actor_name', coalesce(p_actor_name, ''), true);
  PERFORM set_config('app.on_behalf_of', coalesce(p_on_behalf_of::text, ''), true);
END;
$$;

-- ---------------------------------------------------------------------
-- Writer
-- severity='critical' re-raises (audit is part of the transaction contract);
-- info/warn swallow with a warning so routine trigger noise cannot break a
-- business write.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_activity(
  p_module text,
  p_entity text,
  p_entity_id uuid,
  p_action text,
  p_old jsonb DEFAULT NULL,
  p_new jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_entity_ref text DEFAULT NULL,
  p_source text DEFAULT 'rpc',
  p_severity text DEFAULT 'info',
  p_metadata jsonb DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL,
  p_actor_name text DEFAULT NULL,
  p_on_behalf_of uuid DEFAULT NULL,
  p_request_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_actor_name text;
  v_actor_kind text;
  v_on_behalf uuid;
  v_changed text[];
  v_id uuid;
BEGIN
  -- jsonb_object_keys only accepts objects; wrap scalars/arrays as {value:...}.
  IF p_old IS NOT NULL AND jsonb_typeof(p_old) <> 'object' THEN
    p_old := jsonb_build_object('value', p_old);
  END IF;
  IF p_new IS NOT NULL AND jsonb_typeof(p_new) <> 'object' THEN
    p_new := jsonb_build_object('value', p_new);
  END IF;

  SELECT actor_id, actor_name, actor_kind, on_behalf_of
    INTO v_actor_id, v_actor_name, v_actor_kind, v_on_behalf
    FROM public.activity_actor();

  IF p_actor_id IS NOT NULL THEN
    v_actor_id := p_actor_id;
    v_actor_kind := 'service_account';
  END IF;
  IF p_actor_name IS NOT NULL THEN
    v_actor_name := p_actor_name;
  END IF;
  IF p_on_behalf_of IS NOT NULL THEN
    v_on_behalf := p_on_behalf_of;
  END IF;

  SELECT array_agg(key ORDER BY key)
    INTO v_changed
    FROM (
      SELECT jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) AS key
      UNION
      SELECT jsonb_object_keys(coalesce(p_new, '{}'::jsonb)) AS key
    ) k
   WHERE coalesce(p_old->key, 'null'::jsonb)
         IS DISTINCT FROM coalesce(p_new->key, 'null'::jsonb);

  INSERT INTO public.activity_log(
    module, entity, entity_id, entity_ref, action,
    actor_id, actor_name, actor_kind, on_behalf_of,
    reason, old_value, new_value, changed_fields, request_id,
    source, severity, metadata
  ) VALUES (
    p_module, p_entity, p_entity_id, p_entity_ref, p_action,
    v_actor_id, v_actor_name, v_actor_kind, v_on_behalf,
    p_reason, p_old, p_new, v_changed, p_request_id,
    p_source, p_severity, coalesce(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  IF p_severity = 'critical' THEN
    RAISE;
  END IF;
  RAISE WARNING 'log_activity failed for %.% (%): %', p_module, p_entity, p_action, SQLERRM;
  RETURN NULL;
END;
$$;

-- Read-only resolver is safe for authenticated; writer/setter are service-only
-- (a security-definer writer must not be callable by ordinary users).
GRANT EXECUTE ON FUNCTION public.activity_actor() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_activity_actor(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_activity(text, text, uuid, text, jsonb, jsonb, text, text, text, text, jsonb, uuid, text, uuid, text) TO service_role;
