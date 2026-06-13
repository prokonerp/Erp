
CREATE OR REPLACE FUNCTION public.set_ticket_case_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  p text;
  ts text;
  seq bigint;
BEGIN
  IF NEW.case_id IS NULL OR NEW.case_id = '' THEN
    SELECT prefix INTO p FROM public.ticket_settings WHERE id = 1;
    IF p IS NULL THEN p := 'TKT'; END IF;
    ts := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DDMMYYHH24MI');
    seq := public.next_ticket_seq();
    NEW.case_id := p || ts || lpad(seq::text, 3, '0');
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.log_ticket_created()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.ticket_activities (ticket_id, kind, notes, to_status, actor, created_at)
  VALUES (NEW.id, 'created', 'Ticket created', NEW.status, NEW.created_by, NEW.created_at);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ticket_created_log ON public.tickets;
CREATE TRIGGER trg_ticket_created_log
AFTER INSERT ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.log_ticket_created();
