ALTER TYPE public.ims_transfer_status ADD VALUE IF NOT EXISTS 'cancelled';

ALTER TABLE public.ims_transfers ADD COLUMN IF NOT EXISTS cancelled_reason text;

CREATE OR REPLACE FUNCTION public.ims_transfer_status_effects()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  linked_id UUID := NEW.stock_item_id;
  d RECORD;
  s RECORD;
  wrote_out BOOLEAN := FALSE;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('in_transit','completed','cancelled') THEN

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
      ELSIF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        FOR d IN
          SELECT * FROM public.ims_deduct_qty(
            NEW.part_model_no, NEW.source_warehouse_id, NEW.stock_type, NEW.qty,
            COALESCE(NEW.transfer_no,'Transfer'), 'in_transit'::public.ims_stock_status,
            'Transfer ' || COALESCE(NEW.transfer_no,'')
          )
        LOOP
          IF linked_id IS NULL THEN
            linked_id := d.stock_item_id;
            NEW.stock_item_id := linked_id;
          END IF;
          INSERT INTO public.ims_transactions(
            txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
            from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
          ) VALUES (
            'transfer_out', d.stock_item_id, NEW.part_name, NEW.part_model_no, NULL, NEW.oem,
            NEW.source_warehouse_id, NEW.destination_warehouse_id, d.qty_taken, NEW.id, NEW.transfer_no,
            'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
          );
          wrote_out := TRUE;
        END LOOP;
      END IF;

      IF NOT wrote_out THEN
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
        ) VALUES (
          'transfer_out', linked_id, NEW.part_name, NEW.part_model_no, NEW.part_serial_no, NEW.oem,
          NEW.source_warehouse_id, NEW.destination_warehouse_id, NEW.qty, NEW.id, NEW.transfer_no,
          'Transfer out on approval', COALESCE(NEW.approved_by, NEW.requested_by)
        );
      END IF;

    ELSIF NEW.status = 'cancelled' THEN
      IF OLD.status = 'in_transit' THEN
        IF NEW.part_serial_no IS NOT NULL OR (linked_id IS NOT NULL AND NEW.part_model_no IS NULL) THEN
          FOR s IN
            SELECT * FROM public.ims_stock_items
             WHERE id = linked_id AND stock_status = 'in_transit'
          LOOP
            UPDATE public.ims_stock_items
               SET stock_status = 'available',
                   warehouse_id = COALESCE(NEW.source_warehouse_id, warehouse_id),
                   updated_at = now()
             WHERE id = s.id;
            INSERT INTO public.ims_transactions(
              txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
              from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
            ) VALUES (
              'transfer_in', s.id, NEW.part_name, NEW.part_model_no, s.part_serial_no, NEW.oem,
              NEW.destination_warehouse_id, NEW.source_warehouse_id, s.qty, NEW.id, NEW.transfer_no,
              'Reversal: Transfer cancelled while in transit', COALESCE(NEW.approved_by, NEW.requested_by)
            );
          END LOOP;
        ELSE
          FOR s IN
            SELECT * FROM public.ims_stock_items
             WHERE stock_status = 'in_transit'
               AND part_serial_no IS NULL
               AND part_model_no = NEW.part_model_no
               AND stock_type = NEW.stock_type
               AND (NEW.source_warehouse_id IS NULL OR warehouse_id = NEW.source_warehouse_id)
               AND transaction_ref = COALESCE(NEW.transfer_no,'Transfer')
          LOOP
            UPDATE public.ims_stock_items
               SET stock_status = 'available', updated_at = now()
             WHERE id = s.id;
            INSERT INTO public.ims_transactions(
              txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
              from_warehouse_id, to_warehouse_id, qty, transfer_id, reference, notes, created_by
            ) VALUES (
              'transfer_in', s.id, NEW.part_name, NEW.part_model_no, NULL, NEW.oem,
              NEW.destination_warehouse_id, NEW.source_warehouse_id, s.qty, NEW.id, NEW.transfer_no,
              'Reversal: Transfer cancelled while in transit', COALESCE(NEW.approved_by, NEW.requested_by)
            );
          END LOOP;
        END IF;
      END IF;

    ELSIF NEW.status = 'completed' THEN
      IF NEW.part_serial_no IS NULL AND NEW.part_model_no IS NOT NULL THEN
        IF linked_id IS NOT NULL THEN
          DELETE FROM public.ims_stock_items WHERE id = linked_id;
        END IF;
        linked_id := public.ims_add_qty(
          NEW.part_model_no, NEW.destination_warehouse_id, NEW.stock_type, NEW.qty,
          NEW.part_name, NEW.oem, COALESCE(NEW.transfer_no,'Transfer')
        );
        NEW.stock_item_id := linked_id;
      ELSIF linked_id IS NOT NULL THEN
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
END $function$;