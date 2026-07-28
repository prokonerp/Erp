-- 1. Assignment history table
CREATE TABLE IF NOT EXISTS public.lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  acknowledgement_status text NOT NULL DEFAULT 'pending',
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledged_by_name text,
  acknowledgement_ip text,
  acknowledgement_device text,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_assignments_ack_status_check CHECK (acknowledgement_status IN ('pending','acknowledged'))
);

GRANT SELECT ON public.lead_assignments TO authenticated;
GRANT ALL ON public.lead_assignments TO service_role;
ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_assignments_select_related" ON public.lead_assignments
  FOR SELECT TO authenticated
  USING (
    assigned_to = auth.uid()
    OR assigned_by = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.owner_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS lead_assignments_pending_idx ON public.lead_assignments(assigned_to, acknowledgement_status) WHERE acknowledgement_status = 'pending';
CREATE INDEX IF NOT EXISTS lead_assignments_lead_idx ON public.lead_assignments(lead_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS lead_assignments_assigned_at_idx ON public.lead_assignments(assigned_at DESC);
CREATE INDEX IF NOT EXISTS leads_assigned_to_idx ON public.leads(assigned_to);

DROP TRIGGER IF EXISTS trg_lead_assignments_touch ON public.lead_assignments;
CREATE TRIGGER trg_lead_assignments_touch BEFORE UPDATE ON public.lead_assignments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Denormalised columns on leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS assignment_status text,
  ADD COLUMN IF NOT EXISTS acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid;

CREATE INDEX IF NOT EXISTS leads_assignment_status_idx ON public.leads(assignment_status);

-- 3. Create history row + reset acknowledgement on (re)assignment
CREATE OR REPLACE FUNCTION public.lead_assignment_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND NEW.assigned_to IS DISTINCT FROM COALESCE(OLD.assigned_to, '00000000-0000-0000-0000-000000000000'::uuid) THEN
    UPDATE public.lead_assignments SET is_current = false
      WHERE lead_id = NEW.id AND is_current;
    INSERT INTO public.lead_assignments(lead_id, assigned_to, assigned_by, assigned_at)
      VALUES (NEW.id, NEW.assigned_to, COALESCE(NEW.assigned_by, auth.uid()), COALESCE(NEW.assigned_at, now()));
    UPDATE public.leads
      SET assignment_status = 'pending_acknowledgement',
          acknowledged = false,
          acknowledged_at = NULL,
          acknowledged_by = NULL
      WHERE id = NEW.id;
  ELSIF NEW.assigned_to IS NULL AND (TG_OP = 'UPDATE' AND OLD.assigned_to IS NOT NULL) THEN
    UPDATE public.lead_assignments SET is_current = false WHERE lead_id = NEW.id AND is_current;
    UPDATE public.leads
      SET assignment_status = NULL, acknowledged = false, acknowledged_at = NULL, acknowledged_by = NULL
      WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_lead_assignment_history ON public.leads;
CREATE TRIGGER trg_lead_assignment_history
  AFTER INSERT OR UPDATE OF assigned_to ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_assignment_history();

-- 4. Backfill existing assignments as pending acknowledgement
INSERT INTO public.lead_assignments(lead_id, assigned_to, assigned_by, assigned_at, is_current)
SELECT l.id, l.assigned_to, l.assigned_by, COALESCE(l.assigned_at, l.updated_at, now()), true
FROM public.leads l
WHERE l.assigned_to IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.lead_assignments a WHERE a.lead_id = l.id);

UPDATE public.leads SET assignment_status = 'pending_acknowledgement'
WHERE assigned_to IS NOT NULL AND assignment_status IS NULL;

-- 5. Pending acknowledgements for the logged-in user
CREATE OR REPLACE FUNCTION public.my_pending_lead_acknowledgements()
RETURNS TABLE(
  assignment_id uuid, lead_id uuid, lead_title text, lead_source text,
  customer_name text, priority text, remarks text,
  assigned_at timestamptz, assigned_by uuid, assigned_by_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, l.id, l.title, l.source,
         c.company, NULL::text, l.remarks,
         a.assigned_at, a.assigned_by,
         COALESCE(au.name, au.email)
  FROM public.lead_assignments a
  JOIN public.leads l ON l.id = a.lead_id
  LEFT JOIN public.customers c ON c.id = l.customer_id
  LEFT JOIN public.app_users au ON au.user_id = a.assigned_by
  WHERE a.assigned_to = auth.uid()
    AND a.acknowledgement_status = 'pending'
    AND a.is_current
  ORDER BY a.assigned_at DESC;
$$;

-- 6. Acknowledge (only the assigned user, only once)
CREATE OR REPLACE FUNCTION public.acknowledge_lead_assignment(
  _assignment_id uuid,
  _device text DEFAULT NULL,
  _ip text DEFAULT NULL
)
RETURNS public.lead_assignments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.lead_assignments;
  _name text;
  _lead public.leads;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO _row FROM public.lead_assignments WHERE id = _assignment_id FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;
  IF _row.assigned_to <> _uid THEN
    RAISE EXCEPTION 'Only the assigned user can acknowledge this lead assignment';
  END IF;
  IF _row.acknowledgement_status = 'acknowledged' THEN
    RAISE EXCEPTION 'This assignment has already been acknowledged';
  END IF;

  SELECT COALESCE(name, email) INTO _name FROM public.app_users WHERE user_id = _uid;

  UPDATE public.lead_assignments
    SET acknowledgement_status = 'acknowledged',
        acknowledged_at = now(),
        acknowledged_by = _uid,
        acknowledged_by_name = _name,
        acknowledgement_device = _device,
        acknowledgement_ip = _ip
    WHERE id = _assignment_id
    RETURNING * INTO _row;

  UPDATE public.leads
    SET assignment_status = 'acknowledged', acknowledged = true,
        acknowledged_at = _row.acknowledged_at, acknowledged_by = _uid
    WHERE id = _row.lead_id
    RETURNING * INTO _lead;

  INSERT INTO public.lead_activities(lead_id, owner_id, kind, notes)
    VALUES (_row.lead_id, _uid, 'note',
            'Lead assignment acknowledged by ' || COALESCE(_name, _uid::text));

  IF _row.assigned_by IS NOT NULL AND _row.assigned_by <> _uid THEN
    INSERT INTO public.notifications(user_id, title, message, entity_type, entity_id, link)
    VALUES (_row.assigned_by, 'Lead Acknowledged',
            COALESCE(_name, 'User') || ' acknowledged lead: ' || COALESCE(_lead.title, ''),
            'lead', _row.lead_id, '/crm/leads/' || _row.lead_id::text);
  END IF;

  RETURN _row;
END $$;

REVOKE ALL ON FUNCTION public.acknowledge_lead_assignment(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.acknowledge_lead_assignment(uuid, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.my_pending_lead_acknowledgements() FROM public;
GRANT EXECUTE ON FUNCTION public.my_pending_lead_acknowledgements() TO authenticated;