-- =============================================================================
-- User signatures: stored per app_user and used in invoice/print PDFs.
-- =============================================================================

-- 1) Add signature_url column to app_users.
ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS signature_url TEXT;

-- 2) Create the signatures storage bucket (private; PNG/JPG only, 2 MB cap).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signatures',
  'signatures',
  false,
  2097152,
  ARRAY['image/png', 'image/jpeg']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 3) RLS policies for the signatures bucket.
--    Any authenticated user may read (so print views can fetch signed URLs).
--    Only admins may insert / update / delete files.

DROP POLICY IF EXISTS "Authenticated can read signatures" ON storage.objects;
CREATE POLICY "Authenticated can read signatures" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'signatures');

DROP POLICY IF EXISTS "Admins can insert signatures" ON storage.objects;
CREATE POLICY "Admins can insert signatures" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'signatures'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Admins can update signatures" ON storage.objects;
CREATE POLICY "Admins can update signatures" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    bucket_id = 'signatures'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP POLICY IF EXISTS "Admins can delete signatures" ON storage.objects;
CREATE POLICY "Admins can delete signatures" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'signatures'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );
