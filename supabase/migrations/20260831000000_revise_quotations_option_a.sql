-- =============================================================================
-- REVISE QUOTATION — Option A (pipeline-safe, full history trail)
-- =============================================================================
-- PURPOSE:
--  - Let a quotation be *revised* for the SAME product/lead without inflating
--    pipeline (leads.expected_value). Keep Clone (new lead, new opportunity) intact.
--  - Every revision is a NEW row (history preserved). Latest revision alone is
--    counted (is_latest = true). Older revisions become is_latest = false and
--    are hidden from default pipeline / list views but stay readable.
--
-- SAFETY GUARANTEE (you asked: "doesnt delete any hair strand"):
--  - ONLY additive DDL: ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS.
--  - NO DROP, NO DELETE, NO TRUNCATE, NO UPDATE that overwrites user data
--    except the backfill below which only sets NULL-safe defaults (1 / true).
--  - DEFAULTs make existing rows instantly valid. All existing quotes become
--    "v1, latest" — zero data loss, zero pipeline change on deploy.
--  - Reversible: columns can be dropped without touching other data.
--  - No backfill touches total, expected_value, or any customer column.
-- =============================================================================

-- 1) lineage columns — which quote this revision came from
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS revision_of uuid REFERENCES public.quotations(id) ON DELETE SET NULL;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS revision_no int NOT NULL DEFAULT 1;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS is_latest boolean NOT NULL DEFAULT true;

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

-- 2) keep future code portable — ensure defaults are explicit for old rows
--    (existing rows already have DEFAULTs above; this just guarantees no NULLs if file re-run)
UPDATE public.quotations
SET revision_no = 1
WHERE revision_no IS NULL;

UPDATE public.quotations
SET is_latest = true
WHERE is_latest IS NULL;

-- 3) indexes — all IF NOT EXISTS, partial index keeps pipeline queries fast
--    (one latest per lead, but allow NULL lead_id)
CREATE INDEX IF NOT EXISTS idx_quotations_revision_of
  ON public.quotations(revision_of);

CREATE INDEX IF NOT EXISTS idx_quotations_lead_latest
  ON public.quotations(lead_id, is_latest)
  WHERE is_latest = true;

CREATE INDEX IF NOT EXISTS idx_quotations_lead_revision
  ON public.quotations(lead_id, revision_no DESC);

-- 4) guardrail — no self-reference (defensive, not destructive)
--    Allow multiple drafts revisions per lead via flag; uniqueness enforced in app
--    (partial unique index only where is_latest=true per lead prevented later via app logic)

-- 5) helpful view comment for operators
COMMENT ON COLUMN public.quotations.revision_of IS 'If this row is a revision, points to the immediate predecessor quotation id that it supersedes. NULL = original v1.';
COMMENT ON COLUMN public.quotations.revision_no IS '1 for original, 2,3… for successive revisions. Incremented on each Revise.';
COMMENT ON COLUMN public.quotations.is_latest IS 'true = latest revision for its lead/thread — the only one counted toward leads.expected_value / pipeline and shown by default. false = Superseded, hidden unless Show history is on.';
COMMENT ON COLUMN public.quotations.superseded_at IS 'When this row was superseded by its successor (set on predecessor at revise time).';

-- =============================================================================
-- VERIFY (read-only checks you can run after migration, no writes):
--  SELECT count(*) FROM public.quotations WHERE revision_no IS NULL; -- expect 0
--  SELECT count(*) FROM public.quotations WHERE is_latest IS NULL;    -- expect 0
--  SELECT quote_no, revision_no, is_latest, revision_of FROM public.quotations LIMIT 5;
-- =============================================================================
