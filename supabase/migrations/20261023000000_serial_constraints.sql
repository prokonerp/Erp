-- =====================================================================
-- Serial constraints — RUN LAST (2026-10-23)
--
-- Do not apply until supabase/repair_placeholder_serials.sql has been run
-- and v_placeholder_serial_report returns zero rows (or only rows you have
-- explicitly accepted). Each preflight aborts with the offender count.
--
-- These CHECKs reject punctuation-only serials at the column, so REST/RPC/
-- service_role writes cannot reintroduce the bug. NULL/'' remains legal:
-- pooled / non-serialized lines are a valid state.
--
-- The unique index is created non-concurrently because `supabase db push`
-- wraps migrations in a transaction. A DBA applying by hand may use:
--   DROP INDEX CONCURRENTLY ...; CREATE UNIQUE INDEX CONCURRENTLY ...
--
-- RUN: supabase db push (DBA runs it; app code never writes DB)
-- =====================================================================

DO $$
DECLARE
  n bigint;
  d bigint;
BEGIN
  SELECT count(*) INTO n FROM public.defective_tags
   WHERE public.is_placeholder_serial(serial_no);
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % placeholder serial(s) remain in defective_tags.serial_no. Run supabase/repair_placeholder_serials.sql first.', n;
  END IF;

  SELECT count(*) INTO n FROM public.ims_stock_items
   WHERE public.is_placeholder_serial(part_serial_no);
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % placeholder serial(s) remain in ims_stock_items.part_serial_no. Run supabase/repair_placeholder_serials.sql first.', n;
  END IF;

  SELECT count(*) INTO n FROM public.ims_transactions
   WHERE public.is_placeholder_serial(part_serial_no);
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % placeholder serial(s) remain in ims_transactions.part_serial_no. Run supabase/repair_placeholder_serials.sql first.', n;
  END IF;

  SELECT count(*) INTO n FROM public.ims_transfers
   WHERE public.is_placeholder_serial(part_serial_no);
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % placeholder serial(s) remain in ims_transfers.part_serial_no. Run supabase/repair_placeholder_serials.sql first.', n;
  END IF;

  SELECT count(*) INTO n FROM public.tickets
   WHERE public.is_placeholder_serial(serial_no);
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % placeholder serial(s) remain in tickets.serial_no. Run supabase/repair_placeholder_serials.sql first.', n;
  END IF;

  SELECT count(*) INTO n FROM public.indents
   WHERE public.is_placeholder_serial(def_serial_no)
      OR public.is_placeholder_serial(material_exchange_serial_no)
      OR public.is_placeholder_serial(material_rec_serial_no)
      OR public.is_placeholder_serial(product_serial);
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % indent row(s) still carry a placeholder typed serial. Run supabase/repair_placeholder_serials.sql first.', n;
  END IF;

  -- serials.serial_number is NOT NULL + uniquely indexed; a placeholder cannot
  -- be blanked without deleting the catalog entry. It is reported by the view
  -- for manual resolution, not auto-repaired and not CHECK-constrained here.
  SELECT count(*) INTO n FROM public.installed_equipment
   WHERE public.is_placeholder_serial(serial_no);
  IF n > 0 THEN
    RAISE EXCEPTION 'ABORT: % placeholder serial(s) remain in installed_equipment.serial_no. Run supabase/repair_placeholder_serials.sql first.', n;
  END IF;

  -- Duplicate real (model, serial) tag groups block the UNIQUE index.
  SELECT count(*) INTO d FROM (
    SELECT lower(btrim(coalesce(model_no, ''))) AS m,
           lower(btrim(coalesce(serial_no, ''))) AS s
      FROM public.defective_tags
     WHERE btrim(coalesce(serial_no, '')) <> ''
     GROUP BY 1, 2
    HAVING count(*) > 1
  ) dup;
  IF d > 0 THEN
    RAISE EXCEPTION 'ABORT: % duplicate (model, serial) group(s) remain in defective_tags. Run supabase/repair_placeholder_serials.sql first.', d;
  END IF;
END $$;

ALTER TABLE public.defective_tags
  DROP CONSTRAINT IF EXISTS defective_tags_no_placeholder_serial;
ALTER TABLE public.defective_tags
  ADD CONSTRAINT defective_tags_no_placeholder_serial
  CHECK (NOT public.is_placeholder_serial(serial_no));

ALTER TABLE public.ims_stock_items
  DROP CONSTRAINT IF EXISTS ims_stock_items_no_placeholder_serial;
ALTER TABLE public.ims_stock_items
  ADD CONSTRAINT ims_stock_items_no_placeholder_serial
  CHECK (NOT public.is_placeholder_serial(part_serial_no));

ALTER TABLE public.ims_transactions
  DROP CONSTRAINT IF EXISTS ims_transactions_no_placeholder_serial;
ALTER TABLE public.ims_transactions
  ADD CONSTRAINT ims_transactions_no_placeholder_serial
  CHECK (NOT public.is_placeholder_serial(part_serial_no));

ALTER TABLE public.ims_transfers
  DROP CONSTRAINT IF EXISTS ims_transfers_no_placeholder_serial;
ALTER TABLE public.ims_transfers
  ADD CONSTRAINT ims_transfers_no_placeholder_serial
  CHECK (NOT public.is_placeholder_serial(part_serial_no));

ALTER TABLE public.tickets
  DROP CONSTRAINT IF EXISTS tickets_no_placeholder_serial;
ALTER TABLE public.tickets
  ADD CONSTRAINT tickets_no_placeholder_serial
  CHECK (NOT public.is_placeholder_serial(serial_no));

ALTER TABLE public.indents
  DROP CONSTRAINT IF EXISTS indents_no_placeholder_serial;
ALTER TABLE public.indents
  ADD CONSTRAINT indents_no_placeholder_serial
  CHECK (
    NOT public.is_placeholder_serial(def_serial_no)
    AND NOT public.is_placeholder_serial(material_exchange_serial_no)
    AND NOT public.is_placeholder_serial(material_rec_serial_no)
    AND NOT public.is_placeholder_serial(product_serial)
  );

ALTER TABLE public.installed_equipment
  DROP CONSTRAINT IF EXISTS installed_equipment_no_placeholder_serial;
ALTER TABLE public.installed_equipment
  ADD CONSTRAINT installed_equipment_no_placeholder_serial
  CHECK (NOT public.is_placeholder_serial(serial_no));

DROP INDEX IF EXISTS public.defective_tags_unique_model_serial;
CREATE UNIQUE INDEX defective_tags_unique_model_serial
  ON public.defective_tags (
    lower(btrim(coalesce(model_no, ''))),
    lower(btrim(coalesce(serial_no, '')))
  )
  WHERE btrim(coalesce(serial_no, '')) <> '';
