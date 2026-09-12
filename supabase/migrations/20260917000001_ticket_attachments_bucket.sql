-- =============================================================================
-- Ticket attachments bucket: private storage for engineer correction photos.
-- Mirrors po-logos / signatures style (private bucket + idempotent upsert).
-- Run this in the Supabase dashboard (SQL editor). Do NOT run via automation.
-- =============================================================================

-- 1) Create the ticket-attachments storage bucket (private; 10 MB cap, any type).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-attachments',
  'ticket-attachments',
  false,
  10485760,
  NULL
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit;

-- 2) RLS policies for the ticket-attachments bucket.
--    Any authenticated user may read (so verification views can fetch signed URLs).
--    Only admins may insert / update / delete files.

DROP POLICY IF EXISTS "Authenticated can read ticket-attachments" ON storage.objects;
CREATE POLICY "Authenticated can read ticket-attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'ticket-attachments');

DROP POLICY IF EXISTS "Admins can insert ticket-attachments" ON storage.objects;
CREATE POLICY "Admins can insert ticket-attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Admins can update ticket-attachments" ON storage.objects;
CREATE POLICY "Admins can update ticket-attachments" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ticket-attachments'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Admins can delete ticket-attachments" ON storage.objects;
CREATE POLICY "Admins can delete ticket-attachments" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'ticket-attachments'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );
