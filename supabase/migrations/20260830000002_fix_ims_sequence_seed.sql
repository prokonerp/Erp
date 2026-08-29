-- Fix IMS transaction/transfer sequence seed.
-- The live DB's ims_txn_sequence and ims_transfer_sequence tables exist but are
-- EMPTY (missing their id=1 seed row). next_ims_txn_seq() / next_ims_transfer_seq()
-- both do `UPDATE ... WHERE id=1 RETURNING last_seq`; with no row the UPDATE skips,
-- returns NULL, and the set_ims_txn_no() trigger writes a NULL txn_no.
-- Result: almost all ims_transactions rows have txn_no = NULL.
--
-- Fix: ensure the id=1 rows exist (idempotent).

INSERT INTO public.ims_txn_sequence (id, last_seq)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.ims_transfer_sequence (id, last_seq)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- Re-assert the set_ims_txn_no trigger is present (matches setup_new_supabase.sql).
CREATE OR REPLACE FUNCTION public.set_ims_txn_no() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
DECLARE ts TEXT; seq BIGINT;
BEGIN
  IF NEW.txn_no IS NULL OR NEW.txn_no = '' THEN
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata','DDMMYYHH24MI');
    seq := public.next_ims_txn_seq();
    IF seq IS NULL THEN
      -- defensive: seed row missing; default to a timestamp-only id
      NEW.txn_no := 'PHS/IMS/' || ts;
    ELSE
      NEW.txn_no := 'PHS/IMS/' || ts || lpad(seq::text,4,'0');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ims_set_txn_no ON public.ims_transactions;
CREATE TRIGGER trg_ims_set_txn_no BEFORE INSERT ON public.ims_transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_ims_txn_no();
