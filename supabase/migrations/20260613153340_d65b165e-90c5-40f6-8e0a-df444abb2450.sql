
DROP POLICY IF EXISTS "view app_users" ON public.app_users;
CREATE POLICY "users view own app_user row" ON public.app_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth ins rules" ON public.incentive_rules;
DROP POLICY IF EXISTS "auth upd rules" ON public.incentive_rules;
DROP POLICY IF EXISTS "auth del rules" ON public.incentive_rules;
CREATE POLICY "admin ins rules" ON public.incentive_rules
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin upd rules" ON public.incentive_rules
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin del rules" ON public.incentive_rules
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated insert settings" ON public.amc_settings;
DROP POLICY IF EXISTS "Authenticated update settings" ON public.amc_settings;
CREATE POLICY "Admin insert amc_settings" ON public.amc_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin update amc_settings" ON public.amc_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth ins crms" ON public.crm_settings;
DROP POLICY IF EXISTS "auth upd crms" ON public.crm_settings;
CREATE POLICY "admin ins crm_settings" ON public.crm_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin upd crm_settings" ON public.crm_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated can insert gatepasses" ON public.gatepasses;
DROP POLICY IF EXISTS "Authenticated can update gatepasses" ON public.gatepasses;
CREATE POLICY "Authenticated insert own gatepass" ON public.gatepasses
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Owner or admin update gatepass" ON public.gatepasses
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin delete gatepass" ON public.gatepasses
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated delete pm_visits" ON public.pm_visits;
CREATE POLICY "Admin delete pm_visits" ON public.pm_visits
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth update tact" ON public.ticket_activities;
DROP POLICY IF EXISTS "auth delete tact" ON public.ticket_activities;
CREATE POLICY "Actor or admin update tact" ON public.ticket_activities
  FOR UPDATE TO authenticated
  USING (actor = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (actor = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Actor or admin delete tact" ON public.ticket_activities
  FOR DELETE TO authenticated
  USING (actor = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "auth delete tickets" ON public.tickets;
CREATE POLICY "Creator or admin delete tickets" ON public.tickets
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Anon can read own ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Public can upload ticket attachments" ON storage.objects;
CREATE POLICY "Authenticated upload ticket attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ticket-attachments');

ALTER FUNCTION public.set_challan_no() SET search_path = public;
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
