-- =====================================================================
-- Fixes for non-invoice document numbering (S2)
-- Signatures match supabase/setup_new_supabase.sql. invoice_no is NOT touched.
-- 2a. set_so_no / set_po_no: atomic reservation of next_seq (no read-then-inc race).
-- 2b. set_quote_no: UNIQUE index on quote_no (body already uses an advisory lock).
-- 2c. set_dc_challan_no / set_grn_no / set_challan_no: Apr-Mar financial year
--     (consistent with SO/invoice) + advisory lock to avoid races.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2a: set_po_no — atomic sequence reservation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_po_no()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  s public.po_settings%ROWTYPE;
  d DATE := COALESCE(NEW.po_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.po_no IS NOT NULL AND NEW.po_no <> '' THEN
    RETURN NEW;
  END IF;

  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  -- Serialize allocation so two concurrent PO inserts cannot grab the same seq.
  PERFORM pg_advisory_xact_lock(hashtextextended('po_no:' || COALESCE(NEW.branch_id::text, ''), 0));

  SELECT * INTO s FROM public.po_settings WHERE branch_id = NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.po_settings (branch_id, prefix, fy_reset, current_fy, next_seq)
      VALUES (NEW.branch_id, 'PROKON/PO/', true, fy, 2)
      ON CONFLICT (branch_id) DO NOTHING;
    SELECT * INTO s FROM public.po_settings WHERE branch_id = NEW.branch_id;
    seq := 1;
  ELSE
    -- Single atomic UPDATE returns the reserved sequence number.
    UPDATE public.po_settings
       SET current_fy = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN fy ELSE current_fy END,
           next_seq   = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN 2
                             ELSE next_seq + 1 END
     WHERE id = s.id
     RETURNING next_seq - CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN 1 ELSE 0 END
       INTO seq;
  END IF;

  new_prefix := COALESCE(s.prefix, 'PROKON/PO/');

  IF s.fy_reset THEN
    NEW.po_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');
  ELSE
    NEW.po_no := new_prefix || to_char(d,'YYYY') || '/' || lpad(seq::text, 4, '0');
  END IF;

  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 2a: set_so_no — atomic sequence reservation
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_so_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  s public.sales_order_settings%ROWTYPE;
  d DATE := COALESCE(NEW.so_date, CURRENT_DATE);
  start_yr INT; end_yr INT;
  fy TEXT;
  seq INT;
  new_prefix TEXT;
BEGIN
  IF NEW.so_no IS NOT NULL AND NEW.so_no <> '' THEN RETURN NEW; END IF;

  IF EXTRACT(MONTH FROM d) >= 4 THEN
    start_yr := EXTRACT(YEAR FROM d)::int;
  ELSE
    start_yr := EXTRACT(YEAR FROM d)::int - 1;
  END IF;
  end_yr := start_yr + 1;
  fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

  PERFORM pg_advisory_xact_lock(hashtextextended('so_no:' || COALESCE(NEW.branch_id::text, ''), 0));

  SELECT * INTO s FROM public.sales_order_settings WHERE branch_id IS NOT DISTINCT FROM NEW.branch_id;
  IF NOT FOUND THEN
    INSERT INTO public.sales_order_settings (branch_id, current_fy, next_seq)
      VALUES (NEW.branch_id, fy, 2)
      ON CONFLICT (branch_id) DO NOTHING;
    SELECT * INTO s FROM public.sales_order_settings WHERE branch_id IS NOT DISTINCT FROM NEW.branch_id;
    seq := 1;
  ELSE
    UPDATE public.sales_order_settings
       SET current_fy = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN fy ELSE current_fy END,
           next_seq   = CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN 2
                             ELSE next_seq + 1 END
     WHERE id = s.id
     RETURNING next_seq - CASE WHEN fy_reset AND (current_fy IS DISTINCT FROM fy) THEN 1 ELSE 0 END
       INTO seq;
  END IF;

  new_prefix := COALESCE(s.prefix, 'PHS/SO/');
  NEW.so_no := new_prefix || fy || '/' || lpad(seq::text, 4, '0');
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------
-- 2b: set_quote_no — body kept (already advisory-locked); add UNIQUE index.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_quote_no()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  d date := COALESCE(NEW.quote_date, CURRENT_DATE);
  start_yr int;
  end_yr int;
  fy text;
  seq int;
  candidate text;
BEGIN
  IF NEW.quote_no IS NULL OR NEW.quote_no = '' THEN
    IF EXTRACT(MONTH FROM d) >= 4 THEN
      start_yr := EXTRACT(YEAR FROM d)::int;
    ELSE
      start_yr := EXTRACT(YEAR FROM d)::int - 1;
    END IF;
    end_yr := start_yr + 1;
    fy := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

    -- Serialize allocation for the financial year and bypass per-user RLS visibility.
    PERFORM pg_advisory_xact_lock(hashtextextended('quotations_quote_no:' || fy, 0));

    SELECT COALESCE(MAX((regexp_match(quote_no, '^PHS/' || fy || '/([0-9]+)$'))[1]::int), 0) + 1
      INTO seq
      FROM public.quotations
     WHERE quote_no ~ ('^PHS/' || fy || '/[0-9]+$');

    candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');

    WHILE EXISTS (SELECT 1 FROM public.quotations WHERE quote_no = candidate) LOOP
      seq := seq + 1;
      candidate := 'PHS/' || fy || '/' || lpad(seq::text, 4, '0');
    END LOOP;

    NEW.quote_no := candidate;
  END IF;
  RETURN NEW;
END
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_so_no ON public.sales_orders(so_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_po_no ON public.purchase_orders(po_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotations_quote_no ON public.quotations(quote_no);

-- ---------------------------------------------------------------------
-- 2c: set_dc_challan_no — Apr-Mar financial year + advisory lock
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_dc_challan_no()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  yr TEXT;
  seq INT;
  start_yr INT;
  end_yr INT;
BEGIN
  IF NEW.challan_no IS NULL OR NEW.challan_no = '' THEN
    IF EXTRACT(MONTH FROM now()) >= 4 THEN
      start_yr := EXTRACT(YEAR FROM now())::int;
    ELSE
      start_yr := EXTRACT(YEAR FROM now())::int - 1;
    END IF;
    end_yr := start_yr + 1;
    yr := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

    PERFORM pg_advisory_xact_lock(hashtextextended('dc_challan_no:' || COALESCE(NEW.doc_type,'') || ':' || yr, 0));

    IF NEW.doc_type = 'customer' THEN
      seq := nextval('public.dc_customer_seq');
      NEW.challan_no := 'DC-CUST/' || yr || '/' || lpad(seq::text, 4, '0');
    ELSE
      seq := nextval('public.dc_oem_seq');
      NEW.challan_no := 'DC-OEM/' || yr || '/' || lpad(seq::text, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- ---------------------------------------------------------------------
-- 2c: set_grn_no — Apr-Mar financial year + advisory lock
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_grn_no()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  yr TEXT;
  seq INT;
  start_yr INT;
  end_yr INT;
BEGIN
  IF NEW.grn_no IS NULL OR NEW.grn_no = '' THEN
    IF EXTRACT(MONTH FROM now()) >= 4 THEN
      start_yr := EXTRACT(YEAR FROM now())::int;
    ELSE
      start_yr := EXTRACT(YEAR FROM now())::int - 1;
    END IF;
    end_yr := start_yr + 1;
    yr := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

    PERFORM pg_advisory_xact_lock(hashtextextended('grn_no:' || COALESCE(NEW.category,'') || ':' || yr, 0));

    IF NEW.category = 'customer' THEN
      seq := nextval('public.grn_customer_seq');
      NEW.grn_no := 'GRN-CUST/' || yr || '/' || lpad(seq::text, 4, '0');
    ELSIF NEW.category = 'oem' THEN
      seq := nextval('public.grn_oem_seq');
      NEW.grn_no := 'GRN-OEM/' || yr || '/' || lpad(seq::text, 4, '0');
    ELSE
      seq := nextval('public.grn_general_seq');
      NEW.grn_no := 'GRN-GEN/' || yr || '/' || lpad(seq::text, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- 2c: set_challan_no (gatepasses) — Apr-Mar financial year + advisory lock
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_challan_no()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  yr TEXT;
  seq INT;
  start_yr INT;
  end_yr INT;
BEGIN
  IF NEW.challan_no IS NULL OR NEW.challan_no = '' THEN
    IF EXTRACT(MONTH FROM now()) >= 4 THEN
      start_yr := EXTRACT(YEAR FROM now())::int;
    ELSE
      start_yr := EXTRACT(YEAR FROM now())::int - 1;
    END IF;
    end_yr := start_yr + 1;
    yr := lpad((start_yr % 100)::text, 2, '0') || '-' || lpad((end_yr % 100)::text, 2, '0');

    PERFORM pg_advisory_xact_lock(hashtextextended('gatepass_challan_no:' || yr, 0));

    SELECT COALESCE(MAX(CAST(split_part(challan_no,'/',3) AS INT)),0)+1 INTO seq
      FROM public.gatepasses WHERE challan_no LIKE 'PHS/'||yr||'/%';
    NEW.challan_no := 'PHS/' || yr || '/' || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;
