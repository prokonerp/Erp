
-- 1. payment_terms on invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_terms TEXT;

-- 2. warehouse_id + serial_numbers on invoice_items
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS serial_numbers TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS idx_invoice_items_warehouse ON public.invoice_items(warehouse_id);

-- 3. Trigger: on invoice_items INSERT/UPDATE/DELETE, sync ims_stock_items.stock_status
CREATE OR REPLACE FUNCTION public.invoice_item_sync_serials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed TEXT[];
  added TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.serial_numbers IS NOT NULL AND array_length(NEW.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(NEW.serial_numbers)
         AND stock_status = 'available';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    removed := ARRAY(SELECT unnest(COALESCE(OLD.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(NEW.serial_numbers,'{}')));
    added   := ARRAY(SELECT unnest(COALESCE(NEW.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(OLD.serial_numbers,'{}')));
    IF array_length(removed,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(removed)
         AND stock_status = 'issued';
    END IF;
    IF array_length(added,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now()
       WHERE part_serial_no = ANY(added)
         AND stock_status = 'available';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.serial_numbers IS NOT NULL AND array_length(OLD.serial_numbers,1) > 0 THEN
      UPDATE public.ims_stock_items
         SET stock_status = 'available', updated_at = now()
       WHERE part_serial_no = ANY(OLD.serial_numbers)
         AND stock_status = 'issued';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_item_sync_serials ON public.invoice_items;
CREATE TRIGGER trg_invoice_item_sync_serials
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.invoice_item_sync_serials();

-- 4. Trigger: on invoice cancel, revert serials to available
CREATE OR REPLACE FUNCTION public.invoice_cancel_release_serials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND (OLD.status IS DISTINCT FROM 'cancelled') THEN
    UPDATE public.ims_stock_items s
       SET stock_status = 'available', updated_at = now()
      FROM public.invoice_items ii
     WHERE ii.invoice_id = NEW.id
       AND s.part_serial_no = ANY(ii.serial_numbers)
       AND s.stock_status = 'issued';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_invoice_cancel_release_serials ON public.invoices;
CREATE TRIGGER trg_invoice_cancel_release_serials
AFTER UPDATE OF status ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.invoice_cancel_release_serials();
