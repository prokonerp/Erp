-- PO Print Settings — letterhead logo + selected office address (per branch).
-- Extends the existing branch-scoped po_settings table. All idempotent.

ALTER TABLE public.po_settings
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE public.po_settings
  ADD COLUMN IF NOT EXISTS letterhead_address_source TEXT NOT NULL DEFAULT 'branch';

-- Create a private PO-logo storage bucket (PNG/JPG only, 2 MB cap).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'po-logos', 'po-logos', false, 2097152,
  ARRAY['image/png', 'image/jpeg']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS: any authenticated user may read (so print views can fetch signed URLs);
-- only admins may insert/update/delete.
DROP POLICY IF EXISTS "Authenticated can read po-logos" ON storage.objects;
CREATE POLICY "Authenticated can read po-logos" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'po-logos');

DROP POLICY IF EXISTS "Admins can write po-logos" ON storage.objects;
CREATE POLICY "Admins can write po-logos" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'po-logos' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'po-logos' AND public.has_role(auth.uid(), 'admin'));
