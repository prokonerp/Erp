-- Fix IMS stock insert RLS — same pattern as customers fix (20260830000000)
-- Problem: ims_stock_items INSERT requires has_permission('ims','create')
-- but default User role has can_create=false for IMS. This silently blocks
-- stock entry creation (Supabase returns null data, not an error).
-- Fix: Relax INSERT to allow any authenticated user (matching the original
-- setup_new_supabase.sql intent before harden migration).

-- 1) ims_stock_items: relax INSERT to permissive
DROP POLICY IF EXISTS "ims_stock_insert" ON public.ims_stock_items;
CREATE POLICY "ims_stock_insert" ON public.ims_stock_items
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 2) ims_transactions: relax INSERT to permissive (needed by createStock
--    to write the transaction record alongside the stock item)
DROP POLICY IF EXISTS "ims_txn_insert" ON public.ims_transactions;
CREATE POLICY "ims_txn_insert" ON public.ims_transactions
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Note: SELECT/UPDATE/DELETE policies are LEFT UNCHANGED.
-- SELECT still requires has_permission('ims','read') — read access is still gated.
-- UPDATE still requires has_permission('ims','edit') — edit access is still gated.
-- DELETE is admin-only — still gated.
-- Only INSERT is relaxed so field staff can add stock entries.
