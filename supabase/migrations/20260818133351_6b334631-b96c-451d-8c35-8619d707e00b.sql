INSERT INTO public.app_modules (key, label, sort_order, supports_import, is_active)
VALUES ('accounts', 'Accounts', 90, false, true)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS "view advances" ON public.employee_advances;
CREATE POLICY "employee_advances_read_permission" ON public.employee_advances
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'payroll'::text, 'read'::text));

DROP POLICY IF EXISTS "view ledger" ON public.accounts_ledger;
CREATE POLICY "accounts_ledger_read_permission" ON public.accounts_ledger
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'accounts'::text, 'read'::text));

DROP POLICY IF EXISTS "payments_read" ON public.payments_received;
CREATE POLICY "payments_received_read_permission" ON public.payments_received
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'sales'::text, 'read'::text) OR has_permission(auth.uid(), 'accounts'::text, 'read'::text));

DROP POLICY IF EXISTS "payment_allocations_read_auth" ON public.payment_allocations;
CREATE POLICY "payment_allocations_read_permission" ON public.payment_allocations
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'sales'::text, 'read'::text) OR has_permission(auth.uid(), 'accounts'::text, 'read'::text));

DROP POLICY IF EXISTS "advance_payments_select" ON public.advance_payments;
CREATE POLICY "advance_payments_read_permission" ON public.advance_payments
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'sales'::text, 'read'::text) OR has_permission(auth.uid(), 'accounts'::text, 'read'::text));

DROP POLICY IF EXISTS "invoices_read" ON public.invoices;
CREATE POLICY "invoices_read_permission" ON public.invoices
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'sales'::text, 'read'::text));

DROP POLICY IF EXISTS "view attendance" ON public.attendance;
CREATE POLICY "attendance_read_permission" ON public.attendance
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'payroll'::text, 'read'::text));

DROP POLICY IF EXISTS "view vendors" ON public.vendors;
CREATE POLICY "vendors_read_permission" ON public.vendors
FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_permission(auth.uid(), 'po'::text, 'read'::text));