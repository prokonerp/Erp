-- Link GRNs back to their source General Delivery Challan (GDC return flow)
ALTER TABLE public.grns ADD COLUMN IF NOT EXISTS general_dc_id uuid;
ALTER TABLE public.grns
  ADD CONSTRAINT grns_general_dc_id_fkey
  FOREIGN KEY (general_dc_id) REFERENCES public.general_delivery_challans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_grns_general_dc_id ON public.grns(general_dc_id);
