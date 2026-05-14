CREATE OR REPLACE FUNCTION public.set_challan_no()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  yr TEXT := to_char(now(), 'YYYY');
  seq INT;
BEGIN
  IF NEW.challan_no IS NULL OR NEW.challan_no = '' THEN
    SELECT COALESCE(MAX(CAST(split_part(challan_no,'/',3) AS INT)),0)+1 INTO seq
      FROM public.gatepasses WHERE challan_no LIKE 'PHS/'||yr||'/%';
    NEW.challan_no := 'PHS/' || yr || '/' || lpad(seq::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;