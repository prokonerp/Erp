-- 20260823100000_bugfix_hardening.sql
-- DB-side fixes from the BUG_REPORT audit (B-06, B-18, B-19):
--
--   B-06: `allow_negative_stock` was authorized ONLY in the browser. Any
--         authenticated user could POST an invoice/challan with the flag set
--         and oversell stock that does not exist. These triggers make the
--         flag admin-only at the database level.
--
--   B-19: "claim first admin" policy could race — two users clicking Claim
--         Admin at the same moment could both insert an admin row (the
--         NOT EXISTS check is not serialization-safe). An advisory lock now
--         serializes claims so exactly one first-admin can ever exist.
--
--   B-18 (residual): negative-stock override AUDIT rows were already
--   admin-gated; payroll / GRN-delete / challan-delete paths already use
--   admin policies or SECURITY DEFINER RPCs. No further policy changes.

-- ============================================================
-- B-06: allow_negative_stock is admin-only, enforced in the DB
-- ============================================================

CREATE OR REPLACE FUNCTION public.assert_negative_stock_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.allow_negative_stock, false) IS TRUE
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION
      'Setting allow_negative_stock requires an administrator role';
  END IF;
  RETURN NEW;
END;
$$;

-- Invoices
DROP TRIGGER IF EXISTS trg_invoices_negstock_admin ON public.invoices;
CREATE TRIGGER trg_invoices_negstock_admin
  BEFORE INSERT OR UPDATE OF allow_negative_stock ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.assert_negative_stock_admin();

-- Customer/OEM delivery challans
DROP TRIGGER IF EXISTS trg_challans_negstock_admin ON public.delivery_challans;
CREATE TRIGGER trg_challans_negstock_admin
  BEFORE INSERT OR UPDATE OF allow_negative_stock ON public.delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.assert_negative_stock_admin();

-- General delivery challans
DROP TRIGGER IF EXISTS trg_gdc_negstock_admin ON public.general_delivery_challans;
CREATE TRIGGER trg_gdc_negstock_admin
  BEFORE INSERT OR UPDATE OF allow_negative_stock ON public.general_delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.assert_negative_stock_admin();

-- ============================================================
-- B-19: race-safe "first admin" claim
-- ============================================================

CREATE OR REPLACE FUNCTION public.guard_first_admin_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_claim_insert boolean;
BEGIN
  -- Only guard self-service inserts of the admin role.
  IF NEW.role <> 'admin' THEN
    RETURN NEW;
  END IF;

  -- The dedicated "admins manage roles" policy covers admin-initiated writes;
  -- this trigger exists to serialize the bootstrap claim path.
  IF public.has_role(auth.uid(), 'admin') AND NEW.user_id <> auth.uid() THEN
    RETURN NEW; -- existing admin creating another admin: allowed by policy
  END IF;

  -- Serialize concurrent bootstrap claims: take a transaction-scoped
  -- advisory lock, then re-check whether an admin already exists.
  PERFORM pg_advisory_xact_lock(hashtext('prokon:first-admin-claim'));

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION
        'An administrator already exists. Ask an existing admin to grant roles.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_first_admin ON public.user_roles;
CREATE TRIGGER trg_guard_first_admin
  BEFORE INSERT ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.guard_first_admin_claim();

-- ============================================================
-- Sweep fix (B-08 class): posted documents must not have their items edited
-- ------------------------------------------------------------
-- The stock-posting triggers fire on INSERT / status transitions only, so an
-- UPDATE that rewrites `items` after posting silently desyncs inventory from
-- paperwork. These guards allow remark/status maintenance but reject any
-- change to the actual line items (or quantities) after posting.
-- ============================================================

CREATE OR REPLACE FUNCTION public.assert_items_frozen_after_post()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'delivery_challans' THEN
    IF OLD.status = 'Dispatched' AND NEW.items IS DISTINCT FROM OLD.items THEN
      RAISE EXCEPTION
        'Challan % is Dispatched — its items are frozen because stock has been posted. Cancel and re-raise instead.',
        COALESCE(OLD.challan_no, OLD.id);
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'general_delivery_challans' THEN
    IF OLD.status IN ('Issued', 'Converted', 'Cancelled')
       AND NEW.items IS DISTINCT FROM OLD.items THEN
      RAISE EXCEPTION
        'General DC % is % — its items are frozen because stock has been posted/reversed.',
        COALESCE(OLD.dc_no, OLD.id), OLD.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_challan_items_frozen ON public.delivery_challans;
CREATE TRIGGER trg_challan_items_frozen
  BEFORE UPDATE ON public.delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.assert_items_frozen_after_post();

DROP TRIGGER IF EXISTS trg_gdc_items_frozen ON public.general_delivery_challans;
CREATE TRIGGER trg_gdc_items_frozen
  BEFORE UPDATE ON public.general_delivery_challans
  FOR EACH ROW EXECUTE FUNCTION public.assert_items_frozen_after_post();

-- ============================================================
-- Sweep fix (finding #45): invoice serial posting must FAIL LOUD when a
-- serial is not available. The existing trigger silently skips unavailable
-- serials (CONTINUE), so an invoice could be issued for units that never
-- existed or were already sold — paperwork says sold, stock never moved.
-- ============================================================

CREATE OR REPLACE FUNCTION public.invoice_item_sync_serials_strict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv record;
  s text;
  sr public.ims_stock_items%ROWTYPE;
  removed text[] := '{}';
  added text[] := '{}';
BEGIN
  SELECT invoice_no, buyer_name,
         COALESCE(allow_negative_stock, false) AS allow_neg,
         COALESCE(skip_stock_posting, false)   AS skip_post
    INTO inv FROM public.invoices
   WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END);

  IF COALESCE(inv.skip_post, false) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- INSERT: issuing serials — every serial MUST be available or the invoice fails.
  IF TG_OP = 'INSERT' THEN
    IF NEW.serial_numbers IS NULL OR array_length(NEW.serial_numbers, 1) = 0 THEN
      RETURN NEW;
    END IF;
    FOREACH s IN ARRAY NEW.serial_numbers LOOP
      SELECT * INTO sr FROM public.ims_stock_items
       WHERE part_serial_no = s AND stock_status = 'available' LIMIT 1;
      IF sr.id IS NULL THEN
        RAISE EXCEPTION
          'Invoice %: serial "%" is not available in stock (already issued or unknown)',
          COALESCE(inv.invoice_no, NEW.invoice_id), s;
      END IF;
      UPDATE public.ims_stock_items
         SET stock_status = 'issued', updated_at = now() WHERE id = sr.id;
      INSERT INTO public.ims_transactions(
        txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
        from_warehouse_id, to_party, qty, reference, notes
      ) VALUES (
        'good_out', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
        sr.warehouse_id, COALESCE(inv.buyer_name, 'Customer'), 1,
        'Invoice ' || COALESCE(inv.invoice_no, ''), 'Auto-posted from Sales Invoice'
      );
    END LOOP;
    RETURN NEW;

  -- UPDATE: reversals stay lenient (a serial may already be released);
  -- newly-added serials must be strictly available.
  ELSIF TG_OP = 'UPDATE' THEN
    removed := ARRAY(SELECT unnest(COALESCE(OLD.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(NEW.serial_numbers,'{}')));
    added   := ARRAY(SELECT unnest(COALESCE(NEW.serial_numbers,'{}')) EXCEPT SELECT unnest(COALESCE(OLD.serial_numbers,'{}')));

    IF array_length(removed,1) > 0 THEN
      FOREACH s IN ARRAY removed LOOP
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'issued' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'available', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, reference, notes
        ) VALUES (
          'good_in', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv.buyer_name, 'Customer'), 1,
          'Invoice ' || COALESCE(inv.invoice_no, ''), 'Reversal: serial removed from Sales Invoice'
        );
      END LOOP;
    END IF;

    IF array_length(added,1) > 0 THEN
      FOREACH s IN ARRAY added LOOP
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'available' LIMIT 1;
        IF sr.id IS NULL THEN
          RAISE EXCEPTION
            'Invoice %: serial "%" is not available in stock (already issued or unknown)',
            COALESCE(inv.invoice_no, NEW.invoice_id), s;
        END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'issued', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          from_warehouse_id, to_party, qty, reference, notes
        ) VALUES (
          'good_out', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv.buyer_name, 'Customer'), 1,
          'Invoice ' || COALESCE(inv.invoice_no, ''), 'Auto-posted from Sales Invoice'
        );
      END LOOP;
    END IF;
    RETURN NEW;

  -- DELETE: full reversal of the item's serials (lenient).
  ELSE
    IF OLD.serial_numbers IS NOT NULL AND array_length(OLD.serial_numbers,1) > 0 THEN
      FOREACH s IN ARRAY OLD.serial_numbers LOOP
        SELECT * INTO sr FROM public.ims_stock_items
         WHERE part_serial_no = s AND stock_status = 'issued' LIMIT 1;
        IF sr.id IS NULL THEN CONTINUE; END IF;
        UPDATE public.ims_stock_items
           SET stock_status = 'available', updated_at = now() WHERE id = sr.id;
        INSERT INTO public.ims_transactions(
          txn_type, stock_item_id, part_name, part_model_no, part_serial_no, oem,
          to_warehouse_id, from_party, qty, reference, notes
        ) VALUES (
          'good_in', sr.id, sr.part_name, sr.part_model_no, s, sr.oem,
          sr.warehouse_id, COALESCE(inv.buyer_name, 'Customer'), 1,
          'Invoice ' || COALESCE(inv.invoice_no, ''), 'Reversal: invoice item deleted'
        );
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;
END;
$$;

-- Replace the permissive version with the strict one.
DROP TRIGGER IF EXISTS trg_invoice_item_sync_serials ON public.invoice_items;
CREATE TRIGGER trg_invoice_item_sync_serials
AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
FOR EACH ROW EXECUTE FUNCTION public.invoice_item_sync_serials_strict();

-- ============================================================
-- Sweep fix (finding #46): skip_stock_posting is only meaningful when the
-- invoice was converted from a General DC whose stock already left. A stale
-- browser flag must not be able to tell the DB "don't deduct" on a fresh sale.
-- ============================================================

CREATE OR REPLACE FUNCTION public.assert_skip_posting_has_source()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.skip_stock_posting, false) IS TRUE
     AND NEW.source_general_dc_id IS NULL THEN
    RAISE EXCEPTION
      'skip_stock_posting requires a source General DC (stock must have left via that DC)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_skip_post_guard ON public.invoices;
CREATE TRIGGER trg_invoices_skip_post_guard
  BEFORE INSERT OR UPDATE OF skip_stock_posting, source_general_dc_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.assert_skip_posting_has_source();
