-- 20260928000005_tickets_search_trgm.sql
-- Speed up the admin Service Tickets free-text search: the list searches 9
-- columns with leading-wildcard ILIKE (`%term%`) OR-ed together, which forces
-- sequential scans on every keystroke (debounced). Per-column pg_trgm GIN
-- indexes (same convention as 20260907000000_quotations_search_speed and
-- 20260909000001_sales_order_fixes) let Postgres serve each OR branch from
-- the index. The predicate itself stays plain `col.ilike.%term%` with no
-- wrapping functions so the planner can use these indexes.
-- SAFE: additive only — extension + indexes, no column/table/RLS changes.
--
-- ROLLBACK (manual, only if an index ever needs rebuilding):
--   DROP INDEX IF EXISTS public.idx_tickets_case_id_trgm;
--   DROP INDEX IF EXISTS public.idx_tickets_customer_name_trgm;
--   DROP INDEX IF EXISTS public.idx_tickets_serial_no_trgm;
--   DROP INDEX IF EXISTS public.idx_tickets_product_trgm;
--   DROP INDEX IF EXISTS public.idx_tickets_customer_phone_trgm;
--   DROP INDEX IF EXISTS public.idx_tickets_location_trgm;
--   DROP INDEX IF EXISTS public.idx_tickets_sector_trgm;
--   DROP INDEX IF EXISTS public.idx_tickets_oem_ref_id_trgm;
--   DROP INDEX IF EXISTS public.idx_tickets_oem_brand_trgm;
--
-- NOTE: pg_trgm extraction needs >= 3 chars — 1–2 char terms still seq-scan.
-- The UI debounces search input (250ms), so that fallback stays rare/cheap.

-- Ensure pg_trgm exists (also used by quotations / sales_orders search indexes).
create extension if not exists pg_trgm;

-- Trigram indexes for fast ILIKE %term% (leading wildcard), one per searched column.
CREATE INDEX IF NOT EXISTS idx_tickets_case_id_trgm
  ON public.tickets USING gin (case_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_name_trgm
  ON public.tickets USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_serial_no_trgm
  ON public.tickets USING gin (serial_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_product_trgm
  ON public.tickets USING gin (product gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_customer_phone_trgm
  ON public.tickets USING gin (customer_phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_location_trgm
  ON public.tickets USING gin (location gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_sector_trgm
  ON public.tickets USING gin (sector gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_oem_ref_id_trgm
  ON public.tickets USING gin (oem_ref_id gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_tickets_oem_brand_trgm
  ON public.tickets USING gin (oem_brand gin_trgm_ops);

-- Analyze for the planner.
ANALYZE public.tickets;
