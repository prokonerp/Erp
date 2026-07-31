CREATE OR REPLACE FUNCTION public.admin_delete_challan(_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  dc public.delivery_challans%ROWTYPE;
  ref TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete Delivery Challans';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for deletion';
  END IF;

  SELECT * INTO dc FROM public.delivery_challans WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery Challan not found'; END IF;

  ref := 'DC ' || dc.challan_no;

  -- Remove reservations tied to stock touched by this DC (no reference column here)
  DELETE FROM public.ims_reservations r
   WHERE r.stock_item_id IN (
     SELECT s.id FROM public.ims_stock_items s WHERE s.transaction_ref = ref
   );

  -- Reverse stock statuses touched by this DC
  UPDATE public.ims_stock_items
     SET stock_status = 'available'::public.ims_stock_status,
         transaction_ref = NULL,
         updated_at = now()
   WHERE transaction_ref = ref
     AND stock_status IN ('issued'::public.ims_stock_status,
                          'returned_to_oem'::public.ims_stock_status,
                          'reserved'::public.ims_stock_status);

  -- Remove ledger entries tied to this DC
  DELETE FROM public.ims_transactions WHERE reference = ref;

  -- Audit
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason,
     deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('delivery_challan', dc.doc_type, dc.challan_no, dc.id, _reason,
     auth.uid(), dc.created_by, dc.created_at, to_jsonb(dc));

  DELETE FROM public.delivery_challans WHERE id = _id;
END $function$;