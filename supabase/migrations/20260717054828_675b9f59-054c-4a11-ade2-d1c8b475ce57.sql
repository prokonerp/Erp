
CREATE TABLE public.indent_oracle_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  indent_id uuid NOT NULL REFERENCES public.indents(id) ON DELETE CASCADE,
  ticket_id uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  oracle_no text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, oracle_no)
);
CREATE INDEX idx_indent_oracle_map_indent ON public.indent_oracle_map(indent_id);
CREATE INDEX idx_indent_oracle_map_ticket ON public.indent_oracle_map(ticket_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.indent_oracle_map TO authenticated;
GRANT ALL ON public.indent_oracle_map TO service_role;

ALTER TABLE public.indent_oracle_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "indent_oracle_map_read_auth"
  ON public.indent_oracle_map FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "indent_oracle_map_write_auth"
  ON public.indent_oracle_map FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Trigger fn: rebuild map rows for an indent from its oracles_data
CREATE OR REPLACE FUNCTION public.sync_indent_oracle_map()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  b jsonb;
  onum text;
BEGIN
  DELETE FROM public.indent_oracle_map WHERE indent_id = NEW.id;
  IF NEW.oracles_data IS NOT NULL AND jsonb_typeof(NEW.oracles_data) = 'array' THEN
    FOR b IN SELECT * FROM jsonb_array_elements(NEW.oracles_data)
    LOOP
      onum := btrim(COALESCE(b->>'oracle_no',''));
      IF onum <> '' THEN
        INSERT INTO public.indent_oracle_map (indent_id, ticket_id, oracle_no)
        VALUES (NEW.id, NEW.ticket_id, onum)
        ON CONFLICT (ticket_id, oracle_no) DO UPDATE SET indent_id = EXCLUDED.indent_id;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_indent_oracle_map ON public.indents;
CREATE TRIGGER trg_sync_indent_oracle_map
AFTER INSERT OR UPDATE OF oracles_data, ticket_id ON public.indents
FOR EACH ROW EXECUTE FUNCTION public.sync_indent_oracle_map();

-- Backfill from existing indents
INSERT INTO public.indent_oracle_map (indent_id, ticket_id, oracle_no)
SELECT i.id, i.ticket_id, btrim(b->>'oracle_no')
FROM public.indents i,
     LATERAL jsonb_array_elements(COALESCE(i.oracles_data, '[]'::jsonb)) AS b
WHERE i.ticket_id IS NOT NULL
  AND COALESCE(btrim(b->>'oracle_no'),'') <> ''
ON CONFLICT (ticket_id, oracle_no) DO NOTHING;
