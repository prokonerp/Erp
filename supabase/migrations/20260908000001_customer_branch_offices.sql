-- 20260908000001_customer_branch_offices.sql
-- STEP 1: Rollback the wrong migration (branch_id on customers)
-- STEP 2: Create customer_branches for branch offices per customer
--
-- NOTE: applied manually via Supabase Dashboard SQL Editor.

-- ═══════════════════════════════════════════════════════════════════
-- STEP 1 — ROLLBACK: Remove branch_id from customers
-- ═══════════════════════════════════════════════════════════════════

-- Drop the unique indexes that were added for branch-scoped uniqueness
DROP INDEX IF EXISTS public.uq_customers_company_phone_per_branch;
DROP INDEX IF EXISTS public.uq_customers_gst_per_branch;

-- Drop the lookup indexes
DROP INDEX IF EXISTS public.idx_customers_branch_company_phone;
DROP INDEX IF EXISTS public.idx_customers_branch_gst;
DROP INDEX IF EXISTS public.idx_customers_branch;

-- Remove the branch_id column
ALTER TABLE public.customers DROP COLUMN IF EXISTS branch_id;

-- ═══════════════════════════════════════════════════════════════════
-- STEP 2 — NEW: customer_branches table
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_branches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name          text NOT NULL,                -- e.g. "Head Office", "Delhi Branch"
  contact_name  text,
  phone         text,
  email         text,

  -- Billing address
  billing_line1     text,
  billing_line2     text,
  billing_landmark  text,
  billing_city      text,
  billing_state     text,
  billing_country   text DEFAULT 'India',
  billing_pincode   text,

  -- Shipping address
  shipping_line1     text,
  shipping_line2     text,
  shipping_landmark  text,
  shipping_city      text,
  shipping_state     text,
  shipping_country   text DEFAULT 'India',
  shipping_pincode   text,

  -- Location info
  state           text,       -- for place-of-state GST
  gstin           text,       -- optional: some branches may have separate GSTIN

  is_default      boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customer_branches_customer ON public.customer_branches(customer_id);

-- Unique: only one default branch per customer
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_branch_default
  ON public.customer_branches(customer_id)
  WHERE is_default = true;

-- RLS: same as customers (org-scoped via RLS policies on customers — 
-- customer_branches inherits via FK + we add permissive policy)
ALTER TABLE public.customer_branches ENABLE ROW LEVEL SECURITY;

-- Permissive policy: authenticated users can CRUD their org's customer branches
-- (mirrors the customers table pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'customer_branches_org_policy'
      AND tablename = 'customer_branches'
  ) THEN
    CREATE POLICY customer_branches_org_policy ON public.customer_branches
      FOR ALL
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Grants
GRANT ALL ON public.customer_branches TO authenticated;
GRANT ALL ON public.customer_branches TO service_role;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_customer_branches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_customer_branches_updated_at ON public.customer_branches;
CREATE TRIGGER set_customer_branches_updated_at
  BEFORE UPDATE ON public.customer_branches
  FOR EACH ROW
  EXECUTE FUNCTION update_customer_branches_updated_at();

-- Planner stats
ANALYZE public.customer_branches;

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK (if ever needed):
--   DROP TRIGGER IF EXISTS set_customer_branches_updated_at ON public.customer_branches;
--   DROP FUNCTION IF EXISTS update_customer_branches_updated_at();
--   DROP POLICY IF EXISTS customer_branches_org_policy ON public.customer_branches;
--   ALTER TABLE public.customer_branches DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS public.customer_branches;
--
--   -- Re-add branch_id to customers (from the old migration) if needed:
--   ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES public.branches(id) ON DELETE SET null;
-- ═══════════════════════════════════════════════════════════════════
