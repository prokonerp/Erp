-- Permissive RLS policies for ticket verification tables
-- Mirrors the pattern from setup_new_supabase.sql for tickets / ticket_activities

CREATE POLICY "auth view tcv" ON public.ticket_customer_verifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert tcv" ON public.ticket_customer_verifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update tcv" ON public.ticket_customer_verifications FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete tcv" ON public.ticket_customer_verifications FOR DELETE TO authenticated USING (true);

CREATE POLICY "auth view tev" ON public.ticket_equipment_verifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert tev" ON public.ticket_equipment_verifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update tev" ON public.ticket_equipment_verifications FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth delete tev" ON public.ticket_equipment_verifications FOR DELETE TO authenticated USING (true);
