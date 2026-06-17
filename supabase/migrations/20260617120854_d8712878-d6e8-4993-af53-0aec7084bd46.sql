
-- 1) Add OEM Case ID to transactions for full indent traceability
ALTER TABLE public.ims_transactions
  ADD COLUMN IF NOT EXISTS oem_case_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ims_txn_oem_case ON public.ims_transactions(oem_case_id);

-- Backfill from indents where possible
UPDATE public.ims_transactions t
   SET oem_case_id = i.oem_case_id
  FROM public.indents i
 WHERE t.indent_id = i.id
   AND t.oem_case_id IS NULL
   AND i.oem_case_id IS NOT NULL;

-- 2) Rewrite transfer status effects
-- Approval/in_transit  -> transfer_out + stock=in_transit (deducted from source)
-- Completed            -> transfer_in  + stock moves to destination, status=available
-- Auto-link stock item by serial + source warehouse if not pre-set
CREATE OR REPLACE FUNCTION public.ims_transfer_status_effects() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE
  linked_id UUID := NEW.stock_item_id;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('in_transit','completed') THEN

    -- Auto-link by serial + source warehouse when not chosen
    IF linked_id IS NULL AND NEW.part_serial_no IS NOT NULL THEN
      SELECT id INTO linked_id
        FROM public.ims_stock_items
       WHERE part_serial_no = NEW.part_serial_no
         AND (NEW.source_warehouse_id IS NULL OR warehouse_id = NEW.source_warehouse_id)
       LIMIT 1;
      IF linked_id IS NOT NULL THEN
        NEW.stock_item_id := linked_id;
      END IF;
    END IF;

    IF NEW.status = 'in_transit' THEN
      IF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET stock_status = 'in_transit', updated_at = now()
         WHERE id = linked_id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
      ) VALUES (
        'transfer_out', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
        NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
        'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
      );

    ELSIF NEW.status = 'completed' THEN
      IF linked_id IS NOT NULL THEN
        UPDATE public.ims_stock_items
           SET warehouse_id  = NEW.destination_warehouse_id,
               stock_status  = 'available',
               updated_at    = now()
         WHERE id = linked_id;
      END IF;

      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
      ) VALUES (
        'transfer_in', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
        NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
        'Transfer received', NEW.received_by
      );
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Switch trigger to BEFORE UPDATE so NEW.stock_item_id mutation persists
DROP TRIGGER IF EXISTS trg_ims_transfer_status_effects ON public.ims_transfers;
CREATE TRIGGER trg_ims_transfer_status_effects
  BEFORE UPDATE OF status ON public.ims_transfers
  FOR EACH ROW EXECUTE FUNCTION public.ims_transfer_status_effects();
