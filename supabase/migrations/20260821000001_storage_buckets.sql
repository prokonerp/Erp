-- Storage buckets (previously created via the old project's Dashboard)
-- All three are PRIVATE buckets; access is enforced by the RLS policies
-- on storage.objects that the earlier migrations created.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('ticket-attachments', 'ticket-attachments', false, 10485760, NULL),   -- 10 MB
  ('amc-agreements',     'amc-agreements',     false, 20971520, NULL),   -- 20 MB
  ('oem-logos',          'oem-logos',          false, 5242880,  NULL)    -- 5 MB
ON CONFLICT (id) DO NOTHING;