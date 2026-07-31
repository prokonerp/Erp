CREATE TABLE public.defective_tag_sequence (
  fy text PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);
GRANT SELECT ON public.defective_tag_sequence TO authenticated;
GRANT ALL ON public.defective_tag_sequence TO service_role;
ALTER TABLE public.defective_tag_sequence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read defective tag sequence" ON public.defective_tag_sequence FOR SELECT TO authenticated USING (true);

CREATE TABLE public.defective_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_no text,
  tag_date date NOT NULL DEFAULT CURRENT_DATE,
  txn_id uuid NOT NULL REFERENCES public.ims_transactions(id) ON DELETE CASCADE,
  txn_no text,
  txn_date date,
  service_request_no text,
  oracle_order_no text,
  model_no text,
  serial_no text,
  customer_name text,
  asp_code text,
  engineer_name text,
  replacement_date date,
  replacement_count integer NOT NULL DEFAULT 1,
  reason text,
  warehouse_id uuid REFERENCES public.warehouses(id),
  status text NOT NULL DEFAULT 'generated',
  printed_at timestamptz,
  printed_by text,
  print_count integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX defective_tags_txn_id_key ON public.defective_tags(txn_id);
CREATE UNIQUE INDEX defective_tags_tag_no_key ON public.defective_tags(tag_no);
CREATE INDEX defective_tags_tag_date_idx ON public.defective_tags(tag_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defective_tags TO authenticated;
GRANT ALL ON public.defective_tags TO service_role;
ALTER TABLE public.defective_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view defective tags" ON public.defective_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can create defective tags" ON public.defective_tags FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated can update defective tags" ON public.defective_tags FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can delete defective tags" ON public.defective_tags FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_defective_tag_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d date := COALESCE(NEW.tag_date, CURRENT_DATE);
  y int := CASE WHEN EXTRACT(MONTH FROM d) >= 4 THEN EXTRACT(YEAR FROM d) ELSE EXTRACT(YEAR FROM d) - 1 END;
  fy_key text := y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  n int;
BEGIN
  IF NEW.tag_no IS NOT NULL AND NEW.tag_no <> '' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('defective_tag_seq_' || fy_key));
  INSERT INTO public.defective_tag_sequence(fy, last_no) VALUES (fy_key, 1)
  ON CONFLICT (fy) DO UPDATE SET last_no = public.defective_tag_sequence.last_no + 1
  RETURNING last_no INTO n;
  NEW.tag_no := 'DT/' || fy_key || '/' || lpad(n::text, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_defective_tag_no
BEFORE INSERT ON public.defective_tags
FOR EACH ROW EXECUTE FUNCTION public.set_defective_tag_no();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_defective_tags_updated_at
BEFORE UPDATE ON public.defective_tags
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();