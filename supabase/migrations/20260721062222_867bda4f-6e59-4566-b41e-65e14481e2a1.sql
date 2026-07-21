
-- Audit table
CREATE TABLE IF NOT EXISTS public.document_deletion_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  document_type TEXT NOT NULL,
  document_subtype TEXT,
  document_no TEXT NOT NULL,
  document_id UUID NOT NULL,
  reason TEXT NOT NULL,
  deleted_by UUID,
  deleted_by_name TEXT,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  original_created_by UUID,
  original_created_at TIMESTAMPTZ,
  snapshot JSONB
);

GRANT SELECT, INSERT ON public.document_deletion_audit TO authenticated;
GRANT ALL ON public.document_deletion_audit TO service_role;

ALTER TABLE public.document_deletion_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view deletion audit"
  ON public.document_deletion_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert deletion audit"
  ON public.document_deletion_audit FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_doc_del_audit_type ON public.document_deletion_audit(document_type, deleted_at DESC);

-- Admin delete: Delivery Challan
CREATE OR REPLACE FUNCTION public.admin_delete_challan(_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Reverse stock statuses touched by this DC
  UPDATE public.ims_stock_items
     SET stock_status = 'available'::public.ims_stock_status,
         transaction_ref = NULL,
         updated_at = now()
   WHERE transaction_ref = ref
     AND stock_status IN ('issued'::public.ims_stock_status,
                          'returned_to_oem'::public.ims_stock_status,
                          'reserved'::public.ims_stock_status);

  -- Remove ledger + reservation entries tied to this DC
  DELETE FROM public.ims_transactions WHERE reference = ref;
  DELETE FROM public.ims_reservations WHERE reference = ref;

  -- Audit
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason,
     deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('delivery_challan', dc.doc_type, dc.challan_no, dc.id, _reason,
     auth.uid(), dc.created_by, dc.created_at, to_jsonb(dc));

  DELETE FROM public.delivery_challans WHERE id = _id;
END $$;

REVOKE ALL ON FUNCTION public.admin_delete_challan(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_challan(UUID, TEXT) TO authenticated;

-- Admin delete: GRN
CREATE OR REPLACE FUNCTION public.admin_delete_grn(_id UUID, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gr public.grns%ROWTYPE;
  ref TEXT;
  locked_count INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only administrators can delete GRNs';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for deletion';
  END IF;

  SELECT * INTO gr FROM public.grns WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GRN not found'; END IF;

  ref := 'GRN ' || gr.grn_no;

  -- Refuse if any stock created by this GRN has already been consumed downstream
  SELECT count(*) INTO locked_count
    FROM public.ims_stock_items
   WHERE transaction_ref = ref
     AND stock_status NOT IN ('available'::public.ims_stock_status,
                              'scrapped'::public.ims_stock_status);
  IF locked_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete GRN %: % stock item(s) already issued/reserved. Reverse those first.', gr.grn_no, locked_count;
  END IF;

  -- Remove stock created by this GRN and its ledger entries
  DELETE FROM public.ims_transactions WHERE reference = ref;
  DELETE FROM public.ims_stock_items  WHERE transaction_ref = ref;

  -- Audit
  INSERT INTO public.document_deletion_audit
    (document_type, document_subtype, document_no, document_id, reason,
     deleted_by, original_created_by, original_created_at, snapshot)
  VALUES
    ('grn', gr.category, gr.grn_no, gr.id, _reason,
     auth.uid(), gr.created_by, gr.created_at, to_jsonb(gr));

  DELETE FROM public.grns WHERE id = _id;
END $$;

REVOKE ALL ON FUNCTION public.admin_delete_grn(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_grn(UUID, TEXT) TO authenticated;
