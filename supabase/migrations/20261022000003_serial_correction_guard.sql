-- =====================================================================
-- Serial correction guard (2026-10-22)
--
-- propagate_serial_correction() performs a global LIKE '%old%' fan-out.
-- Calling it with a punctuation placeholder (".", ",", "..") or a 1-2
-- character string can rewrite unrelated rows across tickets, GRNs, DCs,
-- gatepasses and indents. This migration keeps the legacy implementation
-- intact under a new name and puts a refusing guard in front of it.
--
-- Phase 1 is guard-only: real serials still use the legacy token-exact
-- replacement. Phase 2 replaces the LIKE prefilter with exact matching.
--
-- RUN: supabase db push (DBA runs it; app code never writes DB)
-- =====================================================================

DO $$
BEGIN
  IF to_regprocedure('public.propagate_serial_correction(text,text)') IS NOT NULL
     AND to_regprocedure('public.propagate_serial_correction_legacy(text,text)') IS NULL THEN
    ALTER FUNCTION public.propagate_serial_correction(text, text)
      RENAME TO propagate_serial_correction_legacy;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.propagate_serial_correction(_old_serial text, _new_serial text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text := NULLIF(btrim(COALESCE(_old_serial, '')), '');
  v_new text := NULLIF(btrim(COALESCE(_new_serial, '')), '');
BEGIN
  -- Explicit empty replacement: refuse, do not silently no-op. Blanking a
  -- serial is a pooling operation and must go through a named repair path.
  IF v_new IS NULL AND _new_serial IS NOT NULL THEN
    RAISE EXCEPTION 'Serial correction refused: replacement serial is empty';
  END IF;

  IF v_old IS NULL OR v_new IS NULL OR v_old = v_new THEN
    RETURN;
  END IF;

  IF public.is_placeholder_serial(v_old) OR public.is_placeholder_serial(v_new) THEN
    RAISE EXCEPTION 'Serial correction refused: punctuation-only serial (old=%, new=%)', v_old, v_new;
  END IF;

  IF NOT public.is_identifying_serial(v_new) THEN
    RAISE EXCEPTION 'Serial correction refused: replacement serial is not identifying';
  END IF;

  -- The legacy implementation uses LIKE '%old%'; short strings are the
  -- historical over-match hazard. Named, FK-anchored corrections still work.
  IF length(v_old) < 3 THEN
    RAISE EXCEPTION 'Serial correction refused: old serial "%" is shorter than 3 characters', v_old;
  END IF;

  IF position('%' in v_old) > 0 OR position('_' in v_old) > 0 THEN
    RAISE EXCEPTION 'Serial correction refused: old serial contains LIKE metacharacters';
  END IF;

  PERFORM public.propagate_serial_correction_legacy(v_old, v_new);
END;
$$;

COMMENT ON FUNCTION public.propagate_serial_correction(text, text) IS
  'Guarded entry point. Refuses punctuation-only/short/LIKE-metacharacter old serials; delegates to propagate_serial_correction_legacy for real serials.';

COMMENT ON FUNCTION public.propagate_serial_correction_legacy(text, text) IS
  'Legacy global LIKE-based propagation. Do not call directly with placeholders; use propagate_serial_correction().';
