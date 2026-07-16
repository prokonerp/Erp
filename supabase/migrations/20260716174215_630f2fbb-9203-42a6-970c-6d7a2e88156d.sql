
-- 1) Tighten SELECT policies on tickets, amcs, indents
DROP POLICY IF EXISTS "auth view tickets" ON public.tickets;
CREATE POLICY "auth view tickets" ON public.tickets
FOR SELECT USING (
  ((is_deleted = false) OR public.has_role(auth.uid(), 'admin'::app_role))
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'read')
    OR created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "Authenticated can view amcs" ON public.amcs;
CREATE POLICY "Authenticated can view amcs" ON public.amcs
FOR SELECT USING (
  ((is_deleted = false) OR public.has_role(auth.uid(), 'admin'::app_role))
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'amc', 'read')
    OR created_by = auth.uid()
  )
);

DROP POLICY IF EXISTS "auth view indents" ON public.indents;
CREATE POLICY "auth view indents" ON public.indents
FOR SELECT USING (
  ((is_deleted = false) OR public.has_role(auth.uid(), 'admin'::app_role))
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'indent', 'read')
    OR created_by = auth.uid()
  )
);

-- 2) Replace always-true UPDATE/INSERT/DELETE policies with permission-based checks

-- Invoices (sales module)
DROP POLICY IF EXISTS invoices_insert ON public.invoices;
CREATE POLICY invoices_insert ON public.invoices
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'create')
);

DROP POLICY IF EXISTS invoices_update ON public.invoices;
CREATE POLICY invoices_update ON public.invoices
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
);

-- Payments Received (sales module)
DROP POLICY IF EXISTS payments_insert ON public.payments_received;
CREATE POLICY payments_insert ON public.payments_received
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'create')
);

DROP POLICY IF EXISTS payments_update ON public.payments_received;
CREATE POLICY payments_update ON public.payments_received
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
);

-- Purchase Orders (po module)
DROP POLICY IF EXISTS "po insert" ON public.purchase_orders;
CREATE POLICY "po insert" ON public.purchase_orders
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'po', 'create')
);

DROP POLICY IF EXISTS "po update" ON public.purchase_orders;
CREATE POLICY "po update" ON public.purchase_orders
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'po', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'po', 'edit')
);

DROP POLICY IF EXISTS "po delete" ON public.purchase_orders;
CREATE POLICY "po delete" ON public.purchase_orders
FOR DELETE USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'po', 'delete')
);

-- Sales Orders (sales module)
DROP POLICY IF EXISTS "sales_orders authenticated update" ON public.sales_orders;
CREATE POLICY "sales_orders authenticated update" ON public.sales_orders
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
);

DROP POLICY IF EXISTS "sales_orders authenticated delete" ON public.sales_orders;
CREATE POLICY "sales_orders authenticated delete" ON public.sales_orders
FOR DELETE USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'delete')
);

-- Sales Order Settings (sales module)
DROP POLICY IF EXISTS "so_settings authenticated write" ON public.sales_order_settings;
CREATE POLICY "so_settings authenticated write" ON public.sales_order_settings
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'create')
);

DROP POLICY IF EXISTS "so_settings authenticated update" ON public.sales_order_settings;
CREATE POLICY "so_settings authenticated update" ON public.sales_order_settings
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'edit')
);

DROP POLICY IF EXISTS "so_settings authenticated delete" ON public.sales_order_settings;
CREATE POLICY "so_settings authenticated delete" ON public.sales_order_settings
FOR DELETE USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'sales', 'delete')
);

-- Product Bundles (products module)
DROP POLICY IF EXISTS "Authenticated can insert product bundles" ON public.product_bundles;
CREATE POLICY "Authenticated can insert product bundles" ON public.product_bundles
FOR INSERT WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'products', 'create')
);

DROP POLICY IF EXISTS "Authenticated can update product bundles" ON public.product_bundles;
CREATE POLICY "Authenticated can update product bundles" ON public.product_bundles
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'products', 'edit')
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'products', 'edit')
);

DROP POLICY IF EXISTS "Authenticated can delete product bundles" ON public.product_bundles;
CREATE POLICY "Authenticated can delete product bundles" ON public.product_bundles
FOR DELETE USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_permission(auth.uid(), 'products', 'delete')
);

-- 3) Ticket attachments bucket: explicit INSERT policy scoped to Tickets module permission
DROP POLICY IF EXISTS "ticket_attachments staff upload" ON storage.objects;
CREATE POLICY "ticket_attachments staff upload" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_permission(auth.uid(), 'tickets', 'create')
    OR public.has_permission(auth.uid(), 'tickets', 'edit')
  )
);
