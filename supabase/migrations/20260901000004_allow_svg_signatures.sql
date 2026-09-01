-- =============================================================================
-- Allow SVG signatures (vector, transparent bg, crisp print)
-- Extends storage.buckets.allowed_mime_types for "signatures" to include image/svg+xml
-- =============================================================================

-- Update bucket to include SVG alongside PNG/JPEG (idempotent, preserves 2 MB cap & private flag)
UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/svg+xml']::text[]
WHERE id = 'signatures';

-- Fallback insert if bucket was never created (e.g. fresh env without prior migration)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'signatures',
  'signatures',
  false,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  file_size_limit = EXCLUDED.file_size_limit,
  public = EXCLUDED.public;
