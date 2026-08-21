-- ============================================================================
-- Replicate RUNTIME-ONLY schema from the old project (dashboard/Lovable-made)
-- ----------------------------------------------------------------------------
-- Source of truth: src/integrations/supabase/types.ts (generated from the LIVE
-- old database). The following objects exist in the old database but were
-- never captured in any migration:
--   * Tables: customer_sites, lead_assignments, notifications
--   * Columns: leads (7), customers (7), serials (2), ims_txn_sequence (1),
--     ims_transfer_sequence (1)
-- All statements are idempotent so this migration is safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Runtime columns on existing tables
-- ---------------------------------------------------------------------------

-- leads: assignment + acknowledgement workflow (used by useLeadAssignment.ts,
-- CRM list, and the RLS policy "lead act select owner assignee or admin")
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by uuid,
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS assignment_status text;

-- customers: GST / billing enrichment
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS contacts jsonb,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS dup_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gst_status text NOT NULL DEFAULT 'Unregistered',
  ADD COLUMN IF NOT EXISTS street text;

-- serials: site tracking + warranty override
ALTER TABLE public.serials
  ADD COLUMN IF NOT EXISTS site_id uuid,
  ADD COLUMN IF NOT EXISTS warranty_override boolean NOT NULL DEFAULT false;

-- sequence helpers gained a last_seq column at runtime
ALTER TABLE public.ims_txn_sequence
  ADD COLUMN IF NOT EXISTS last_seq bigint;

ALTER TABLE public.ims_transfer_sequence
  ADD COLUMN IF NOT EXISTS last_seq bigint;

-- ---------------------------------------------------------------------------
-- 2. customer_sites (runtime-created table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  site_name text NOT NULL,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_sites_customer ON public.customer_sites(customer_id);

CREATE TRIGGER trg_customer_sites_updated_at
  BEFORE UPDATE ON public.customer_sites
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_sites TO authenticated;
GRANT ALL ON public.customer_sites TO service_role;

ALTER TABLE public.customer_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cs_select_authenticated" ON public.customer_sites
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "cs_insert_authenticated" ON public.customer_sites
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cs_update_authenticated" ON public.customer_sites
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "cs_delete_authenticated" ON public.customer_sites
  FOR DELETE TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 3. lead_assignments (runtime-created table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  assigned_to uuid NOT NULL,
  assigned_by uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledged_by_name text,
  acknowledgement_status text NOT NULL DEFAULT 'pending',
  acknowledgement_device text,
  acknowledgement_ip text,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_assignments_lead ON public.lead_assignments(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_assignments_current ON public.lead_assignments(lead_id, is_current);

CREATE TRIGGER trg_lead_assignments_updated_at
  BEFORE UPDATE ON public.lead_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_assignments TO authenticated;
GRANT ALL ON public.lead_assignments TO service_role;

ALTER TABLE public.lead_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "la_select_authenticated" ON public.lead_assignments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "la_insert_authenticated" ON public.lead_assignments
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "la_update_authenticated" ON public.lead_assignments
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "la_delete_authenticated" ON public.lead_assignments
  FOR DELETE TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- 4. notifications (runtime-created table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text,
  entity_type text,
  entity_id uuid,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, read_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select_authenticated" ON public.notifications
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "notif_insert_authenticated" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notif_update_authenticated" ON public.notifications
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "notif_delete_authenticated" ON public.notifications
  FOR DELETE TO authenticated USING (true);