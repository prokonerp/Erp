-- Migration: 20260918000003_transfer_cancel_reversal.sql
-- IMS transfers: reverse the stock posting when a transfer in transit is
-- cancelled. Today the UI offers "Cancel Transfer" but
-- ims_transfer_status_effects() has no cancelled branch, so stock stranded
-- in `in_transit` never returns to `available` (the toast even claims it
-- does). Cancel from submitted/approved moves nothing and needs no reversal;
-- cancel from completed is not offered in UI and is out of scope here.
-- SAFE: additive-only, idempotent (DROP IF EXISTS + CREATE), zero
-- destructive statements. Fires only on in_transit -> cancelled.

CREATE OR REPLACE FUNCTION public.ims_transfer_cancel_reversal()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND OLD.status = 'in_transit'
     AND NEW.status = 'cancelled'
     AND NEW.stock_item_id IS NOT NULL THEN
    -- Return the unit to available (only if still parked in transit —
    -- a concurrent completion wins the race and this becomes a no-op).
    UPDATE public.ims_stock_items
       SET stock_status = 'available',
           updated_at = now()
     WHERE id = NEW.stock_item_id
       AND stock_status = 'in_transit';

    -- Audit the reversal against the same document reference.
    INSERT INTO public.ims_transactions(
      txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
      from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
    ) VALUES (
      'transfer_in', NEW.stock_item_id, NEW.part_name, NEW.part_model_no,
      NEW.part_serial_no, NEW.oem,
      NEW.source_warehouse_id, NEW.source_warehouse_id, NEW.qty, NEW.id,
      NEW.transfer_no, 'Transfer cancelled — stock returned to source warehouse',
      NEW.requested_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ims_transfer_cancel_reversal ON public.ims_transfers;
CREATE TRIGGER trg_ims_transfer_cancel_reversal
  AFTER UPDATE OF status ON public.ims_transfers
  FOR EACH ROW
  WHEN (OLD.status = 'in_transit' AND NEW.status = 'cancelled')
  EXECUTE FUNCTION public.ims_transfer_cancel_reversal();
