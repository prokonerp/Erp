-- =============================================================================
-- Backfill legacy Delivery Challans / GRNs that were created before indent_id
-- was reliably populated. These documents carry the Indent Number (or Oracle
-- Number) in `reference_no` but have `indent_id IS NULL`. This script links
-- them to the correct Indent so they appear in the Indent's linked-docs view.
--
-- !! REVIEW BEFORE RUNNING !!  This is a data-mutation script. Run the
--    preview SELECTs first, sanity-check the row counts, then execute the
--    UPDATEs inside the transaction. Re-running is idempotent.
-- =============================================================================
BEGIN;

-- --- PREVIEW: which DCs would be linked (review before running) ---------------
SELECT
  dc.id AS dc_id,
  dc.reference_no,
  i.id AS indent_id,
  i.indent_no,
  i.oracle_number
FROM public.delivery_challans dc
JOIN public.indents i
  ON i.indent_no = dc.reference_no
  OR i.oracle_number = dc.reference_no
WHERE dc.indent_id IS NULL
  AND dc.reference_no IS NOT NULL
  AND dc.reference_no <> ''
ORDER BY dc.reference_no;

-- --- PREVIEW: which GRNs would be linked (review before running) ---------------
SELECT
  g.id AS grn_id,
  g.reference_no,
  i.id AS indent_id,
  i.indent_no,
  i.oracle_number
FROM public.grns g
JOIN public.indents i
  ON i.indent_no = g.reference_no
  OR i.oracle_number = g.reference_no
WHERE g.indent_id IS NULL
  AND g.reference_no IS NOT NULL
  AND g.reference_no <> ''
ORDER BY g.reference_no;

-- --- UPDATE: link legacy Delivery Challans to their Indent ----------------------
UPDATE public.delivery_challans dc
SET indent_id = i.id
FROM public.indents i
WHERE dc.indent_id IS NULL
  AND dc.reference_no IS NOT NULL
  AND dc.reference_no <> ''
  AND (i.indent_no = dc.reference_no OR i.oracle_number = dc.reference_no);

-- --- UPDATE: link legacy GRNs to their Indent -----------------------------------
UPDATE public.grns g
SET indent_id = i.id
FROM public.indents i
WHERE g.indent_id IS NULL
  AND g.reference_no IS NOT NULL
  AND g.reference_no <> ''
  AND (i.indent_no = g.reference_no OR i.oracle_number = g.reference_no);

COMMIT;
