DELETE FROM public.defective_tags t
USING public.defective_tags k
WHERE lower(trim(coalesce(t.model_no,''))) = lower(trim(coalesce(k.model_no,'')))
  AND lower(trim(coalesce(t.serial_no,''))) = lower(trim(coalesce(k.serial_no,'')))
  AND trim(coalesce(t.serial_no,'')) <> ''
  AND (t.created_at, t.id) > (k.created_at, k.id);

CREATE UNIQUE INDEX IF NOT EXISTS defective_tags_unique_model_serial
  ON public.defective_tags (lower(trim(coalesce(model_no,''))), lower(trim(serial_no)))
  WHERE trim(coalesce(serial_no,'')) <> '';