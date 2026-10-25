-- =============================================================================
-- REPAIR: Re-arm auto-close after oracle_docs_pending fix (rescoped)
-- =============================================================================
-- Only indents that own at least one 'Challan Generated' DC are affected by
-- the oracle_docs_pending fix (25 blocks per Q4). Touching every open indent
-- would drag the 48 pre-existing failing closed blocks through revalidate and
-- reopen them — out of scope for this change.
-- =============================================================================
BEGIN;
UPDATE public.indents
   SET updated_at = now()
 WHERE is_deleted = false
   AND id IN (
         SELECT DISTINCT indent_id
           FROM public.delivery_challans
          WHERE status = 'Challan Generated'
            AND indent_id IS NOT NULL
       );
COMMIT;

-- VERIFY: count indents still open after re-arm
SELECT count(*) AS still_open
FROM public.indents
WHERE (status IS NULL OR status NOT IN ('closed','draft'))
  AND is_deleted = false;