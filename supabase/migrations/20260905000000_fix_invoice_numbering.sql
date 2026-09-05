-- =====================================================================
-- Fix invoice numbering race (mirrors fix_document_numbering for PO/SO)
-- Replaces set_invoice_no without advisory lock + non-atomic next_seq bump
-- with serialized allocation via pg_advisory_xact_lock + UPDATE RETURNING.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.set_invoice_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s public.invoice_settings%ROWTYPE;
  d DATE := COALESCE(NEW.invoice_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.invoice_no IS NOT NULL AND NEW.invoice_no <> '' THEN
    RETURN NEW;
  END IF;

  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  -- Serialize allocation per branch so two concurrent invoices cannot grab same seq
  PERFORM pg_advisory_xact_lock(hashtextextended('invoice_no:' || COALESCE(NEW.branch_id::text, ''), 0));

  SELECT * INTO s FROM public.invoice_settings WHERE branch_id = NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.invoice_settings (branch_id, prefix, fy_reset, current_fy, next_seq)
      VALUES (NEW.branch_id, 'PHS/INV/', true, fy, 2)
      ON CONFLICT (branch_id) DO NOTHING;
    SELECT * INTO s FROM public.invoice_settings WHERE branch_id = NEW.branch_id;
    seq := 1;
  ELSE
    UPDATE public.invoice_settings
       SET current_fy = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN fy ELSE current_fy END,
           next_seq   = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN 2
                             ELSE next_seq + 1 END
     WHERE id = s.id
     RETURNING next_seq - CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN 1 ELSE 0 END
       INTO seq;
    -- Refresh s for prefix/fy_reset that may have changed (prefix not re-fetched needed, use old s.prefix + updated current_fy)
    SELECT * INTO s FROM public.invoice_settings WHERE id = s.id;
  END IF;

  new_prefix := COALESCE(s.prefix, 'PHS/INV/');

  IF s.fy_reset THEN
    NEW.invoice_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');
  ELSE
    NEW.invoice_no := new_prefix || to_char(d,'YYYY') || '/' || lpad(seq::text, 4, '0');
  END IF;

  RETURN NEW;
END $$;

-- Ensure trigger exists (idempotent)
DROP TRIGGER IF EXISTS trg_set_invoice_no ON public.invoices;
CREATE TRIGGER trg_set_invoice_no BEFORE INSERT ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_invoice_no();

-- Safety: unique index on invoice_no (should already exist via UNIQUE column, but enforce)
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_invoice_no ON public.invoices(invoice_no);
