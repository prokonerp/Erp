-- VERIFY: 41220083 — confirm the 2026-10-22 repair was applied.
-- Expect: 3 defective_rows, each with a real (identifying) serial; no placeholder ','.
SELECT b->>'oracle_no' AS oracle_no, b->'defective_rows' AS section_a
FROM public.indents i, jsonb_array_elements(COALESCE(i.oracles_data,'[]'::jsonb)) b
WHERE upper(btrim(COALESCE(b->>'oracle_no','')))=upper('41220083');
