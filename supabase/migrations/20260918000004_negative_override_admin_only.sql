-- Migration: 20260918000004_negative_override_admin_only.sql
-- IMS: allow_negative_stock on delivery challans is an admin-only override.
-- The app gates the dialog by role, but nothing at the DB layer stops a
-- non-admin from setting the flag via a direct update. CHECK constraints
-- cannot call role-lookup functions (IMMUTABLE requirement), so this uses a
-- trigger instead. Drafts flipping the flag off, or anyone setting it false,
-- are unaffected.
-- SAFE: additive-only, idempotent (DROP IF EXISTS + CREATE OR REPLACE),
-- zero destructive statements.

CREATE OR REPLACE FUNCTION public.assert_negative_override_admin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.allow_negative_stock IS TRUE
     AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'allow_negative_stock is an admin-only override';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assert_negative_override_admin ON public.delivery_challans;
CREATE TRIGGER trg_assert_negative_override_admin
  BEFORE INSERT OR UPDATE OF allow_negative_stock ON public.delivery_challans
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_negative_override_admin();
