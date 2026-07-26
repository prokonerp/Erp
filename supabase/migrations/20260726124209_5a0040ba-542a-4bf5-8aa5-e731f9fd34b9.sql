
CREATE TABLE IF NOT EXISTS public.letterhead_settings (
  document_type TEXT PRIMARY KEY CHECK (document_type IN ('quotation','sales_order','delivery_challan','pi','invoice')),
  use_letterhead BOOLEAN NOT NULL DEFAULT true,
  show_supply_from BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.letterhead_settings TO authenticated;
GRANT ALL ON public.letterhead_settings TO service_role;

ALTER TABLE public.letterhead_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "letterhead_settings read" ON public.letterhead_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "letterhead_settings write" ON public.letterhead_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.letterhead_settings (document_type, use_letterhead, show_supply_from) VALUES
  ('quotation', true, false),
  ('sales_order', true, false),
  ('delivery_challan', true, false),
  ('pi', true, false),
  ('invoice', true, false)
ON CONFLICT (document_type) DO NOTHING;
