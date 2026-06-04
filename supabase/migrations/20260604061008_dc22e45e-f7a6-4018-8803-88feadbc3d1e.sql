
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Storage policies for ticket-attachments bucket
CREATE POLICY "Public can upload ticket attachments"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND (storage.foldername(name))[1] = 'public'
);

CREATE POLICY "Authenticated can read ticket attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'ticket-attachments');

CREATE POLICY "Anon can read own ticket attachments"
ON storage.objects FOR SELECT
TO anon
USING (bucket_id = 'ticket-attachments' AND (storage.foldername(name))[1] = 'public');
