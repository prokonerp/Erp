-- Migration: 20260918000001_ticket_grn_dc_link.sql
-- Tickets: link-back to the Customer GRN / Customer DC generated from
-- ticket part lines (Defective Parts Received / Good Parts Used).
-- The admin "Generate GRN (Customer)" / "Generate DC (Customer)" actions
-- stamp these columns after the document is saved, so a ticket shows which
-- GRN-CUST / DC-CUST settled its staged FSR parts. Buttons are disabled
-- once the stamp exists (duplicate-generation guard).
-- SAFE: additive-only, idempotent (IF NOT EXISTS), zero destructive
-- statements. No backfill UPDATEs. RLS unchanged (engineers stay read-only
-- on tickets; only services/admin write).

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS grn_no text;

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS dc_no text;

COMMENT ON COLUMN public.tickets.grn_no IS
  'Customer GRN number (GRN-CUST/...) generated from defective parts received on this ticket. NULL = not generated yet.';
COMMENT ON COLUMN public.tickets.dc_no IS
  'Customer DC number (DC-CUST/...) generated from good parts used on this ticket. NULL = not generated yet.';

CREATE INDEX IF NOT EXISTS idx_tickets_grn_no
  ON public.tickets (grn_no)
  WHERE grn_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_dc_no
  ON public.tickets (dc_no)
  WHERE dc_no IS NOT NULL;
