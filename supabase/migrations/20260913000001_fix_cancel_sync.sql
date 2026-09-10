-- Migration: 20260913000001_fix_cancel_sync.sql
-- Fix cancelled DC/GDC/PI not freeing SO fulfillment (view excludes cancelled conversions, but app only updated target table)
-- SAFE: only triggers + RLS tweak

-- 1) Allow authenticated to mark their SO conversions as cancelled (needed for frontend sync)
--    Existing policy so_conversions_update requires creator/admin; broaden for cancel case
DROP POLICY IF EXISTS "so_conversions_cancel_sync" ON public.so_conversions;
CREATE POLICY "so_conversions_cancel_sync" ON public.so_conversions
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (status = 'cancelled');

-- 2) Trigger function: when a target doc is cancelled, mark linked so_conversions as cancelled
--    Case-insensitive (DC/GDC use 'Cancelled', PI/Invoice use 'cancelled') — SAFE, no data loss
CREATE OR REPLACE FUNCTION public.sync_so_conversion_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND lower(NEW.status) = 'cancelled' AND lower(COALESCE(OLD.status,'')) <> 'cancelled' THEN
    -- Via target_table/target_id link (primary)
    UPDATE public.so_conversions
    SET status = 'cancelled', updated_at = now()
    WHERE target_table = TG_TABLE_NAME
      AND target_id = NEW.id
      AND lower(status) <> 'cancelled';

    -- Via conversion_id FK (defensive, covers cases where target link not yet set)
    IF TG_TABLE_NAME = 'delivery_challans' AND NEW.conversion_id IS NOT NULL THEN
      UPDATE public.so_conversions SET status='cancelled', updated_at=now() WHERE id = NEW.conversion_id AND lower(status) <> 'cancelled';
    ELSIF TG_TABLE_NAME = 'general_delivery_challans' AND NEW.conversion_id IS NOT NULL THEN
      UPDATE public.so_conversions SET status='cancelled', updated_at=now() WHERE id = NEW.conversion_id AND lower(status) <> 'cancelled';
    ELSIF TG_TABLE_NAME = 'proforma_invoices' AND NEW.conversion_id IS NOT NULL THEN
      UPDATE public.so_conversions SET status='cancelled', updated_at=now() WHERE id = NEW.conversion_id AND lower(status) <> 'cancelled';
    ELSIF TG_TABLE_NAME = 'invoices' AND NEW.conversion_id IS NOT NULL THEN
      UPDATE public.so_conversions SET status='cancelled', updated_at=now() WHERE id = NEW.conversion_id AND lower(status) <> 'cancelled';
    END IF;
    -- Also handle invoices via target_table link (when invoice is SO-linked)
    IF TG_TABLE_NAME = 'invoices' THEN
      UPDATE public.so_conversions SET status='cancelled', updated_at=now()
      WHERE target_table='invoices' AND target_id=NEW.id AND lower(status) <> 'cancelled';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_dc_cancel ON public.delivery_challans;
CREATE TRIGGER trg_sync_dc_cancel
AFTER UPDATE OF status ON public.delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.sync_so_conversion_on_cancel();

DROP TRIGGER IF EXISTS trg_sync_gdc_cancel ON public.general_delivery_challans;
CREATE TRIGGER trg_sync_gdc_cancel
AFTER UPDATE OF status ON public.general_delivery_challans
FOR EACH ROW EXECUTE FUNCTION public.sync_so_conversion_on_cancel();

DROP TRIGGER IF EXISTS trg_sync_pi_cancel ON public.proforma_invoices;
CREATE TRIGGER trg_sync_pi_cancel
AFTER UPDATE OF status ON public.proforma_invoices
FOR EACH ROW EXECUTE FUNCTION public.sync_so_conversion_on_cancel();

DROP TRIGGER IF EXISTS trg_sync_invoice_cancel ON public.invoices;
CREATE TRIGGER trg_sync_invoice_cancel
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.sync_so_conversion_on_cancel();

-- 3) No global backfill — scoped fix per SO is applied manually via SQL Editor (see PHS/SO/26-27/0003 patch)
--    Keeping migration narrow-borders: only triggers + cancel-sync policy. Historic global sync intentionally omitted
--    per request to target only the particular SO (428214bb-59e3-4404-8b88-a97bf2b47451).
