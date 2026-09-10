-- Migration: 20260910000002_engineers_iter2_fix.sql
-- Iteration-2 fixes for Engineers Module upload guards.
-- SAFE: additive only, idempotent (DROP IF EXISTS + CREATE), zero destructive statements.

-- =====================================================================
-- 1) Fix storage.objects INSERT policy for ticket-attachments bucket.
--    BUG: original policy only allows (storage.foldername(name))[1] = 'public',
--    which blocks new ticket/<id>/... upload paths.
--    FIX: widen to accept both 'public' and 'ticket' prefixes.
-- =====================================================================
DROP POLICY IF EXISTS "Public can upload ticket attachments" ON storage.objects;
CREATE POLICY "Public can upload ticket attachments"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[1] IN ('public', 'ticket')
  );

-- =====================================================================
-- SAFETY: no other policies changed. SELECT/DELETE remain as-is.
-- Legacy public/... paths still readable/deletable by admin.
-- New ticket/<id>/... paths now writable by authenticated users.
-- =====================================================================
