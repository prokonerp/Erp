-- Migration: 20260922000001_harden_ticket_attachments_storage.sql
-- Close the unauthenticated (anon) INSERT path on the ticket-attachments bucket.
--
-- CONTEXT: 20260915000002 created policy "Public can upload ticket attachments"
-- (INSERT TO anon, authenticated) as a stop-gap so the public raise-ticket form
-- could stage photos. Public uploads now go through service-role server
-- functions (src/lib/public-ticket-uploads.functions.ts), so no legitimate flow
-- needs anon storage INSERT. Authenticated engineers/admins keep the exact same
-- folder-scoped INSERT they already had.
--
-- SAFE: additive only, idempotent (DROP IF EXISTS + CREATE), zero destructive
-- statements. Storage RLS metadata only — no tables/columns/rows touched.
-- Safety assertion: this file contains zero DELETE FROM / TRUNCATE /
-- DROP TABLE / DROP COLUMN.

-- 1) Replace the anon-open policy with an authenticated-only equivalent.
--    Same bucket, same folder scope, minus the anon role.
--    Both DROPs precede the CREATE so re-running this file is a no-op.
DROP POLICY IF EXISTS "Public can upload ticket attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload ticket attachments" ON storage.objects;
CREATE POLICY "Authenticated can upload ticket attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ticket-attachments'
    AND (storage.foldername(name))[1] IN ('public', 'ticket')
  );

-- 2) Explicitly unchanged (verified present by predecessor migrations):
--    "Authenticated can read ticket-attachments" (SELECT, authenticated)
--    "Admins can insert/update/delete ticket-attachments" (admin-gated)
--    No other policy on this bucket is created, altered, or dropped here.
