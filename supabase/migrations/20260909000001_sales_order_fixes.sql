-- 20260909000001_sales_order_fixes.sql
-- Sales Order module: schema hardening, missing columns, RLS, indexes
-- Part of branch: sales-order-fix
-- SAFE: additive only (ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS)

-- ═══════════════════════════════════════════════════════════════════
-- 1) Missing columns — header charges that were silently dropped
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS shipping_charges numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment      numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_percent     numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_amount      numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_label  text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0;

-- Same for invoices (also lost on round-trip)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS shipping_charges numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment      numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_percent     numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tcs_amount      numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_label  text,
  ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════════
-- 2) Audit: created_by default
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.sales_orders
  ALTER COLUMN created_by SET DEFAULT auth.uid();

-- ═══════════════════════════════════════════════════════════════════
-- 3) Uniqueness constraints — prevent duplicate SO/DC per source
-- ═══════════════════════════════════════════════════════════════════

-- One SO per quotation (partial: ignores NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS uq_so_linked_quote
  ON public.sales_orders (linked_quote_id)
  WHERE linked_quote_id IS NOT NULL;

-- One DC per SO (partial: ignores NULLs) — if 1:1 is the invariant.
-- If you need DC history, change to a non-unique index and keep app-level idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS uq_dc_sales_order
  ON public.delivery_challans (sales_order_id)
  WHERE sales_order_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 4) Performance indexes
-- ═══════════════════════════════════════════════════════════════════

-- Listing by SO date (business order, not created_at)
CREATE INDEX IF NOT EXISTS idx_so_so_date
  ON public.sales_orders (so_date DESC);

-- Listing by created_at (fallback sort)
CREATE INDEX IF NOT EXISTS idx_so_created_at
  ON public.sales_orders (created_at DESC);

-- Trigram indexes for ILIKE %term% search (pg_trgm already loaded)
CREATE INDEX IF NOT EXISTS idx_so_so_no_trgm
  ON public.sales_orders USING gin (so_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_so_buyer_name_trgm
  ON public.sales_orders USING gin (buyer_name gin_trgm_ops);

-- Composite for paginated list (branch isolation + ordering)
CREATE INDEX IF NOT EXISTS idx_so_branch_created
  ON public.sales_orders (branch_id, created_at DESC);

-- linked_dc_ids GIN for invoices.contains query (DC→Invoice idempotency)
CREATE INDEX IF NOT EXISTS idx_inv_linked_dc
  ON public.invoices USING gin (linked_dc_ids);

-- ═══════════════════════════════════════════════════════════════════
-- 5) RLS tightening — SO was wide open for SELECT
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "sales_orders authenticated read" ON public.sales_orders;
CREATE POLICY "sales_orders authenticated read"
  ON public.sales_orders FOR SELECT TO authenticated
  USING (
    has_permission(auth.uid(), 'sales', 'read')
    OR has_permission(auth.uid(), 'quotations', 'read')
  );

DROP POLICY IF EXISTS "sales_orders authenticated insert" ON public.sales_orders;
CREATE POLICY "sales_orders authenticated insert"
  ON public.sales_orders FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- sales_order_settings: tighten SELECT to require sales create/edit.
-- Postgres ORs SELECT policies — MUST also drop the legacy wide-open policy
-- ("so_settings authenticated read") that setup_new_supabase.sql creates,
-- otherwise this tightening is a silent no-op.
DROP POLICY IF EXISTS "so_settings authenticated read"      ON public.sales_order_settings;
DROP POLICY IF EXISTS "sales_order_settings_select_authenticated" ON public.sales_order_settings;
CREATE POLICY "sales_order_settings_select_authenticated"
  ON public.sales_order_settings FOR SELECT TO authenticated
  USING (
    has_permission(auth.uid(), 'sales', 'create')
    OR has_permission(auth.uid(), 'sales', 'edit')
  );

-- ═══════════════════════════════════════════════════════════════════
-- 6) Status CHECK constraint (informational — does not block writes
--    from service_role, but catches app bugs)
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  ALTER TABLE public.sales_orders
    ADD CONSTRAINT chk_so_status
    CHECK (status IN ('draft','confirmed','partial','delivered','invoiced','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════
-- 7) Backfill: set created_by for existing rows with NULL
-- ═══════════════════════════════════════════════════════════════════

-- No backfill needed: new default handles future rows. Existing NULLs are acceptable
-- for historical data created before this migration.

-- ═══════════════════════════════════════════════════════════════════
-- 8) Analyze for planner
-- ═══════════════════════════════════════════════════════════════════

ANALYZE public.sales_orders;
ANALYZE public.invoices;
ANALYZE public.delivery_challans;

-- ═══════════════════════════════════════════════════════════════════
-- 9) set_so_no() — SECURITY DEFINER so the numbering trigger keeps
--    working after the sales_order_settings SELECT tightening above.
--    (Was invoker-rights; the trigger reads+updates sales_order_settings,
--    which would now be RLS-denied for users without sales create/edit.
--    Matches set_quote_no / set_dc_challan_no / set_grn_no which are
--    already SECURITY DEFINER with locked search_path.)
--    Also keeps the atomic advisory-lock reservation from
--    20260829000001 (no read-then-increment race).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_so_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  s public.sales_order_settings%ROWTYPE;
  d DATE := COALESCE(NEW.so_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.so_no IS NOT NULL AND NEW.so_no <> '' THEN RETURN NEW; END IF;

  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  PERFORM pg_advisory_xact_lock(hashtextextended('so_no:' || COALESCE(NEW.branch_id::text, ''), 0));

  SELECT * INTO s FROM public.sales_order_settings WHERE branch_id IS NOT DISTINCT FROM NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.sales_order_settings (branch_id, current_fy, next_seq)
      VALUES (NEW.branch_id, fy, 2)
      ON CONFLICT (branch_id) DO NOTHING;
    SELECT * INTO s FROM public.sales_order_settings WHERE branch_id IS NOT DISTINCT FROM NEW.branch_id;
    seq := 1;
  ELSE
    UPDATE public.sales_order_settings
       SET current_fy = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN fy ELSE current_fy END,
           next_seq   = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN 2
                             ELSE next_seq + 1 END
     WHERE id = s.id
     RETURNING next_seq - CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN 1 ELSE 0 END
       INTO seq;
  END IF;

  new_prefix := COALESCE(s.prefix, 'PHS/SO/');
  NEW.so_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');
  RETURN NEW;
END $function$;
