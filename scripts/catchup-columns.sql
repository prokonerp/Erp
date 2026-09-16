-- scripts/catchup-columns.sql
-- PROKON ERP — Catch-up for dashboard-added columns that exist on live but in
-- NO migration file. Without this, a fresh reset (setup.sql + migrations)
-- would BREAK the CustomerForm/ContactPersonPicker/tickets screens.
--
-- HOW TO RUN:
--   1. Run PART A alone first. Compare its output with PART B's expected
--      types below. They should match; if a type differs, edit PART B.
--   2. Run PART B. Expected: `ALTER TABLE` notices "column already exists,
--      skipping" on live (no-ops). On a fresh DB it creates the columns.
--
-- SAFE: ADD COLUMN IF NOT EXISTS only. No UPDATE/DELETE/DROP. Re-running is
-- a no-op (Postgres skips with a NOTICE instead of erroring, even if the
-- committed type ever drifts from a live one).

-- ── PART A: live type dump (read-only) ──
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'customers'
     AND column_name IN ('contacts','dup_exempt','city','street','country'))
    OR
    (table_name = 'tickets'
     AND column_name IN ('source'))
  )
ORDER BY table_name, column_name;

-- ── PART B: guarded catch-up DDL (expected types from live + app usage) ──
-- contacts: jsonb array of {name, phone, ...} (CustomerForm.tsx writes arrays)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS contacts jsonb;
-- dup_exempt: duplicate-check exemption flag (CustomerForm.tsx boolean reads)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS dup_exempt boolean;
-- city / street / country: free-text address parts (tickets.new.tsx, amc.oem.*)
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS street text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS country text;
-- tickets.source: lead/ticket source label (tickets.ts type field)
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS source text;
