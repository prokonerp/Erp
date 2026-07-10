
-- Remove overly permissive storage INSERT policies (rely on stricter permission-checked policies)
DROP POLICY IF EXISTS "Authenticated can upload amc agreements" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload ticket attachments" ON storage.objects;

-- Tighten customers SELECT to permission-gated access
DROP POLICY IF EXISTS "auth view customers" ON public.customers;
CREATE POLICY "customers_read_permission" ON public.customers
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_permission(auth.uid(), 'customers', 'read')
    OR has_permission(auth.uid(), 'sales', 'read')
  );

-- Align ims_transactions UPDATE with other IMS tables (allow ims edit permission)
DROP POLICY IF EXISTS "ims_txn_update" ON public.ims_transactions;
CREATE POLICY "ims_txn_update" ON public.ims_transactions
  FOR UPDATE TO authenticated
  USING (has_permission(auth.uid(), 'ims', 'edit') OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_permission(auth.uid(), 'ims', 'edit') OR has_role(auth.uid(), 'admin'::app_role));
