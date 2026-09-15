-- Migration: 20260918000002_ticket_doc_cancel_unlink.sql
-- Tickets: clear the GRN/DC link-back when a ticket-sourced document is
-- cancelled (re-enables the Generate buttons on the ticket).
-- Stock reversal itself is handled by grn_post_inventory / dc_post_inventory
-- on the Submitted -> Cancelled transition; this only clears the
-- tickets.grn_no / tickets.dc_no stamps that the forms wrote at save time.
-- Without it a cancelled GRN/DC keeps the ticket stamped and the
-- duplicate-generation guard blocks re-creation even though stock was
-- restored (admin would have to use "clear link" manually).
-- SAFE: additive-only, idempotent (DROP IF EXISTS + CREATE OR REPLACE),
-- zero destructive statements. Fires only on status -> 'Cancelled'.

-- =====================================================================
-- 1) Clear tickets.grn_no when a GRN is cancelled
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tickets_clear_grn_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Cancelled' AND NEW.grn_no IS NOT NULL AND NEW.grn_no <> '' THEN
    UPDATE public.tickets
    SET grn_no = NULL
    WHERE grn_no = NEW.grn_no;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_clear_grn_on_cancel ON public.grns;
CREATE TRIGGER trg_tickets_clear_grn_on_cancel
  AFTER UPDATE OF status ON public.grns
  FOR EACH ROW
  WHEN (NEW.status = 'Cancelled')
  EXECUTE FUNCTION public.tickets_clear_grn_on_cancel();

-- =====================================================================
-- 2) Clear tickets.dc_no when a Delivery Challan is cancelled
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tickets_clear_dc_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Cancelled' AND NEW.challan_no IS NOT NULL AND NEW.challan_no <> '' THEN
    UPDATE public.tickets
    SET dc_no = NULL
    WHERE dc_no = NEW.challan_no;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_clear_dc_on_cancel ON public.delivery_challans;
CREATE TRIGGER trg_tickets_clear_dc_on_cancel
  AFTER UPDATE OF status ON public.delivery_challans
  FOR EACH ROW
  WHEN (NEW.status = 'Cancelled')
  EXECUTE FUNCTION public.tickets_clear_dc_on_cancel();
