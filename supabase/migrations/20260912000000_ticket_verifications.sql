CREATE TABLE public.ticket_customer_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  verdict text NOT NULL CHECK (verdict IN ('verified','incorrect')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  corrected jsonb NOT NULL DEFAULT '{}'::jsonb,
  engineer_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  engineer_name text,
  engineer_phone text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id)
);
CREATE TABLE public.ticket_equipment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES public.tickets(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('matched','mismatch')),
  original_model text,
  original_serial text,
  corrected_model text,
  corrected_serial text,
  photo_path text,
  photo_lat double precision,
  photo_long double precision,
  photo_accuracy double precision,
  photo_captured_at timestamptz,
  engineer_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  engineer_name text,
  engineer_phone text,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tcv_ticket ON public.ticket_customer_verifications(ticket_id);
CREATE INDEX idx_tev_ticket ON public.ticket_equipment_verifications(ticket_id);
CREATE INDEX idx_tcv_customer ON public.ticket_customer_verifications(customer_id);
ALTER TABLE public.ticket_customer_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_equipment_verifications ENABLE ROW LEVEL SECURITY;
DROP TRIGGER IF EXISTS trg_touch_tcv ON public.ticket_customer_verifications;
CREATE TRIGGER trg_touch_tcv BEFORE UPDATE ON public.ticket_customer_verifications FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS trg_touch_tev ON public.ticket_equipment_verifications;
CREATE TRIGGER trg_touch_tev BEFORE UPDATE ON public.ticket_equipment_verifications FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
