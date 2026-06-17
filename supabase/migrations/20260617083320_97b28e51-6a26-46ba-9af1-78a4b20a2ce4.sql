CREATE TABLE public.whatsapp_launch_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  record_id uuid,
  record_number text,
  recipient_label text,
  recipient_mobile text NOT NULL,
  whatsapp_url text NOT NULL,
  launch_success boolean NOT NULL DEFAULT false,
  failure_reason text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.whatsapp_launch_logs TO authenticated;
GRANT ALL ON public.whatsapp_launch_logs TO service_role;

ALTER TABLE public.whatsapp_launch_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can insert whatsapp launch logs"
ON public.whatsapp_launch_logs
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated can view whatsapp launch logs"
ON public.whatsapp_launch_logs
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX idx_whatsapp_launch_logs_record ON public.whatsapp_launch_logs(module, record_id, created_at DESC);
CREATE INDEX idx_whatsapp_launch_logs_created_at ON public.whatsapp_launch_logs(created_at DESC);