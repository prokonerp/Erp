-- Migration: 20260914000001_so_stock_reversal_robustness.sql
-- Fix DB-level stock reversal on invoice cancellation and SO cancel guard
-- SAFE: idempotent, additive only, no data deletion, CREATE OR REPLACE + DROP IF EXISTS guards
-- Purpose:
--   - Invoices post pooled (non-serial) stock via invoice_item_sync_serials using ims_deduct_qty,
--     but cancellation only released serials via trg_invoice_cancel_release_serials.
--     Pooled qty stayed deducted -> stock leak after invoice cancellation.
--     GDC/DC have proper reversal; invoice did not for pooled -> fix here.
--   - SO cancel guard DB-enforced to block cancellation when non-cancelled delivery docs exist.
-- Depends on: invoices, invoice_items, ims_stock_items, ims_transactions, ims_add_qty, sales_orders, so_conversions
-- Idempotent: safe to re-run

-- =====================================================================
-- 0) Ensure invoice_items has model/name/oem columns for pooled resolver
--    (spec requires COALESCE(ii.part_model_no, ii.part_name, 'Unknown'))
--    If already exist, no-op. Keep additive only.
-- =====================================================================
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS part_model_no TEXT,
  ADD COLUMN IF NOT EXISTS part_name TEXT,
  ADD COLUMN IF NOT EXISTS oem TEXT;

-- Ensure sales_orders has cancelled_* audit columns for JS helper robustness
ALTER TABLE public.sales_orders
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- =====================================================================
-- 1) Invoice pooled stock reversal on cancellation
--    AFTER UPDATE OF status ON invoices WHEN NEW.status='cancelled'
--    For each pooled line (no serials), call ims_add_qty + log good_in
--    Skip if skip_stock_posting=true OR source_general_dc_id IS NOT NULL
-- =====================================================================

CREATE OR REPLACE FUNCTION public.invoice_cancel_restore_pooled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ii RECORD;
  v_model TEXT;
  v_part_name TEXT;
  v_oem TEXT;
  v_qty NUMERIC;
  v_qty_text TEXT;
  v_added_id UUID;
  v_inv_no TEXT;
BEGIN
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    -- Skip if stock was never posted (GDC-sourced invoice)
    IF COALESCE(NEW.skip_stock_posting, false) = true OR NEW.source_general_dc_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_inv_no := COALESCE(NEW.invoice_no, NEW.id::text);

    FOR ii IN SELECT * FROM public.invoice_items WHERE invoice_id = NEW.id LOOP
      -- Only pooled lines: serial_numbers IS NULL or empty
      IF ii.serial_numbers IS NOT NULL AND array_length(ii.serial_numbers, 1) > 0 THEN
        CONTINUE;
      END IF;

      -- Handle both text and numeric qty (qty may be stored as text in edge cases)
      BEGIN
        v_qty_text := btrim(ii.qty::text);
        IF v_qty_text IS NULL OR v_qty_text = '' THEN
          v_qty := 0;
        ELSE
          v_qty := v_qty_text::numeric;
        END IF;
      EXCEPTION WHEN others THEN
        v_qty := 0;
      END;

      IF v_qty IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;

      -- Resolve model via COALESCE(ii.part_model_no, ii.part_name, 'Unknown')
      -- Fallback chain: part_model_no -> part_name -> description -> Unknown
      -- Uses columns ensured above; if product_id present, try product master for richer oem/name
      v_model := COALESCE(
        NULLIF(btrim(COALESCE(ii.part_model_no, '')), ''),
        NULLIF(btrim(COALESCE(ii.part_name, '')), ''),
        NULLIF(btrim(COALESCE(ii.description, '')), ''),
        'Unknown'
      );

      v_part_name := COALESCE(
        NULLIF(btrim(COALESCE(ii.part_name, '')), ''),
        NULLIF(btrim(COALESCE(ii.description, '')), ''),
        v_model
      );

      v_oem := NULLIF(btrim(COALESCE(ii.oem, '')), '');
      IF (v_oem IS NULL OR v_oem = '') AND ii.product_id IS NOT NULL THEN
        BEGIN
          SELECT NULLIF(btrim(COALESCE(p.oem, p.brand, '')), '') INTO v_oem
          FROM public.products p WHERE p.id = ii.product_id;
        EXCEPTION WHEN others THEN
          v_oem := NULL;
        END;
      END IF;
      -- Fallback to invoice buyer snapshot oem? Keep null if unknown
      IF v_oem = '' THEN v_oem := NULL; END IF;

      -- Restore pooled qty back into warehouse pool
      BEGIN
        v_added_id := public.ims_add_qty(
          v_model,
          ii.warehouse_id,
          'good'::public.ims_stock_type,
          v_qty,
          v_part_name,
          v_oem,
          'Invoice ' || v_inv_no
        );
      EXCEPTION WHEN others THEN
        -- Do not block cancellation if stock restore fails; still log transaction
        v_added_id := NULL;
      END;

      -- Log reversal transaction: good_in, reference 'Invoice '||invoice_no
      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        to_warehouse_id, from_party, qty, reference, notes, created_by
      ) VALUES (
        'good_in'::public.ims_txn_type,
        v_added_id,
        v_part_name,
        v_model,
        NULL,
        v_oem,
        ii.warehouse_id,
        COALESCE(NEW.buyer_name, 'Customer'),
        v_qty,
        'Invoice ' || v_inv_no,
        'Reversal: Invoice cancelled',
        NEW.created_by
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

-- Idempotent trigger wiring
DROP TRIGGER IF EXISTS trg_invoice_cancel_restore_pooled ON public.invoices;
CREATE TRIGGER trg_invoice_cancel_restore_pooled
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.invoice_cancel_restore_pooled();

-- =====================================================================
-- 2) SO cancel guard: block cancellation if non-cancelled delivery docs exist
--    BEFORE UPDATE OF status ON sales_orders
-- =====================================================================

CREATE OR REPLACE FUNCTION public.assert_so_cancel_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count BIGINT;
BEGIN
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    SELECT count(*) INTO v_count
    FROM public.so_conversions
    WHERE sales_order_id = NEW.id
      AND status != 'cancelled'
      AND conversion_type IN ('tax_invoice','general_dc','delivery_challan');

    IF v_count > 0 THEN
      RAISE EXCEPTION 'Cannot cancel SO % — % non-cancelled delivery documents exist. Cancel them first.',
        COALESCE(NEW.so_no, NEW.id::text), v_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_so_cancel_guard ON public.sales_orders;
CREATE TRIGGER trg_so_cancel_guard
BEFORE UPDATE OF status ON public.sales_orders
FOR EACH ROW EXECUTE FUNCTION public.assert_so_cancel_block();

-- =====================================================================
-- 3) Grants & analyze (idempotent)
-- =====================================================================
REVOKE ALL ON FUNCTION public.invoice_cancel_restore_pooled() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.invoice_cancel_restore_pooled() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.assert_so_cancel_block() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.assert_so_cancel_block() TO authenticated, service_role;

-- Ensure helper functions remain executable for stock helpers
GRANT EXECUTE ON FUNCTION public.ims_add_qty(text, uuid, public.ims_stock_type, numeric, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ims_deduct_qty(text, uuid, public.ims_stock_type, numeric, text, public.ims_stock_status, text, boolean) TO authenticated, service_role;

ANALYZE public.invoices;
ANALYZE public.invoice_items;
ANALYZE public.sales_orders;
ANALYZE public.so_conversions;

-- Comments for introspection
COMMENT ON FUNCTION public.invoice_cancel_restore_pooled() IS 'Restores pooled (non-serial) stock via ims_add_qty when an invoice is cancelled. Skips GDC-sourced invoices. Complements serial path in trg_invoice_cancel_release_serials.';
COMMENT ON FUNCTION public.assert_so_cancel_block() IS 'Guards SO cancellation: blocks if any non-cancelled stock conversion (tax_invoice/general_dc/delivery_challan) exists. Cancel deliveries first.';

-- Verification helper (not required but useful):
-- SELECT * FROM pg_trigger WHERE tgname IN ('trg_invoice_cancel_restore_pooled','trg_so_cancel_guard');
