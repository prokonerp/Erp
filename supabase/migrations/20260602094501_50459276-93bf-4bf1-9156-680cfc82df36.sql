
CREATE TABLE public.wa_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_templates TO authenticated;
GRANT ALL ON public.wa_templates TO service_role;

ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth view wa_templates" ON public.wa_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth ins wa_templates" ON public.wa_templates FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth upd wa_templates" ON public.wa_templates FOR UPDATE TO authenticated USING (true);

INSERT INTO public.wa_templates (id, name, body) VALUES
('engineer_assign', 'Engineer Assignment', E'*New Service Call Assigned*\nCase ID: {{case_id}}\nType: {{call_type}}\nCustomer: {{customer_name}}\nContact: {{customer_phone}}\nLocation: {{location}}\nAddress: {{customer_address}}\nProduct: {{product}}\nSerial: {{serial_no}}\nComplaint: {{complaint}}\n\n— Prokon Hi-Tech Systems'),
('oow_quotation', 'OOW Quotation Share', E'Dear {{customer_name}},\n\nPlease find our quotation *{{quote_no}}* for service request *{{case_id}}*{{product_line}}.\n\nKindly review and confirm to proceed.\n\n— Prokon Hi-Tech Systems'),
('ticket_closed', 'Ticket Closure', E'Dear {{customer_name}},\n\nYour service request *{{case_id}}*{{product_line}} has been *resolved & closed*.\nThank you for choosing Prokon Hi-Tech Systems. We appreciate your business.\n\nFor any further assistance, feel free to reach out.\n— Prokon Hi-Tech Systems');
