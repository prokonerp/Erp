UPDATE public.indents i
SET oracles_data = (
  SELECT jsonb_agg(
    CASE WHEN o->>'oracle_no' = '41208103'
      THEN (o - 'force_closed' - 'force_close_reason' - 'closed_by' - 'closed_by_name' - 'closed_at') || '{"status":"open"}'::jsonb
      ELSE o END
  )
  FROM jsonb_array_elements(i.oracles_data) o
)
WHERE i.id = 'f1354c89-53e3-4149-ac90-dadb9df803b3';