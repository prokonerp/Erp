
ALTER TABLE public.amcs ADD COLUMN IF NOT EXISTS agreement_doc_path text;

CREATE POLICY "Authenticated can read amc agreements"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'amc-agreements');

CREATE POLICY "Authenticated can upload amc agreements"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'amc-agreements');

CREATE POLICY "Authenticated can update amc agreements"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'amc-agreements');

CREATE POLICY "Authenticated can delete amc agreements"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'amc-agreements');
